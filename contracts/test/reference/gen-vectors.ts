// Generates contracts/test/fixtures/curve-vectors.json: a committed, deterministic
// fixture proving CurveMath.sol and curve.ts agree. Every numeric value is written
// as a decimal STRING because vm.parseJson mis-parses large integers (foundry
// #3754) and our values reach 1e30; the Solidity side reads columns with
// vm.parseJsonStringArray then vm.parseUint. A fixed seed makes a second run
// byte-identical.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  deriveParams,
  splitFee,
  buyQuote,
  sellQuote,
  crossingQuote,
  priceX18,
  marketCap6,
  WAD,
  S_MIN,
  S_MAX,
  R6_MIN,
  R6_MAX,
  R_MIN,
  R_MAX,
} from "./curve.js";

// mulberry32: a small, well-known seeded PRNG. No dependency, fully reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x9e3779b9);

function randWord(): bigint {
  return BigInt(Math.floor(rng() * 4294967296));
}
// 5 words = 160 bits dwarfs the widest span (~1e30 ~ 100 bits), so the modulo
// bias is far below any value the fixture cares about.
function randRange(lo: bigint, hi: bigint): bigint {
  let v = 0n;
  for (let i = 0; i < 5; i++) v = (v << 32n) | randWord();
  return lo + (v % (hi - lo + 1n));
}

interface Inputs {
  S: bigint;
  R6: bigint;
  rX18: bigint;
  feeBps: bigint;
  creatorBps: bigint;
  usdcIn6: bigint;
  tokensIn: bigint;
  remaining: bigint;
}

// Fill a case with plausible trade sizes: a buy of a quarter of the raise, a sell
// and a crossing target of a quarter of Ts (sold never exceeds Ts in ASCENT).
function withTrades(S: bigint, R6: bigint, rX18: bigint, feeBps: bigint, creatorBps: bigint): Inputs {
  const p = deriveParams(S, R6, rX18);
  return { S, R6, rX18, feeBps, creatorBps, usdcIn6: R6 / 4n, tokensIn: p.Ts / 4n, remaining: p.Ts / 4n };
}

const cases: Inputs[] = [];

const S1 = 10n ** 27n; // the preset supply
const r4 = 4n * WAD; // the preset multiple

cases.push(withTrades(S1, 3_000_000_000n, r4, 125n, 30n)); // Basecamp
cases.push(withTrades(S1, 12_000_000_000n, r4, 125n, 30n)); // Ridge
cases.push(withTrades(S1, 60_000_000_000n, r4, 125n, 30n)); // Alpine
cases.push(withTrades(S_MIN, R6_MIN, R_MIN, 125n, 30n)); // smallest legal S, R6, r
cases.push(withTrades(S_MAX, R6_MAX, R_MAX, 125n, 30n)); // largest legal S, R6, r
cases.push(withTrades(S1, 5_000_000_000n, r4, 0n, 0n)); // feeBps == 0
cases.push(withTrades(S1, 5_000_000_000n, r4, 200n, 100n)); // feeBps == 200

// usdcIn6 == 1000 exactly, the documented minimum-trade boundary (MATH 11).
{
  const p = deriveParams(S1, 12_000_000_000n, r4);
  cases.push({ S: S1, R6: 12_000_000_000n, rX18: r4, feeBps: 125n, creatorBps: 30n, usdcIn6: 1000n, tokensIn: p.Ts / 4n, remaining: p.Ts / 4n });
}

// The documented counterexample: r = 20, R6 = 1_000_000_002 gives x0 = 52_631_580
// and Reff6 = R6 + 18 (MATH T8).
cases.push(withTrades(S1, 1_000_000_002n, R_MAX, 125n, 30n));

// At least 210 cases where (r/1e18 - 1) does not divide R6, so Reff6 != R6. With
// r = k*WAD the ceil in x0 rounds up whenever (k-1) does not divide R6, and then
// Reff6 = x0*(k-1) > R6.
for (let i = 0; i < 210; i++) {
  const k = 3n + (BigInt(i) % 18n); // 3..20
  const rX18 = k * WAD;
  let R6 = randRange(R6_MIN, R6_MAX);
  if (R6 % (k - 1n) === 0n) R6 = R6 < R6_MAX ? R6 + 1n : R6 - 1n; // adjacent to a multiple is never a multiple (k-1 >= 2)
  const S = randRange(S_MIN, S_MAX);
  const feeBps = randRange(0n, 200n);
  const creatorBps = feeBps === 0n ? 0n : randRange(0n, feeBps);
  const p = deriveParams(S, R6, rX18);
  cases.push({ S, R6, rX18, feeBps, creatorBps, usdcIn6: randRange(1000n, R6), tokensIn: randRange(1n, p.Ts), remaining: randRange(1n, p.Ts) });
}

