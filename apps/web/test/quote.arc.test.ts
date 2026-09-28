import { CurveAbi, PeakpumpFactoryAbi } from "@peakpump/contracts-abi";
import { PEAKPUMP_FACTORY, START_BLOCK } from "@peakpump/shared/addresses";
import { arcTestnet } from "@peakpump/shared/chain";
import { formatTokenAmount } from "@peakpump/shared/format";
import {
  type Address,
  createPublicClient,
  fallback,
  getAbiItem,
  getAddress,
  http,
} from "viem";
import { describe, expect, it } from "vitest";
import { MIN_BUY_6, readBuyQuote, readSellQuote } from "@/lib/curve-quote";
import { readTokenLive } from "@/lib/curve-reads";
import type { ReadClient } from "@/lib/viem";
import { feeCeil } from "./fee-base";

// The endpoint is the operator's, so a local node or a private URL works without
// editing this file. No literal is written here: only
// packages/shared/src/chain.ts may declare one.
const RPC_URL = process.env.ARC_RPC_URL;

// Measured against rpc.testnet.arc.io on 2026-09-04: eth_getLogs answers a
// 30,000-block range and returns -32012 "requested range too large" at 40,000,
// so 20,000 leaves room for the cap to tighten. START_BLOCK's own chunk holds
// both deployed markets, so the usual scan is one request.
const CHUNK = 20_000n;

// Two round trips per test against a public node, which is over vitest's 5 s
// default.
const TIMEOUT_MS = 20_000;

function makeClient(url: string): ReadClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback([http(url, { batch: true })]),
    batch: { multicall: true },
  });
}

// The factory has no enumerator — its whole public surface is create, the four
// parameter views, marketCount and the owner setters — so a curve address exists
// only in a MarketCreated log.
async function resolveCurve(client: ReadClient): Promise<Address | null> {
  const configured = process.env.ARC_TEST_CURVE;
  if (configured !== undefined) return getAddress(configured);
  const count = await client.readContract({
    address: PEAKPUMP_FACTORY,
    abi: PeakpumpFactoryAbi,
    functionName: "marketCount",
  });
  if (count === 0n) return null;
  const event = getAbiItem({ abi: PeakpumpFactoryAbi, name: "MarketCreated" });
  const head = await client.getBlockNumber();
  for (let from = START_BLOCK; from <= head; from += CHUNK) {
    const last = from + CHUNK - 1n;
    const logs = await client.getLogs({
      address: PEAKPUMP_FACTORY,
      event,
      fromBlock: from,
      toBlock: last > head ? head : last,
      strict: true,
    });
    const first = logs[0];
    if (first !== undefined) return first.args.curve;
  }
  return null;
}

const client = RPC_URL === undefined ? null : makeClient(RPC_URL);
const curve = client === null ? null : await resolveCurve(client);

