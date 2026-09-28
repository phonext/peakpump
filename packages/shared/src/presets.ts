// The three raise presets (MATH 10). One curve shape — S = 1e27 wei
// (1,000,000,000 tokens) and r = 4e18 for all three — differing only in the
// target raise R6 and the seed reserve x0. These are the raw inputs create()
// takes; the curve derives everything else. Values transcribed from MATH 10 and
// never recomputed here. docs/MATH.md is the mathematical authority.

export const SHARED_SUPPLY = 1_000_000_000_000_000_000_000_000_000n; // 1e27 wei
export const SHARED_MULTIPLE = 4_000_000_000_000_000_000n; // 4e18

export type PresetKey = "basecamp" | "ridge" | "alpine";

export interface Preset {
  key: PresetKey;
  label: string;
  S: bigint;
  R6: bigint;
  rX18: bigint;
  x0: bigint;
  startMarketCapUsd: string;
  targetRaiseUsd: string;
}

export const BASECAMP: Preset = {
  key: "basecamp",
  label: "Basecamp",
  S: SHARED_SUPPLY,
  R6: 3_000_000_000n,
  rX18: SHARED_MULTIPLE,
  x0: 1_000_000_000n,
  startMarketCapUsd: "$937.50",
  targetRaiseUsd: "$15,000",
};

export const RIDGE: Preset = {
  key: "ridge",
  label: "Ridge",
  S: SHARED_SUPPLY,
  R6: 12_000_000_000n,
  rX18: SHARED_MULTIPLE,
  x0: 4_000_000_000n,
  startMarketCapUsd: "$3,750",
  targetRaiseUsd: "$60,000",
};

export const ALPINE: Preset = {
  key: "alpine",
  label: "Alpine",
  S: SHARED_SUPPLY,
  R6: 60_000_000_000n,
  rX18: SHARED_MULTIPLE,
  x0: 20_000_000_000n,
  startMarketCapUsd: "$18,750",
  targetRaiseUsd: "$300,000",
};

export const PRESETS: readonly Preset[] = [BASECAMP, RIDGE, ALPINE];

// Ridge start price = mulDiv(4e9, 1e30, y0) / 1e18 = 0.00000375 USDC per whole
// token (MATH 10). UI copy references this constant instead of retyping it.
export const RIDGE_START_PRICE = "0.00000375";
