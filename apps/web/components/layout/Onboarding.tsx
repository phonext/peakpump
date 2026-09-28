"use client";

import { arcTestnet, FAUCET_URL } from "@peakpump/shared/chain";
import { CREATOR_BPS, PROTOCOL_BPS, TRADE_FEE_BPS } from "@peakpump/shared/fees";
import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import { Toast } from "@peakpump/ui/Toast";
import { useEffect, useState } from "react";
import { describeRpcError } from "@/lib/rpc-error";
import { useWalletState } from "@/lib/wallet-state";

const SEEN_KEY = "peakpump.onboarding.seen";

interface Slide {
  heading: string;
  body: string;
  // Digits live here rather than in body, and this line is set in the mono face:
  // DESIGN.md keeps every number out of the grotesk.
  figures?: string;
}

const SLIDES: readonly Slide[] = [
  {
    heading: "Two phases",
    body:
      "A token opens in ASCENT, where every buy moves along a fixed curve and the price " +
      "rises with supply sold. When the last curve token sells, the market reaches the " +
      "Summit and enters PEAK.",
  },
  {
    heading: "Fees",
    body:
      "Every trade pays the same rate in both phases, split between the creator and the " +
      "protocol. Fees are credited to a vault and claimed from it, never pushed.",
    // packages/shared/src/fees.ts is the only file in the repository that may name
    // these literals, and the Testnet slide below already reads its figures off the
    // frozen chain object rather than restating them.
    figures: `${TRADE_FEE_BPS} bps total · ${CREATOR_BPS} creator · ${PROTOCOL_BPS} protocol`,
  },
  {
    heading: "Testnet",
    body:
      "Balances here have no monetary value, and nothing here is an offer or financial " +
      "advice. Add the network to your wallet to follow along.",
    figures: `${arcTestnet.name} · chain id ${arcTestnet.id} · native USDC ${arcTestnet.nativeCurrency.decimals} decimals`,
  },
];

// Its own component so the wallet state and the failure toast belong to the slide
// that needs them, and so the client is narrowed by the render rather than by a
// guard.
function AddNetwork() {
  const walletClient = useWalletState().walletClient;
  const [failure, setFailure] = useState<string | null>(null);

  if (walletClient === undefined) {
    return (
      <p className="text-small text-pp-text-muted">
        Connect a wallet first, then add the network from here.
      </p>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          // addChain derives the hex chain id, the name, the USDC currency and the RPC
          // hosts from the frozen chain object, so none of them is written twice.
          void walletClient
            .addChain({ chain: arcTestnet })
            .catch((error: unknown) => setFailure(describeRpcError(error).message));
        }}
      >
        Add Arc Testnet
      </Button>
      {failure === null ? null : (
        <Toast open onClose={() => setFailure(null)} message={failure} tone="down" />
      )}
    </>
  );
}

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  // Read after mount rather than during render: the server has no localStorage, so a
  // flag consulted while rendering would make the first client paint disagree with the
  // markup it is hydrating.
  useEffect(() => {
    if (window.localStorage.getItem(SEEN_KEY) === null) setOpen(true);
  }, []);

  function close() {
    // Closed first, so a storage write the browser refuses cannot leave the dialog
    // stuck open.
    setOpen(false);
    window.localStorage.setItem(SEEN_KEY, "1");
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Before you start"
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" disabled={index === 0} onClick={() => setIndex((p) => p - 1)}>
            Back
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={last ? close : () => setIndex((p) => p + 1)}
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {SLIDES.map((slide, position) =>
          position !== index ? null : (
            <div key={slide.heading} className="flex flex-col gap-2">
              <p className="text-heading font-medium text-pp-text">{slide.heading}</p>
              <p className="text-body text-pp-text-muted">{slide.body}</p>
              {slide.figures === undefined ? null : (
                // Body on mobile, Small from md up: DESIGN.md keeps a number at or
                // above the third step of the scale on a phone.
                <p className="mono text-body text-pp-text md:text-small">{slide.figures}</p>
              )}
            </div>
          ),
        )}
        {last ? (
          <>
            <AddNetwork />
            {/* Offered before a wallet exists as well as after: the faucet is how an
                empty account gets its first testnet USDC, so it is not gated on the
                network button beside it. */}
            <p className="text-small text-pp-text-muted">
              Get testnet USDC from the{" "}
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-pp py-4 text-pp-text underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
              >
                Circle faucet
              </a>
              .
            </p>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