describe.skipIf(client === null || curve === null)("quotes on Arc Testnet", () => {
  // skipIf above is the guarantee that both are set; a zero-address placeholder
  // would only hide a skip that did not happen.
  const read = client as ReadClient;
  const market = curve as Address;

  // feeBps is the market's own snapshot, never the factory default and never
  // packages/shared/fees.ts: those differ on purpose.
  async function marketState() {
    const [feeBps, sold] = await read.multicall({
      contracts: [
        { address: market, abi: CurveAbi, functionName: "feeBps" },
        { address: market, abi: CurveAbi, functionName: "sold" },
      ] as const,
      allowFailure: false,
    });
    return { feeBps: BigInt(feeBps), sold };
  }

  it(
    "charges the buy fee the document names while the buy stays inside the curve",
    async () => {
      const { feeBps } = await marketState();
      const usdcIn6 = 1_000_000n;
      const { quote, status } = await readBuyQuote(read, market, usdcIn6);
      expect(status).toBe("Ok");
      // MATH 6.1's base is usdcIn6 only on this path; 6.4 moves it to spend6 the
      // moment the buy crosses, which is why the assertion is guarded by this.
      expect(quote.crossed).toBe(false);
      expect(quote.fee6).toBe(feeCeil(usdcIn6, feeBps));
      expect(quote.creatorFee6 + quote.protocolFee6).toBe(quote.fee6);
      // MATH 6.4(b)'s integer identity, read off the deployed contract.
      expect(quote.net6).toBe(usdcIn6 - quote.fee6);
      expect(quote.tokensOut).toBeGreaterThan(0n);
    },
    TIMEOUT_MS,
  );

  it(
    "charges the sell fee on gross6 rather than on the tokens presented",
    async () => {
      const { feeBps, sold } = await marketState();
      // Half of what the market has sold is quotable by MATH.md:339. A market
      // that has sold nothing has no meaningful sell quote at all, and this
      // failing on its status says that plainly.
      const { quote, status } = await readSellQuote(read, market, sold / 2n);
      expect(status).toBe("Ok");
      expect(quote.fee6).toBe(feeCeil(quote.gross6, feeBps));
      expect(quote.creatorFee6 + quote.protocolFee6).toBe(quote.fee6);
      expect(quote.usdcOut6).toBe(quote.gross6 - quote.fee6);
    },
    TIMEOUT_MS,
  );

  it(
    "resolves the hand-written getBlockNumber fragment against the deployed multicall3",
    async () => {
      // viem's multicall3Abi omits getBlockNumber, so lib/viem.ts declares the
      // fragment itself, and typechecking it says nothing about what the deployed
      // multicall3 answers. readTokenLive is its only caller now that a quote
      // carries no block number of its own.
      const live = await readTokenLive(read, market, undefined);
      expect(live.blockNumber).toBeGreaterThan(0n);
    },
    TIMEOUT_MS,
  );

  it(
    "assigns the remaining supply on the crossing path and refunds the rest",
    async () => {
      // MATH.md:55 caps a market's total raise at 1e13 six-decimal units, so 1e15
      // exhausts any legal market's remaining supply. Deriving the exact spend
      // here would re-derive section 6.4 in the test that checks it.
      const usdcIn6 = 10n ** 15n;
      const [quote, ts, sold, feeBps, state] = await read.multicall({
        contracts: [
          { address: market, abi: CurveAbi, functionName: "quoteBuy", args: [usdcIn6] },
          { address: market, abi: CurveAbi, functionName: "Ts" },
          { address: market, abi: CurveAbi, functionName: "sold" },
          { address: market, abi: CurveAbi, functionName: "feeBps" },
          { address: market, abi: CurveAbi, functionName: "state" },
        ] as const,
        allowFailure: false,
      });
      // ASCENT. The crossing branch exists in no other phase, so a market that
      // has summited fails here rather than asserting nothing.
      expect(state).toBe(0);
      expect(quote.crossed).toBe(true);
      // Ts and sold come from the same batch as the quote, so this is one block's
      // answer compared with itself. MATH 6.4 assigns tokensOut; it is never
      // recomputed from the curve.
      expect(quote.tokensOut).toBe(ts - sold);
      expect(quote.spend6 + quote.refund6).toBe(usdcIn6);
      expect(quote.spend6).toBeLessThanOrEqual(usdcIn6);
      // feeUsed6 by 6.4, and net6 at spend6 is netNeeded6 exactly by 6.4(b).
      expect(quote.fee6).toBe(quote.spend6 - quote.net6);
      // The same proof gives the ceil identity back with spend6 as its base, so
      // no unit is silently converted into extra fee on this path.
      expect(quote.fee6).toBe(feeCeil(quote.spend6, BigInt(feeBps)));
      expect(quote.creatorFee6 + quote.protocolFee6).toBe(quote.fee6);
    },
    TIMEOUT_MS,
  );

  it(
    "answers a rejected amount with a status and a sentence, not a revert",
    async () => {
      const { sold } = await marketState();
      // MATH.md:343 forbids a revert on either of these, so reaching the
      // assertions at all is half of what this checks.
      const below = await readBuyQuote(read, market, MIN_BUY_6 - 1n);
      expect(below.status).toBe("BelowMinimum");
      expect(below.sentence).toContain("0.001");
      expect(below.quote.tokensOut).toBe(0n);
      const over = await readSellQuote(read, market, sold + 1n);
      expect(over.status).toBe("ExceedsSold");
      // The sentence names the sold figure the same batch returned, which is the
      // whole reason readSellQuote carries it.
      expect(over.sentence).toBe(`Sell at most ${formatTokenAmount(over.sold)} tokens.`);
    },
    TIMEOUT_MS,
  );
});
