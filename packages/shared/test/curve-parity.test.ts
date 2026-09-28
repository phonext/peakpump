import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as shared from "../src/curve";
import * as reference from "../../../contracts/test/reference/curve";

// The shared curve.ts is a byte-for-byte promotion of the frozen
// reference curve.ts (plus the appended maxDevBuy6). This proves the promotion
// stayed faithful two ways at once: every exported function of the shared copy
// agrees with the reference copy, AND both agree with the committed differential
// fixture that also pins CurveMath.sol. All values are stored as decimal strings
// (vm.parseJson mis-parses large integers) and parsed String -> BigInt here.

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../contracts/test/fixtures/curve-vectors.json",
);
const cols = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, string[]>;
const N = cols.S!.length;

function b(col: string, i: number): bigint {
  return BigInt(cols[col]![i]!);
}

describe("curve parity: shared vs reference vs fixture", () => {
  it(`covers ${N} fixture cases`, () => {
    expect(N).toBe(2000);
  });

  it("agrees on every function of every row", () => {
    for (let i = 0; i < N; i++) {
      const S = b("S", i);
      const R6 = b("R6", i);
      const rX18 = b("rX18", i);
      const feeBps = b("feeBps", i);
      const creatorBps = b("creatorBps", i);
      const usdcIn6 = b("usdcIn6", i);
      const tokensIn = b("tokensIn", i);
      const remaining = b("remaining", i);

      const ds = shared.deriveParams(S, R6, rX18);
      const dr = reference.deriveParams(S, R6, rX18);

      // shared vs reference, every derived field
      expect(ds).toEqual(dr);

      // shared vs fixture, every derived field
      expect(ds.Ts).toBe(b("Ts", i));
      expect(ds.Tl).toBe(b("Tl", i));
      expect(ds.y0).toBe(b("y0", i));
      expect(ds.x0).toBe(b("x0", i));
      expect(ds.y1).toBe(b("y1", i));
      expect(ds.Reff6).toBe(b("Reff6", i));

      const bqs = shared.buyQuote(ds.x0, ds.y0, usdcIn6, feeBps);
      expect(bqs).toEqual(reference.buyQuote(ds.x0, ds.y0, usdcIn6, feeBps));
      expect(bqs.tokensOut).toBe(b("buyTokensOut", i));
      expect(bqs.fee6).toBe(b("buyFee6", i));
      expect(bqs.net6).toBe(b("buyNet6", i));

      const sqs = shared.sellQuote(ds.x0, ds.y0, tokensIn, feeBps);
      expect(sqs).toEqual(reference.sellQuote(ds.x0, ds.y0, tokensIn, feeBps));
      expect(sqs.usdcOut6).toBe(b("sellUsdcOut6", i));
      expect(sqs.fee6).toBe(b("sellFee6", i));
      expect(sqs.gross6).toBe(b("sellGross6", i));

      const cqs = shared.crossingQuote(ds.x0, ds.y1, remaining, feeBps);
      expect(cqs).toEqual(reference.crossingQuote(ds.x0, ds.y1, remaining, feeBps));
      expect(cqs.netNeeded6).toBe(b("crossNetNeeded6", i));
      expect(cqs.feeUsed6).toBe(b("crossFeeUsed6", i));
      expect(cqs.spend6).toBe(b("crossSpend6", i));

      const price = shared.priceX18(ds.x0, ds.y0);
      expect(price).toBe(reference.priceX18(ds.x0, ds.y0));
      expect(price).toBe(b("price", i));

      const mcap = shared.marketCap6(ds.x0, ds.y0, S);
      expect(mcap).toBe(reference.marketCap6(ds.x0, ds.y0, S));
      expect(mcap).toBe(b("mcap", i));

      const sf = shared.splitFee(bqs.fee6, feeBps, creatorBps);
      expect(sf).toEqual(reference.splitFee(bqs.fee6, feeBps, creatorBps));
      expect(sf.creatorFee6).toBe(b("splitCreatorFee6", i));
      expect(sf.protocolFee6).toBe(b("splitProtocolFee6", i));
    }
  });
});
