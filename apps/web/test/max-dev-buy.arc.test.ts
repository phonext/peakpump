import { maxDevBuy6 } from "@peakpump/shared/curve";
import { PRESETS } from "@peakpump/shared/presets";
import { arcTestnet } from "@peakpump/shared/chain";
import { createPublicClient, fallback, http } from "viem";
import { describe, expect, it } from "vitest";
import { readMaxDevBuy } from "@/hooks/useMaxDevBuy";
import { readCreateParams } from "@/lib/factory-reads";
import type { ReadClient } from "@/lib/viem";

// The endpoint is the operator's, so a local node or a private URL works without
// editing this file. No literal is written here: only
// packages/shared/src/chain.ts may declare one.
const RPC_URL = process.env.ARC_RPC_URL;

// A handful of round trips against a public node, over vitest's 5 s default.
const TIMEOUT_MS = 20_000;

function makeClient(url: string): ReadClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: fallback([http(url, { batch: true })]),
    batch: { multicall: true },
  });
}

const client = RPC_URL === undefined ? null : makeClient(RPC_URL);

// The cap depends on the fee a new market inherits, and setDefaultFees can move
// that while the form is open, so the fee is read live rather than taken from
// packages/shared/fees — the same reason useMaxDevBuy composes useCreateParams.
const params = client === null ? null : await readCreateParams(client);

describe.skipIf(client === null || params === null)("the dev-buy cap on Arc Testnet", () => {
  // skipIf above is the guarantee that both are set; the reads below stay inside
  // the tests because a skipped suite's body still runs at collection time.
  const read = client as ReadClient;

  it(
    "answers the shared pure twin exactly, on every preset",
    async () => {
      const feeBps = BigInt((params as { defaultFeeBps: number }).defaultFeeBps);
      for (const preset of PRESETS) {
        // The factory view is the number the form shows; the shared twin exists
        // for exactly this comparison, so a difference is the finding either way.
        const live = await readMaxDevBuy(read, preset.S, preset.R6, preset.rX18, feeBps);
        expect(live, preset.key).toBe(maxDevBuy6(preset.S, preset.R6, preset.rX18, feeBps));
      }
    },
    TIMEOUT_MS,
  );

  it(
    "answers the shared pure twin exactly, on custom triples across the bounds",
    async () => {
      const feeBps = BigInt((params as { defaultFeeBps: number }).defaultFeeBps);
      const CUSTOMS: readonly { label: string; S: bigint; R6: bigint; rX18: bigint }[] = [
        // The middle of the box: the create flow's own worked example.
        { label: "a mid-box triple", S: 5_000_000n * 10n ** 18n, R6: 5_000n * 10n ** 6n, rX18: 5n * 10n ** 18n },
        // The far corner, where the down-walk's floor is most likely to bite.
        {
          label: "the upper corner of MATH 3",
          S: 1_000_000_000_000n * 10n ** 18n,
          R6: 10_000_000n * 10n ** 6n,
          rX18: 20n * 10n ** 18n,
        },
        // The floor corner with the maximum multiple, and a fractional multiple
        // whose rX18 the contract accepts as-is.
        { label: "the floor with the maximum multiple", S: 1_000_000n * 10n ** 18n, R6: 1_000n * 10n ** 6n, rX18: 20n * 10n ** 18n },
        { label: "a fractional multiple", S: 1_000_000_000n * 10n ** 18n, R6: 1_000_000n * 10n ** 6n, rX18: 7_500_000_000_000_000_000n },
      ];
      for (const triple of CUSTOMS) {
        const live = await readMaxDevBuy(read, triple.S, triple.R6, triple.rX18, feeBps);
        expect(live, triple.label).toBe(maxDevBuy6(triple.S, triple.R6, triple.rX18, feeBps));
      }
    },
    TIMEOUT_MS,
  );

  it(
    "is a cap a dev-buy can actually sit under, and not zero",
    async () => {
      // Ts/20 of a market that has sold nothing is strictly positive for every
      // in-bounds triple, so a zero here would mean the view and the twin agree
      // on a number neither should have produced.
      const basecamp = PRESETS[0];
      if (basecamp === undefined) throw new Error("unreachable, PRESETS is pinned at three by its own test");
      const feeBps = BigInt((params as { defaultFeeBps: number }).defaultFeeBps);
      const live = await readMaxDevBuy(read, basecamp.S, basecamp.R6, basecamp.rX18, feeBps);
      expect(live).toBeGreaterThan(0n);
    },
    TIMEOUT_MS,
  );
});
