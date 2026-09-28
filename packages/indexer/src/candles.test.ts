import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  CURVE,
  TOKEN,
  marketCreated,
  marketMetadata,
  trade,
} from "./test-fixtures";

const CREATE_TX = `0x${"01".repeat(32)}`;

// A base timestamp exactly on a minute boundary, so the bucket arithmetic
// below is legible: 1771000080 = 29516668 * 60.
const T = 1_771_000_080;

// y0 is the marketCreated default 1_000_000, so in ASCENT
// y = 1_000_000 - sold and every price below is x * 1e30 / y.
function tradeAt(
  offset: number,
  p: { isBuy: boolean; usdcLeg: bigint; tReserve6After: bigint; supplySold6After: bigint },
) {
  const block = BLOCK + 1;
  const hash = `0x${(offset + 0x10).toString(16).padStart(2, "0").repeat(32)}`;
  return trade(
    { block, timestamp: T + offset, logIndex: offset, hash },
    {
      isBuy: p.isBuy,
      usdcIn6: p.isBuy ? p.usdcLeg : 0n,
      usdcOut6: p.isBuy ? 0n : p.usdcLeg,
      tReserve6After: p.tReserve6After,
      supplySold6After: p.supplySold6After,
    },
  );
}

describe("candle bucketing", () => {
  it("aggregates the four intervals on their own boundaries and never backfills a gap", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            marketCreated({ block: BLOCK, timestamp: T, logIndex: 0, hash: CREATE_TX }),
            marketMetadata({ block: BLOCK, timestamp: T, logIndex: 1, hash: CREATE_TX }),
            // +2 and +50 share the first minute bucket; prices 1e30 then 3e30.
            tradeAt(2, { isBuy: true, usdcLeg: 1_000_000n, tReserve6After: 900_000n, supplySold6After: 100_000n }),
            tradeAt(50, { isBuy: true, usdcLeg: 2_000_000n, tReserve6After: 2_400_000n, supplySold6After: 200_000n }),
            // +61 and +70 land in the next minute bucket, both at 2e30.
            tradeAt(61, { isBuy: false, usdcLeg: 1_000_000n, tReserve6After: 1_700_000n, supplySold6After: 150_000n }),
            tradeAt(70, { isBuy: false, usdcLeg: 500_000n, tReserve6After: 1_500_000n, supplySold6After: 250_000n }),
            // +290 is 5 minutes in: its own minute bucket and its own
            // five-minute bucket, at 3e30.
            tradeAt(290, { isBuy: true, usdcLeg: 3_000_000n, tReserve6After: 2_100_000n, supplySold6After: 300_000n }),
          ],
        },
      },
    });

    const E30 = 10n ** 30n;

    // 1m: [1771000080, 1771000140) holds trades at +2 and +50.
    const m1 = await indexer.Candle.getOrThrow(`${TOKEN}-1m-1771000080`);
    expect(m1.open).toBe(1n * E30);
    expect(m1.high).toBe(3n * E30);
    expect(m1.low).toBe(1n * E30);
    expect(m1.close).toBe(3n * E30);
    expect(m1.volume6).toBe(3_000_000n);
    expect(m1.tradeCount).toBe(2);

    // 1m: [1771000140, 1771000200) holds +61 and +70, both at 2e30.
    const m2 = await indexer.Candle.getOrThrow(`${TOKEN}-1m-1771000140`);
    expect(m2.open).toBe(2n * E30);
    expect(m2.high).toBe(2n * E30);
    expect(m2.low).toBe(2n * E30);
    expect(m2.close).toBe(2n * E30);
    expect(m2.volume6).toBe(1_500_000n);
    expect(m2.tradeCount).toBe(2);

    // 1m: +290 opens its own bucket at 1771000320.
    const m3 = await indexer.Candle.getOrThrow(`${TOKEN}-1m-1771000320`);
    expect(m3.open).toBe(3n * E30);
    expect(m3.close).toBe(3n * E30);
    expect(m3.volume6).toBe(3_000_000n);
    expect(m3.tradeCount).toBe(1);

    // The skipped minute [1771000200, 1771000260) has no trade, so no candle:
    // empty buckets are never backfilled. Nor does one exist before the first
    // trade.
    expect(await indexer.Candle.get(`${TOKEN}-1m-1771000200`)).toBeUndefined();
    expect(await indexer.Candle.get(`${TOKEN}-1m-1771000020`)).toBeUndefined();

    // 5m: everything up to +70 sits in [1770999900, 1771000200).
    const f1 = await indexer.Candle.getOrThrow(`${TOKEN}-5m-1770999900`);
    expect(f1.open).toBe(1n * E30);
    expect(f1.high).toBe(3n * E30);
    expect(f1.low).toBe(1n * E30);
    expect(f1.close).toBe(2n * E30);
    expect(f1.volume6).toBe(4_500_000n);
    expect(f1.tradeCount).toBe(4);

    const f2 = await indexer.Candle.getOrThrow(`${TOKEN}-5m-1771000200`);
    expect(f2.open).toBe(3n * E30);
    expect(f2.volume6).toBe(3_000_000n);
    expect(f2.tradeCount).toBe(1);

    // 1h and 1d hold all five trades.
    const h1 = await indexer.Candle.getOrThrow(`${TOKEN}-1h-1770998400`);
    expect(h1.open).toBe(1n * E30);
    expect(h1.high).toBe(3n * E30);
    expect(h1.low).toBe(1n * E30);
    expect(h1.close).toBe(3n * E30);
    expect(h1.volume6).toBe(7_500_000n);
    expect(h1.tradeCount).toBe(5);

    const d1 = await indexer.Candle.getOrThrow(`${TOKEN}-1d-1770940800`);
    expect(d1.open).toBe(1n * E30);
    expect(d1.close).toBe(3n * E30);
    expect(d1.volume6).toBe(7_500_000n);
    expect(d1.tradeCount).toBe(5);

    // Every interval exists for this market and no fifth interval does.
    const allCandles = await indexer.Candle.getAll();
    const intervals = new Set(allCandles.map((row) => row.interval));
    expect(intervals).toEqual(new Set(["1m", "5m", "1h", "1d"]));

    // Token aggregates follow the USDC leg.
    const token = await indexer.Token.getOrThrow(CURVE);
    expect(token.tradeCount).toBe(5);
    expect(token.volume6).toBe(7_500_000n);
    expect(token.priceX18).toBe(3n * E30);
  });
});
