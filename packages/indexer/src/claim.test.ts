import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import {
  BLOCK,
  CREATOR,
  CURVE,
  TS,
  TREASURY,
  claimed,
  credited,
  marketCreated,
  marketMetadata,
  trade,
  tradeDetail,
} from "./test-fixtures";

describe("claim", () => {
  it("records the claim without a curve and moves the creator's claimed total", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: `0x${"20".repeat(32)}` }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: `0x${"20".repeat(32)}` }),
            trade(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 0, hash: `0x${"21".repeat(32)}` },
              { isBuy: true, usdcIn6: 5_000_000n, tokenOut: 50_000n, fee6: 62_500n },
            ),
            tradeDetail(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 1, hash: `0x${"21".repeat(32)}` },
              { spend6: 5_000_000n },
            ),
            credited(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 2, hash: `0x${"21".repeat(32)}` },
              { to: CREATOR, amount6: 15_000n, reason: 0n },
            ),
            credited(
              { block: BLOCK + 1, timestamp: TS + 10, logIndex: 3, hash: `0x${"21".repeat(32)}` },
              { to: TREASURY, amount6: 47_500n, reason: 1n },
            ),
            // The whole-ledger pull, in a later block.
            claimed(
              { block: BLOCK + 2, timestamp: TS + 40, logIndex: 0, hash: `0x${"22".repeat(32)}` },
              { to: CREATOR, amount6: 15_000n },
            ),
          ],
        },
      },
    });

    const claim = await indexer.FeeCredit.getOrThrow(`${BLOCK + 2}-0`);
    expect(claim.kind).toBe("claim");
    // A claim pulls the vault's whole ledger entry for the address, across
    // every market, so it is never attributed to a curve and carries no
    // reason.
    expect(claim.curve).toBeUndefined();
    expect(claim.reason).toBeUndefined();
    expect(claim.recipient).toBe(CREATOR);
    expect(claim.amount6).toBe(15_000n);
    expect(claim.blockNumber).toBe(BigInt(BLOCK + 2));
    expect(claim.logIndex).toBe(0);

    const creator = await indexer.Creator.getOrThrow(CREATOR);
    expect(creator.claimed6).toBe(15_000n);
    expect(creator.totalCreatorFees6).toBe(15_000n);

    const global = await indexer.Global.getOrThrow("global");
    expect(global.totalClaims6).toBe(15_000n);

    // The claim did not touch the market's own numbers.
    const token = await indexer.Token.getOrThrow(CURVE);
    expect(token.creatorFees6).toBe(15_000n);
  });
});
