import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  TOKEN,
  TS,
  TRADER_B,
  marketCreated,
  marketMetadata,
  trade,
  tradeDetail,
  transfer,
} from "./test-fixtures";

const CREATE_TX = `0x${"33".repeat(32)}`;

// A market with no dev-buy, so every position below starts clean.
function createMarket() {
  return [
    marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX }),
    marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX }),
  ];
}

describe("position round trip", () => {
  it("tracks weighted average cost basis and PnL net of both legs' fees", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            ...createMarket(),
            // Buy 100_000 tokens for 5_000_000 USDC-6, fee 62_500.
            trade(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 0, hash: `0x${"44".repeat(32)}` },
              {
                trader: TRADER_B,
                isBuy: true,
                usdcIn6: 5_000_000n,
                tokenOut: 100_000n,
                fee6: 62_500n,
                tReserve6After: 4_937_500n,
                supplySold6After: 100_000n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 1, hash: `0x${"44".repeat(32)}` },
              { trader: TRADER_B, to: TRADER_B, spend6: 5_000_000n, poolDelta6: 4_937_500n },
            ),
            // Partial sell: 30_000 tokens back for 1_800_000, fee 22_500.
            trade(
              { block: BLOCK + 2, timestamp: TS + 40, logIndex: 0, hash: `0x${"55".repeat(32)}` },
              {
                trader: TRADER_B,
                isBuy: false,
                usdcOut6: 1_800_000n,
                tokenIn: 30_000n,
                fee6: 22_500n,
                tReserve6After: 3_137_500n,
                supplySold6After: 70_000n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 2, timestamp: TS + 40, logIndex: 1, hash: `0x${"55".repeat(32)}` },
              { trader: TRADER_B, spend6: 0n, poolDelta6: 1_822_500n },
            ),
            // Final sell: the remaining 70_000 for 3_600_000, fee 45_000.
            trade(
              { block: BLOCK + 3, timestamp: TS + 90, logIndex: 0, hash: `0x${"66".repeat(32)}` },
              {
                trader: TRADER_B,
                isBuy: false,
                usdcOut6: 3_600_000n,
                tokenIn: 70_000n,
                fee6: 45_000n,
                tReserve6After: 0n,
                supplySold6After: 0n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 3, timestamp: TS + 90, logIndex: 1, hash: `0x${"66".repeat(32)}` },
              { trader: TRADER_B, spend6: 0n, poolDelta6: 3_645_000n },
            ),
          ],
        },
      },
    });

    const position = await indexer.Position.getOrThrow(`${TOKEN}-${TRADER_B}`);
    expect(position.tokensHeld).toBe(0n);
    expect(position.costBasis6).toBe(0n);
    // Partial sell removes 5_000_000 * 30_000/100_000 = 1_500_000 of basis for
    // 1_800_000 out; the final sell removes the remaining 3_500_000 for
    // 3_600_000 out. Realised is net of removed basis; the fees live in
    // feePaid6 rather than reducing realised again.
    expect(position.realised6).toBe(400_000n);
    expect(position.feePaid6).toBe(130_000n);
    expect(position.buys).toBe(1);
    expect(position.sells).toBe(2);
  });

  it("survives a sell of tokens that arrived by P2P transfer, realising full proceeds", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            ...createMarket(),
            // TRADER_A buys 200_000 tokens.
            trade(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 0, hash: `0x${"77".repeat(32)}` },
              {
                isBuy: true,
                usdcIn6: 10_000_000n,
                tokenOut: 200_000n,
                fee6: 125_000n,
                tReserve6After: 9_875_000n,
                supplySold6After: 200_000n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 1, timestamp: TS + 12, logIndex: 1, hash: `0x${"77".repeat(32)}` },
              { spend6: 10_000_000n, poolDelta6: 9_875_000n },
            ),
            // A P2P transfer moves the tokens to TRADER_C. Holder follows it;
            // Position does not (Position is trade-derived), so TRADER_C's
            // position is empty when the tokens arrive.
            transfer(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 0, hash: `0x${"88".repeat(32)}` },
              "0x2222222222222222222222222222222222222222",
              "0x4444444444444444444444444444444444444444",
              200_000n,
            ),
            // TRADER_C sells all of it. No cost basis to remove, so the full
            // proceeds are realised and nothing throws.
            trade(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 0, hash: `0x${"99".repeat(32)}` },
              {
                trader: "0x4444444444444444444444444444444444444444",
                isBuy: false,
                usdcOut6: 9_000_000n,
                tokenIn: 200_000n,
                fee6: 112_500n,
                tReserve6After: 887_500n,
                supplySold6After: 0n,
              },
            ),
            tradeDetail(
              { block: BLOCK + 3, timestamp: TS + 60, logIndex: 1, hash: `0x${"99".repeat(32)}` },
              { trader: "0x4444444444444444444444444444444444444444", spend6: 0n },
            ),
          ],
        },
      },
    });

    const sold = await indexer.Position.getOrThrow(
      `${TOKEN}-0x4444444444444444444444444444444444444444`,
    );
    expect(sold.realised6).toBe(9_000_000n);
    expect(sold.costBasis6).toBe(0n);
    expect(sold.feePaid6).toBe(112_500n);
    // Held goes negative rather than throwing: the position never saw the
    // tokens arrive.
    expect(sold.tokensHeld).toBe(-200_000n);

    // The transferor's position is untouched by the P2P leg.
    const transferor = await indexer.Position.getOrThrow(
      `${TOKEN}-0x2222222222222222222222222222222222222222`,
    );
    expect(transferor.tokensHeld).toBe(200_000n);
    expect(transferor.costBasis6).toBe(10_000_000n);
  });
});
