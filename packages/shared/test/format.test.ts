import { describe, expect, it } from "vitest";

import {
  formatUsdc6,
  formatUsdcWei,
  formatTokenAmount,
  formatPriceX18,
  formatMarketCap,
  formatPercent,
  formatAddress,
  formatTimeAgo,
  estimateGasUsdc,
  toMicroFloor,
} from "../src/format";
import { RIDGE_START_PRICE } from "../src/presets";

describe("formatUsdc6", () => {
  it("groups thousands and trims trailing zeros", () => {
    expect(formatUsdc6(15_000_000_000n)).toBe("15,000");
    expect(formatUsdc6(1_234_560n)).toBe("1.23456");
    expect(formatUsdc6(0n)).toBe("0");
  });

  it("keeps full precision past 2^53 (never coerced through Number)", () => {
    // intPart = 9007199254740993 = 2^53 + 1, not representable as a double.
    expect(formatUsdc6(9_007_199_254_740_993_000_000n)).toBe("9,007,199,254,740,993");
  });
});

describe("formatUsdcWei", () => {
  it("renders 18-dec native USDC capped at 6 fractional digits (truncating)", () => {
    expect(formatUsdcWei(1_000_000_000_000_000_000n)).toBe("1");
    expect(formatUsdcWei(1_500_000_000_000_000_000n)).toBe("1.5");
    // 7 fractional digits of significance -> truncated to 6, never rounded up.
    expect(formatUsdcWei(1_234_567_800_000_000_000n)).toBe("1.234567");
  });
});

describe("formatTokenAmount", () => {
  it("renders 18-dec token wei capped at 4 fractional digits", () => {
    expect(formatTokenAmount(1_000_000_000_000_000_000n)).toBe("1");
    expect(formatTokenAmount(2_500_100_000_000_000_000n)).toBe("2.5001");
    expect(formatTokenAmount(453_859_964_093_357_271_095_152_602n)).toBe("453,859,964.0933");
  });
});

describe("formatPriceX18", () => {
  it("renders the Ridge start price as plain fixed decimal", () => {
    expect(formatPriceX18(3_750_000_000_000n)).toBe(RIDGE_START_PRICE);
    expect(RIDGE_START_PRICE).toBe("0.00000375");
  });
});

describe("formatMarketCap", () => {
  it("prefixes a dollar sign and caps at two fractional digits", () => {
    expect(formatMarketCap(15_000_000_000n)).toBe("$15,000");
    expect(formatMarketCap(937_500_000n)).toBe("$937.5");
  });
});

describe("formatPercent", () => {
  it("renders basis-point-scaled percents to one fractional digit", () => {
    expect(formatPercent(4210n)).toBe("42.1%");
    expect(formatPercent(10_000n)).toBe("100%");
  });
});

describe("formatAddress", () => {
  it("shortens to leading 6 and trailing 4", () => {
    expect(formatAddress("0xfEe1000000000000000000000000000000007a1e")).toBe("0xfEe1…7a1e");
  });
});

describe("formatTimeAgo", () => {
  it("differences two bigint second-timestamps without ordering by them", () => {
    expect(formatTimeAgo(100n, 130n)).toBe("30s ago");
    expect(formatTimeAgo(100n, 400n)).toBe("5m ago");
    expect(formatTimeAgo(0n, 7_200n)).toBe("2h ago");
    expect(formatTimeAgo(0n, 172_800n)).toBe("2d ago");
    // Arc timestamps are non-decreasing only; a backwards delta clamps to 0.
    expect(formatTimeAgo(500n, 100n)).toBe("0s ago");
  });
});

describe("estimateGasUsdc", () => {
  it("formats gasUnits * maxFeePerGas as native USDC wei", () => {
    // 100000 gas * 20 gwei = 2e15 wei = 0.002 USDC.
    expect(estimateGasUsdc(100_000n, 20_000_000_000n)).toBe("0.002");
  });
});

describe("toMicroFloor", () => {
  it("floors native wei to whole 6-dec micro-USDC", () => {
    expect(toMicroFloor(1_999_999_999_999n)).toBe(1n);
    expect(toMicroFloor(1_500_000_000_000_000_000n)).toBe(1_500_000n);
  });

  it("round-trips so the Max button shows exactly what it sends", () => {
    const wei = 1_500_000_000_000_000_000n;
    expect(formatUsdc6(toMicroFloor(wei))).toBe(formatUsdcWei(wei));
  });
});