// Fill the rest with fully random legal cases across the whole [0,200] fee range.
while (cases.length < 2000) {
  const S = randRange(S_MIN, S_MAX);
  const R6 = randRange(R6_MIN, R6_MAX);
  const rX18 = randRange(R_MIN, R_MAX);
  const feeBps = randRange(0n, 200n);
  const creatorBps = feeBps === 0n ? 0n : randRange(0n, feeBps);
  const p = deriveParams(S, R6, rX18);
  cases.push({ S, R6, rX18, feeBps, creatorBps, usdcIn6: randRange(1000n, R6), tokensIn: randRange(1n, p.Ts), remaining: randRange(1n, p.Ts) });
}

// Columnar layout: one string array per field, all rows parallel. Fixed key order
// so JSON.stringify is deterministic.
const cols: Record<string, string[]> = {
  S: [], R6: [], rX18: [], feeBps: [], creatorBps: [],
  usdcIn6: [], tokensIn: [], remaining: [],
  Ts: [], Tl: [], y0: [], x0: [], y1: [], Reff6: [],
  buyTokensOut: [], buyFee6: [], buyNet6: [],
  sellUsdcOut6: [], sellFee6: [], sellGross6: [],
  crossNetNeeded6: [], crossFeeUsed6: [], crossSpend6: [],
  price: [], mcap: [],
  splitCreatorFee6: [], splitProtocolFee6: [],
};

let nonDividing = 0;
for (const c of cases) {
  const p = deriveParams(c.S, c.R6, c.rX18);
  const bq = buyQuote(p.x0, p.y0, c.usdcIn6, c.feeBps);
  const sq = sellQuote(p.x0, p.y0, c.tokensIn, c.feeBps);
  const cq = crossingQuote(p.x0, p.y1, c.remaining, c.feeBps);
  const sf = splitFee(bq.fee6, c.feeBps, c.creatorBps);
  if (p.Reff6 !== c.R6) nonDividing++;

  cols.S.push(c.S.toString());
  cols.R6.push(c.R6.toString());
  cols.rX18.push(c.rX18.toString());
  cols.feeBps.push(c.feeBps.toString());
  cols.creatorBps.push(c.creatorBps.toString());
  cols.usdcIn6.push(c.usdcIn6.toString());
  cols.tokensIn.push(c.tokensIn.toString());
  cols.remaining.push(c.remaining.toString());
  cols.Ts.push(p.Ts.toString());
  cols.Tl.push(p.Tl.toString());
  cols.y0.push(p.y0.toString());
  cols.x0.push(p.x0.toString());
  cols.y1.push(p.y1.toString());
  cols.Reff6.push(p.Reff6.toString());
  cols.buyTokensOut.push(bq.tokensOut.toString());
  cols.buyFee6.push(bq.fee6.toString());
  cols.buyNet6.push(bq.net6.toString());
  cols.sellUsdcOut6.push(sq.usdcOut6.toString());
  cols.sellFee6.push(sq.fee6.toString());
  cols.sellGross6.push(sq.gross6.toString());
  cols.crossNetNeeded6.push(cq.netNeeded6.toString());
  cols.crossFeeUsed6.push(cq.feeUsed6.toString());
  cols.crossSpend6.push(cq.spend6.toString());
  cols.price.push(priceX18(p.x0, p.y0).toString());
  cols.mcap.push(marketCap6(p.x0, p.y0, c.S).toString());
  cols.splitCreatorFee6.push(sf.creatorFee6.toString());
  cols.splitProtocolFee6.push(sf.protocolFee6.toString());
}

// Guard the generator against silently emitting a degenerate fixture.
const y0Preset = "1066666666666666666666666666";
if (cols.y0[0] !== y0Preset) throw new Error(`preset y0 drifted: ${cols.y0[0]}`);
if (cols.x0[8] !== "52631580" || cols.Reff6[8] !== (1_000_000_002n + 18n).toString()) {
  throw new Error(`counterexample drifted: x0=${cols.x0[8]} Reff6=${cols.Reff6[8]}`);
}
if (nonDividing < 200) throw new Error(`only ${nonDividing} Reff6!=R6 cases, need >= 200`);

const outPath = resolve(dirname(process.argv[1]), "..", "fixtures", "curve-vectors.json");
writeFileSync(outPath, JSON.stringify(cols));
console.log(`wrote ${cases.length} cases (${nonDividing} with Reff6 != R6) to ${outPath}`);
