import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  splitFee,
  formatFeeBps,
  TRADE_FEE_BPS,
  CREATOR_BPS,
  PROTOCOL_BPS,
  LP_BPS,
  FEE_SPLIT_SUMS,
  CREATION_FEE_6,
} from "../src/fees";

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../contracts/test/fixtures/curve-vectors.json",
);
const cols = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, string[]>;
const N = cols.S!.length;
function b(col: string, i: number): bigint {
  return BigInt(cols[col]![i]!);
}

describe("splitFee (re-export of the frozen reference)", () => {
  it("matches the fixture split columns on every row", () => {
    for (let i = 0; i < N; i++) {
      const s = splitFee(b("buyFee6", i), b("feeBps", i), b("creatorBps", i));
      expect(s.creatorFee6).toBe(b("splitCreatorFee6", i));
      expect(s.protocolFee6).toBe(b("splitProtocolFee6", i));
      // Top-down: the two shares always sum back to the input fee.
      expect(s.creatorFee6 + s.protocolFee6).toBe(b("buyFee6", i));
    }
  });

  it("short-circuits to zero shares when the fee is zero", () => {
    expect(splitFee(0n, 0n, 0n)).toEqual({ creatorFee6: 0n, protocolFee6: 0n });
  });
});

describe("fee constants", () => {
  it("split sums to the total (the module-init invariant held)", () => {
    expect(FEE_SPLIT_SUMS).toBe(true);
    expect(CREATOR_BPS + PROTOCOL_BPS).toBe(TRADE_FEE_BPS);
    expect(TRADE_FEE_BPS).toBe(125n);
    expect(CREATOR_BPS).toBe(30n);
    expect(PROTOCOL_BPS).toBe(95n);
    expect(LP_BPS).toBe(0n);
  });

  it("testnet creation fee is zero (static copy only; live value read from factory)", () => {
    expect(CREATION_FEE_6).toBe(0n);
  });
});

describe("formatFeeBps", () => {
  it("renders the trade fee as 1.25%", () => {
    expect(formatFeeBps(TRADE_FEE_BPS)).toBe("1.25%");
  });

  it("trims trailing fractional zeros and whole percents", () => {
    expect(formatFeeBps(30n)).toBe("0.3%");
    expect(formatFeeBps(95n)).toBe("0.95%");
    expect(formatFeeBps(200n)).toBe("2%");
    expect(formatFeeBps(0n)).toBe("0%");
    expect(formatFeeBps(1000n)).toBe("10%");
  });
});
