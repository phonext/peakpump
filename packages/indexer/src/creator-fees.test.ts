import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  CREATOR,
  CURVE,
  CURVE_2,
  TOKEN_2,
  TREASURY,
  TS,
  credited,
  marketCreated,
  marketMetadata,
  trade,
  tradeDetail,
} from "./test-fixtures";

describe("creator fees across several markets", () => {
  it("accumulates the creator total across markets and per token from the credit events", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            // Two markets by the same creator, in separate blocks.
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: `0x${"10".repeat(32)}` }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: `0x${"10".repeat(32)}` }),
            marketCreated(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 0, hash: `0x${"11".repeat(32)}` },
              { curve: CURVE_2, token: TOKEN_2, marketId: 2n },
            ),
            marketMetadata(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 1, hash: `0x${"11".repeat(32)}` },
              { curve: CURVE_2 },
            ),

            // A trade on the first market, with its fee pair behind it.
            trade(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 0, hash: `0x${"12".repeat(32)}` },
              { isBuy: true, usdcIn6: 5_000_000n, tokenOut: 50_000n, fee6: 62_500n },
            ),
            tradeDetail(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 1, hash: `0x${"12".repeat(32)}` },
              { spend6: 5_000_000n },
            ),
            credited(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 2, hash: `0x${"12".repeat(32)}` },
              { to: CREATOR, amount6: 15_000n, reason: 0n },
            ),
            credited(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 3, hash: `0x${"12".repeat(32)}` },
              { to: TREASURY, amount6: 47_500n, reason: 1n },
            ),

            // A trade on the second market, in its own transaction and block.
            trade(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 0, hash: `0x${"13".repeat(32)}` },
              {
                curve: CURVE_2,
                isBuy: true,
                usdcIn6: 8_000_000n,
                tokenOut: 90_000n,
                fee6: 100_000n,
                tReserve6After: 7_900_000n,
                supplySold6After: 90_000n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 1, hash: `0x${"13".repeat(32)}` },
              { spend6: 8_000_000n },
            ),
            credited(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 2, hash: `0x${"13".repeat(32)}` },
              { to: CREATOR, amount6: 24_000n, reason: 0n },
            ),
            credited(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 3, hash: `0x${"13".repeat(32)}` },
              { to: TREASURY, amount6: 76_000n, reason: 1n },
            ),
          ],
        },
      },
    });

    const creator = await indexer.Creator.getOrThrow(CREATOR);
    expect(creator.marketCount).toBe(2);
    expect(creator.totalCreatorFees6).toBe(39_000n);
    expect(creator.claimed6).toBe(0n);

    // The per-token breakdown, from the creator-reason credits of each
    // market's own transaction.
    const tokenOne = await indexer.Token.getOrThrow(CURVE);
    expect(tokenOne.creatorFees6).toBe(15_000n);
    const tokenTwo = await indexer.Token.getOrThrow(CURVE_2);
    expect(tokenTwo.creatorFees6).toBe(24_000n);

    const global = await indexer.Global.getOrThrow("global");
    expect(global.totalMarkets).toBe(2);
    expect(global.totalCreatorFees6).toBe(39_000n);
    expect(global.totalProtocolFees6).toBe(123_500n);

    // Each credit row is attributed to the curve of its own trade.
    const first = await indexer.FeeCredit.getOrThrow(`${BLOCK + 2}-2`);
    expect(first.curve).toBe(CURVE);
    expect(first.recipient).toBe(CREATOR);
    expect(first.reason).toBe(0);
    const second = await indexer.FeeCredit.getOrThrow(`${BLOCK + 3}-2`);
    expect(second.curve).toBe(CURVE_2);
    expect(second.recipient).toBe(CREATOR);
    expect(second.reason).toBe(0);
  });
});
