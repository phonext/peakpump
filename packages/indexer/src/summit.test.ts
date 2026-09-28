import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  CURVE,
  TOKEN,
  TS,
  marketCreated,
  marketMetadata,
  summit,
  trade,
  tradeDetail,
  transfer,
} from "./test-fixtures";

const CREATE_TX = `0x${"aa".repeat(32)}`;

// y0 900_000, S 1_000_000, Ts 600_000 (the marketCreated defaults are
// overridden so the PEAK branch's y = S - Ts comes out round).
function createMarket() {
  return [
    marketCreated(
      { block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX },
      { y0: 900_000n, tSupply6: 1_000_000n, tSummit6: 600_000n },
    ),
    marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX }),
  ];
}

describe("summit", () => {
  it("copies raised6, y and priceX18 from the Summit event, never recomputing", async () => {
    const indexer = createTestIndexer();
    const CROSS_TX = `0x${"bb".repeat(32)}`;

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            ...createMarket(),
            // The crossing buy: sold reaches Ts and the phase turns to PEAK.
            trade(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 0, hash: CROSS_TX },
              {
                isBuy: true,
                usdcIn6: 20_000_000n,
                tokenOut: 600_000n,
                fee6: 250_000n,
                tReserve6After: 20_000_000n,
                supplySold6After: 600_000n,
                phaseAfter: 1n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 1, hash: CROSS_TX },
              { spend6: 20_000_000n, poolDelta6: 19_750_000n, crossed: true, stateAfter: 1n },
            ),
            transfer(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 2, hash: CROSS_TX },
              CURVE,
              "0x2222222222222222222222222222222222222222",
              600_000n,
            ),
            summit(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 3, hash: CROSS_TX },
              // priceX18 sits one above the reserves' ratio on purpose: the
              // handler must copy the event, and a fixture where the two agree
              // cannot tell copying from recomputing.
              { raised6: 19_750_000n, y: 400_000n, priceX18: 10n ** 31n + 1n },
            ),
          ],
        },
      },
    });

    const token = await indexer.Token.getOrThrow(CURVE);
    expect(token.phase).toBe(1);
    expect(token.raised6).toBe(19_750_000n);
    expect(token.y).toBe(400_000n);
    expect(token.priceX18).toBe(10n ** 31n + 1n);

    // The crossing trade's own candle prices on the PEAK branch:
    // y = S - sold = 400_000, price = 20_000_000 * 1e30 / 400_000 = 5e31.
    const candle = await indexer.Candle.getOrThrow(
      `${TOKEN}-1m-${(BigInt(TS + 10) / 60n) * 60n}`,
    );
    expect(candle.close).toBe(5n * 10n ** 31n);
    expect(candle.open).toBe(5n * 10n ** 31n);
  });
});
