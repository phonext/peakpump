import { describe, expect, it } from "vitest";
import { MIN_BUY_6 } from "@/lib/curve-quote";
import { type GasBound, type SpendProbe, maxSpend6 } from "@/lib/max-spend";

// What Max may put in the field. The property under test is one inequality: whatever
// this returns, converted to the 18-decimal view msg.value carries, plus the gas the
// probe priced at that amount, still fits inside the balance. Every case below asserts
// it rather than a figure, because the figure is a consequence of the reserve.
const WEI_PER_MICRO = 1_000_000_000_000n;

// The Arc gas-price floor. Nothing here computes a fee bound — the probe stands
// for lib/gas.ts, which is the only place one is composed.
const FLOOR_GWEI = 20_000_000_000n;

function bound(gasUnits: bigint, maxFeePerGas = FLOOR_GWEI): GasBound {
  return { gasUnits, maxFeePerGas };
}

// Every probe records what it was asked, so a case can assert the second pass happened
// and happened at the candidate the first pass produced.
function recording(impl: (usdcIn6: bigint) => GasBound | null): {
  probe: SpendProbe;
  calls: bigint[];
} {
  const calls: bigint[] = [];
  return {
    calls,
    probe: async (usdcIn6) => {
      calls.push(usdcIn6);
      return impl(usdcIn6);
    },
  };
}

function fits(spend6: bigint, nativeWei: bigint, reserve: bigint): void {
  expect(spend6 * WEI_PER_MICRO + reserve).toBeLessThanOrEqual(nativeWei);
}

describe("the balance Max leaves alone", () => {
  it("spends nothing on an empty account", async () => {
    const { probe, calls } = recording(() => bound(200_000n));
    expect(await maxSpend6(0n, probe)).toBe(0n);
    // No estimate is attempted: there is nothing to price.
    expect(calls).toEqual([]);
  });

  it("spends nothing when the first estimate does not answer", async () => {
    // A wallet that cannot afford the floor amount plus its gas cap gets a refusal from
    // eth_estimateGas, and that refusal is the answer.
    const { probe } = recording(() => null);
    expect(await maxSpend6(1_000_000_000_000_000n, probe)).toBe(0n);
  });

  it("spends nothing when the reserve is the whole balance", async () => {
    const reserve = 200_000n * FLOOR_GWEI;
    const { probe, calls } = recording(() => bound(200_000n));
    expect(await maxSpend6(reserve, probe)).toBe(0n);
    // Priced once: the candidate the first reserve leaves is not positive, so there is
    // nothing for a second pass to price.
    expect(calls).toEqual([MIN_BUY_6]);
  });

  it("prices the floor amount first and the candidate it produces second", async () => {
    const nativeWei = 100n * WEI_PER_MICRO * 1_000_000n;
    const { probe, calls } = recording(() => bound(200_000n));
    const spend6 = await maxSpend6(nativeWei, probe);
    const reserve = 200_000n * FLOOR_GWEI;

    expect(calls[0]).toBe(MIN_BUY_6);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe((nativeWei - reserve) / WEI_PER_MICRO);
    // A constant estimate keeps the first reserve, so the answer is the balance less
    // that reserve, floored to a whole micro-USDC.
    expect(spend6).toBe((nativeWei - reserve) / WEI_PER_MICRO);
    fits(spend6, nativeWei, reserve);
  });
});

describe("an estimate that grows between the two passes", () => {
  // The case the second pass exists for: the largest buy a wallet can make is the one
  // that reaches the Summit and runs the crossing path, and that path costs more gas
  // than the floor amount priced.
  const CHEAP = 180_000n;
  const DEAR = 640_000n;

  it("keeps the dearer reserve", async () => {
    const nativeWei = 500n * WEI_PER_MICRO * 1_000_000n;
    const { probe, calls } = recording((usdcIn6) => bound(usdcIn6 === MIN_BUY_6 ? CHEAP : DEAR));
    const spend6 = await maxSpend6(nativeWei, probe);

    expect(calls).toHaveLength(2);
    fits(spend6, nativeWei, DEAR * FLOOR_GWEI);
    // Strictly less than the amount the cheap pass alone would have allowed, which is
    // the whole point of paying for the second estimate.
    expect(spend6).toBeLessThan((nativeWei - CHEAP * FLOOR_GWEI) / WEI_PER_MICRO);
    expect(spend6).toBe((nativeWei - DEAR * FLOOR_GWEI) / WEI_PER_MICRO);
  });

  it("keeps the first reserve when the second pass refuses", async () => {
    const nativeWei = 500n * WEI_PER_MICRO * 1_000_000n;
    const { probe } = recording((usdcIn6) => (usdcIn6 === MIN_BUY_6 ? bound(CHEAP) : null));
    const spend6 = await maxSpend6(nativeWei, probe);
    // A candidate that fits at the cheap branch's price and not at a dearer one is
    // refused by the node, and the reserve already priced stands.
    fits(spend6, nativeWei, CHEAP * FLOOR_GWEI);
    expect(spend6).toBe((nativeWei - CHEAP * FLOOR_GWEI) / WEI_PER_MICRO);
  });

  it("never exceeds the balance across a range of them", async () => {
    for (const units of [1n, 7n, 50n, 999n, 12_345n, 1_000_000n]) {
      const nativeWei = units * 1_000_000n * WEI_PER_MICRO;
      const { probe } = recording((usdcIn6) => bound(usdcIn6 === MIN_BUY_6 ? CHEAP : DEAR));
      const spend6 = await maxSpend6(nativeWei, probe);
      expect(spend6).toBeGreaterThanOrEqual(0n);
      // The reserve that actually applies is the larger one, so the inequality is
      // asserted against it and not against whichever pass answered last.
      fits(spend6, nativeWei, DEAR * FLOOR_GWEI);
    }
  });

  it("floors the answer to a whole micro-USDC", async () => {
    // A balance with a sub-1e12 remainder: the field holds six decimals, so the wei
    // that cannot be expressed there must stay behind rather than be rounded into the
    // amount and sent as a value the balance does not cover.
    const nativeWei = 500n * WEI_PER_MICRO * 1_000_000n + 999_999_999_999n;
    const { probe } = recording(() => bound(CHEAP));
    const spend6 = await maxSpend6(nativeWei, probe);
    fits(spend6, nativeWei, CHEAP * FLOOR_GWEI);
    expect(spend6 * WEI_PER_MICRO).toBeLessThan(nativeWei);
  });
});
