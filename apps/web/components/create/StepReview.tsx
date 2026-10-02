"use client";

import { PeakpumpFactoryAbi } from "@peakpump/contracts-abi";
import { PEAKPUMP_FACTORY } from "@peakpump/shared/addresses";
import { marketCap6 } from "@peakpump/shared/curve";
import { formatFeeBps } from "@peakpump/shared/fees";
import { formatMarketCap, formatUsdc6, formatUsdcWei } from "@peakpump/shared/format";
import { PRESETS } from "@peakpump/shared/presets";
import { Button } from "@peakpump/ui/Button";
import { Panel } from "@peakpump/ui/Panel";
import { type UseQueryResult } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { parseEventLogs } from "viem";
import { SignInDialog } from "@/components/social/SignInDialog";
import { TradeStatus } from "@/components/trade/TradeStatus";
import { ReadFailure } from "@/components/token/ReadFailure";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { useCreateParams } from "@/hooks/useCreateParams";
import { useGasEstimate } from "@/hooks/useGasEstimate";
import { useSession } from "@/hooks/useSession";
import { useTrade } from "@/hooks/useTrade";
import { MICRO_TO_WEI } from "@/lib/curve-write";
import {
  derivedPreview,
  economics,
  type CreateState,
  type EconomicsParams,
} from "@/lib/create-state";
import { storeIdentityDocument } from "@/lib/create-submit";
import { publicClient } from "@/lib/viem";

// Step 3: everything the two earlier steps chose, on one page, beside what the
// creation costs. Every verdict has already been given — the Next gates ran the
// model's own reasons — so nothing here re-judges anything. What it owns is the
// one number that can still move against the form (the live dev-buy cap), the
// factory parameters this market inherits, and the submit sequence itself: the
// metadata document is stored first, because its URI is an argument of create(),
// and the market's address is read back from the MarketCreated log, because a
// wallet signer has no return value to read.

const FIGURE = "mono text-body text-pp-text break-all md:text-small";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-small text-pp-text-muted">{label}</dt>
      <dd className={FIGURE}>{children}</dd>
    </div>
  );
}

// StepEconomics' own copies, re-declared rather than imported: that file is
// frozen, and each is three lines whose twin a comment can hold to the same
// discipline as the originals.

// MATH [3] conserves k = x*y across every ASCENT trade, so the reserve beside a
// supply y is x0*y0 over y. Floored, like every division on chain.
function reserveAt(x0: bigint, y0: bigint, y: bigint): bigint {
  return (x0 * y0) / y;
}

