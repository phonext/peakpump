import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  deriveParams,
  buyQuote,
  sellQuote,
  crossingQuote,
  priceX18,
  marketCap6,
  maxDevBuy6,
} from "../src/curve";
import { PRESETS } from "../src/presets";
import { TRADE_FEE_BPS } from "../src/fees";

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../contracts/test/fixtures/curve-vectors.json",
);
const cols = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, string[]>;
const N = cols.S!.length;
function b(col: string, i: number): bigint {
  return BigInt(cols[col]![i]!);
}

// deriveParams and the four quotes are proven exhaustively against the fixture in
// curve-parity.test.ts. Here we spot-check the derived params against the MATH 10
// presets directly, and cover maxDevBuy6 (which has no fixture column) by its
// defining boundary property.

describe("deriveParams on the MATH 10 presets", () => {
  // The fixture's first three rows are Basecamp, Ridge, Alpine in order.
  it("matches the fixture's preset rows for x0, Ts and y0", () => {
    PRESETS.forEach((preset, i) => {
      const d = deriveParams(preset.S, preset.R6, preset.rX18);
      expect(d.x0).toBe(preset.x0);
      expect(d.x0).toBe(b("x0", i));
      expect(d.Ts).toBe(b("Ts", i));
      expect(d.y0).toBe(b("y0", i));
    });
  });

  it("derives the documented Ridge start price 0.00000375 USDC", () => {
    const ridge = PRESETS[1]!;
    const d = deriveParams(ridge.S, ridge.R6, ridge.rX18);
    // priceX18 is USDC-per-whole-token scaled by 1e18; 3.75e-6 * 1e18 = 3_750_000_000_000.
    expect(priceX18(d.x0, d.y0)).toBe(3_750_000_000_000n);
  });
});

// maxDevBuy6 returns the largest usdcIn6 whose first buy still satisfies the
// step-9 cap sold*20 <= Ts. The defining property: cand passes the cap and
// cand+1 does not.
function assertDevBuyBoundary(S: bigint, R6: bigint, rX18: bigint, feeBps: bigint): void {
  const d = deriveParams(S, R6, rX18);
  const cand = maxDevBuy6(S, R6, rX18, feeBps);
  expect(cand > 0n).toBe(true);
  expect(buyQuote(d.x0, d.y0, cand, feeBps).tokensOut * 20n <= d.Ts).toBe(true);
  expect(buyQuote(d.x0, d.y0, cand + 1n, feeBps).tokensOut * 20n <= d.Ts).toBe(false);
}

describe("maxDevBuy6 boundary property", () => {
  it("holds for every preset at the 125 bps trade fee", () => {
    for (const preset of PRESETS) {
      assertDevBuyBoundary(preset.S, preset.R6, preset.rX18, TRADE_FEE_BPS);
    }
  });

  it("holds for sampled fixture rows across the legal fee range", () => {
    for (let i = 0; i < N; i += 97) {
      assertDevBuyBoundary(b("S", i), b("R6", i), b("rX18", i), b("feeBps", i));
    }
  });
});

// A couple of direct MATH sanity anchors so a change to a quote can't pass by
// only re-deriving from the same wrong deriveParams.
describe("quote sanity on Basecamp", () => {
  const bc = PRESETS[0]!;
  const d = deriveParams(bc.S, bc.R6, bc.rX18);

  it("a buy takes a 125 bps ceil fee and returns positive tokens", () => {
    const q = buyQuote(d.x0, d.y0, 750_000_000n, 125n);
    expect(q.fee6).toBe(9_375_000n);
    expect(q.net6).toBe(740_625_000n);
    expect(q.tokensOut > 0n).toBe(true);
  });

  it("a crossing spend equals net needed plus its fee", () => {
    const c = crossingQuote(d.x0, d.y1, d.Ts / 4n, 125n);
    expect(c.spend6).toBe(c.netNeeded6 + c.feeUsed6);
  });

  it("a sell loses the gross, keeps usdcOut = gross - fee", () => {
    const s = sellQuote(d.x0, d.y0, d.Ts / 4n, 125n);
    expect(s.usdcOut6).toBe(s.gross6 - s.fee6);
  });

  it("market cap is positive", () => {
    expect(marketCap6(d.x0, d.y0, bc.S) > 0n).toBe(true);
  });
});