function formatMultiple(rX18: bigint): string {
  const whole = rX18 / 10n ** 18n;
  const fraction = (rX18 % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}x` : `${whole}.${fraction}x`;
}

// The URI does not exist until the document is stored, and a calldata string
// costs gas by its length rather than its contents, so the estimate runs against
// a placeholder of the same shape: an origin, /m/, 64 hex characters.
const PLACEHOLDER_URI = `https://example.com/m/${"1".repeat(64)}`;

// The ABI's component order, as an array rather than an object on purpose:
// useGasEstimate hashes its key with String over the args, and an object would
// collapse to "[object Object]", so a change made on a trip back through Step 2
// would return to a cached estimate. The same builder feeds the estimate and the
// send, so the two can never disagree about the order either.
function createArgs(name: string, symbol: string, p: EconomicsParams, metadataURI: string) {
  return [
    name,
    symbol,
    metadataURI,
    p.presetId,
    p.S,
    p.R6,
    p.rX18,
    p.devBuy6,
    p.antiSnipeBlocks,
    p.maxBuyPerAddress6,
  ] as const;
}

const NO_SESSION = "Sign in to store an image with the token.";

interface StepReviewProps {
  state: CreateState;
  maxDevBuy: UseQueryResult<bigint>;
}

export function StepReview({ state, maxDevBuy }: StepReviewProps) {
  const createParams = useCreateParams();
  const params = createParams.data;
  const session = useSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const econ = economics(state);
  const preview = derivedPreview(state);
  const run = useTrade();
  const router = useRouter();

  const estimate = useGasEstimate(
    econ === null || params === undefined
      ? undefined
      : {
          address: PEAKPUMP_FACTORY,
          abi: PeakpumpFactoryAbi,
          functionName: "create",
          args: [createArgs(state.identity.name, state.identity.symbol, econ, PLACEHOLDER_URI)],
          value: (params.creationFee6 + econ.devBuy6) * MICRO_TO_WEI,
        },
  );

  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  // One flight at a time: the document request takes a round trip of its own,
  // and a second press during it would store a second document (the same bytes,
  // so the same key, but the presses do not know that).
  const [storing, setStoring] = useState(false);

  // useTrade waited for this receipt and hands back only the hash, so this
  // fetches it again rather than widening a delivered hook. The receipt of a
  // create() carries the dev-buy's Trade and TradeDetail logs beside
  // MarketCreated, so the event name filters rather than the first log winning.
  // The market's address exists nowhere else on this path: a wallet signer has
  // no return value to read.
  useEffect(() => {
    const hash = run.hash;
    if (run.stage !== "settled" || hash === undefined) return;
    let active = true;
    void (async () => {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      const created = parseEventLogs({
        abi: PeakpumpFactoryAbi,
        eventName: "MarketCreated",
        logs: receipt.logs,
      });
      const market = created[0];
      if (!active) return;
      if (market === undefined) {
        setMarketError(
          "The market was created, but its address could not be read from the receipt.",
        );
        return;
      }
      router.push(`/token/${market.args.curve}`);
    })();
    return () => {
      active = false;
    };
  }, [run.stage, run.hash, router]);

  // Review is reachable only through the Next gates, which ran identityIssue
  // and economicsReason first, so both structs exist. The early return is type
  // narrowing, not a second verdict.
  if (econ === null || preview === null) return null;

  // The same live cap Step 2 joins at its point of use, joined here at this
  // step's own: the cap moves with every poll of the factory view, and a dev-buy
  // above it reverts create() after the fact (PeakpumpFactory.sol:188), which
  // the node reports as a call it refuses to price — a reason this page owes in
  // its own words before that quieter one appears.
  const cap6 = maxDevBuy.data;
  const devBuyReason =
    cap6 === undefined || econ.devBuy6 <= cap6
      ? null
      : `The dev-buy is capped at Ts/20: at most ${formatUsdc6(cap6)} at these values.`;

  // presetKey is the closed PresetKey union and PRESETS carries one entry per
  // key, so the miss is impossible; the assertion is the type-level gate.
  const { mode } = state.economics;
  const preset =
    mode.kind === "preset"
      ? PRESETS.find((candidate) => candidate.key === mode.presetKey)!
      : null;
  const d = preview.derived;

  const busy = storing || run.stage === "signing" || run.stage === "pending";

  // Uploading needs a session the create transaction itself does not: the wallet is
  // connected for the signature, and signing in is a second, free action (SPEC
  // 6.7:588). An unsigned creator holding an image is stopped here rather than at the
  // route, because a 401 after the bytes are in flight is a worse place to learn it —
  // the market is not yet created, but neither is the image the creator chose.
  const imageNeedsSignIn = state.identity.image !== null && session.address === null && !session.pending;
  const signInReason = imageNeedsSignIn ? NO_SESSION : null;

  // An arrow const rather than a function declaration: the narrowing above has
  // already established both structs exist, and a hoisted declaration would ask
  // this to prove it a second time.
  const onSubmit = async () => {
    if (params === undefined || estimate === null || run.submit === undefined) return;
    if (imageNeedsSignIn) {
      setSignInOpen(true);
      return;
    }
    run.reset();
    setMetadataError(null);
    setMarketError(null);
    setStoring(true);
    const { stored } = await storeIdentityDocument(state.identity);
    setStoring(false);
    if (stored.kind === "failed") {
      setMetadataError(stored.message);
      return;
    }
    const name = state.identity.name;
    const symbol = state.identity.symbol;
    const econAtPress = econ;
    const value = (params.creationFee6 + econAtPress.devBuy6) * MICRO_TO_WEI;
    run.submit(
      () => ({
        address: PEAKPUMP_FACTORY,
        abi: PeakpumpFactoryAbi,
        functionName: "create",
        args: [createArgs(name, symbol, econAtPress, stored.metadataURI)],
        value,
      }),
      estimate,
    );
  };

  return (
    <>
      <Panel as="section" title="Token" className="max-w-[560px]">
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-2">
            <Row label="Name">{state.identity.name}</Row>
            <Row label="Symbol">{state.identity.symbol}</Row>
            <Row label="Description">{state.identity.description === "" ? "None" : state.identity.description}</Row>
          </dl>
          {state.identity.image !== null && (
            <div className="flex items-center gap-3">
              {/* The cropper's own preview, mirrored at its size: an object URL
                  the browser owns, never a path anything fetches. */}
              <img
                src={state.identity.image.previewUrl}
                width={96}
                height={96}
                alt="The cropped image chosen for the token"
                className="hairline rounded-pp block h-24 w-24"
              />
              <p className="text-small text-pp-text-muted">
                Stored with the market when it is created. Storing an image needs a
                signed-in wallet.
              </p>
            </div>
          )}
        </div>
      </Panel>

      <Panel as="section" title="Market" className="max-w-[560px]">
        <dl className="flex flex-col gap-2">
          <Row label="Preset">{preset !== null ? preset.label : "Custom"}</Row>
          {/* Raw, stringified and never scaled or regrouped: MATH 10 and the
              bounds of MATH 3 fix these, and this page is not a second place
              they get arithmetic done to them. */}
          <Row label="S">{econ.S.toString()}</Row>
          <Row label="R6">{econ.R6.toString()}</Row>
          <Row label="rX18">{econ.rX18.toString()}</Row>
          <Row label="Start market cap">
            {formatMarketCap(marketCap6(d.x0, d.y0, preview.S))}
          </Row>
          <Row label="Summit market cap">
            {formatMarketCap(marketCap6(reserveAt(d.x0, d.y0, d.y1), d.y1, preview.S))}
          </Row>
          <Row label="Multiple">{formatMultiple(preview.rX18)}</Row>
          <Row label="Dev-buy">{econ.devBuy6 === 0n ? "None" : `${formatUsdc6(econ.devBuy6)} USDC`}</Row>
          {econ.antiSnipeBlocks === 0n ? (
            <Row label="Anti-snipe">Off</Row>
          ) : (
            <>
              <Row label="Anti-snipe window">{econ.antiSnipeBlocks.toString()} blocks</Row>
              <Row label="Per-address cap">{formatUsdc6(econ.maxBuyPerAddress6)} USDC</Row>
            </>
          )}
        </dl>
      </Panel>

      <Panel as="section" title="Fees and costs" className="max-w-[560px]">
        <div className="flex flex-col gap-4">
          {createParams.isError ? (
            <ReadFailure error={createParams.error} onRetry={createParams.refetch} />
          ) : params === undefined ? (
            <p className="text-small text-pp-text-muted">
              The fee schedule and the creation fee have not been read from the factory yet.
            </p>
          ) : (
            <>
              <dl className="flex flex-col gap-2">
                <Row label="Trade fee">{formatFeeBps(BigInt(params.defaultFeeBps))}</Row>
                {/* The fee is what the factory says it is, read live, and a zero
                    prints as no fee at all rather than as a number no one pays. */}
                <Row label="Creation fee">
                  {params.creationFee6 === 0n
                    ? "No creation fee"
                    : `${formatUsdc6(params.creationFee6)} USDC`}
                </Row>
                <Row label="Dev-buy">
                  {econ.devBuy6 === 0n ? "None" : `${formatUsdc6(econ.devBuy6)} USDC`}
                </Row>
                {estimate === null ? null : (
                  <>
                    <Row label="Gas, estimated">{estimate.usdc} USDC</Row>
                    {/* All in the 18-decimal view the wallet pays in: the fee
                        and the dev-buy as exact multiples of 1e12, the gas at
                        the same cap the send itself carries. */}
                    <Row label="Total, estimated">
                      {formatUsdcWei(
                        (params.creationFee6 + econ.devBuy6) * MICRO_TO_WEI +
                          estimate.gasUnits * estimate.maxFeePerGas,
                      )}{" "}
                      USDC
                    </Row>
                  </>
                )}
              </dl>
              <p className="text-small text-pp-text-muted">
                Split {formatFeeBps(BigInt(params.defaultCreatorBps))} to the creator and{" "}
                {formatFeeBps(BigInt(params.defaultProtocolBps))} to the protocol, on every
                trade, in both phases.
              </p>
              <p className="text-small text-pp-text-muted">
                The fee parameters and the creator address are snapshotted at creation and
                can never be changed afterwards by anyone, including the admin.
              </p>
            </>
          )}

          {run.submit === undefined ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-small text-pp-text-muted">Connect a wallet to create.</p>
              <ConnectWallet />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                className="w-full"
                aria-busy={busy}
                disabled={
                  params === undefined ||
                  estimate === null ||
                  devBuyReason !== null ||
                  signInReason !== null ||
                  busy ||
                  // Settled routes away, but until it does, a second press would
                  // create a second market rather than repeat a trade.
                  run.stage === "settled"
                }
                onClick={() => {
                  void onSubmit();
                }}
              >
                Create token
              </Button>

              {signInReason !== null ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-small text-pp-text-muted">{signInReason}</p>
                  <Button size="sm" onClick={() => setSignInOpen(true)}>
                    Sign in
                  </Button>
                </div>
              ) : null}

              <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

              {devBuyReason !== null ? (
                <p className="text-small text-pp-down">{devBuyReason}</p>
              ) : null}

              {estimate === null && devBuyReason === null ? (
                <p className="text-small text-pp-text-muted">
                  This market has no gas estimate yet, so it cannot be created. The estimate
                  is taken again every two seconds.
                </p>
              ) : null}

              {metadataError !== null ? (
                <p className="text-small text-pp-down">{metadataError}</p>
              ) : null}

              {marketError !== null ? <p className="text-small text-pp-down">{marketError}</p> : null}

              <TradeStatus run={run} settledMessage="Market created." />
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
