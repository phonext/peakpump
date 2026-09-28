import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { FACTORY } from "./deployment";
import {
  BLOCK,
  CREATOR,
  CURVE,
  TOKEN,
  TREASURY,
  TS,
  credited,
  marketCreated,
  marketMetadata,
  mintTransfer,
  trade,
  tradeDetail,
  transfer,
} from "./test-fixtures";

// One create transaction with a dev-buy, in the real emission order: mint,
// creation fee, MarketCreated, MarketMetadata, then the curve's Trade,
// TradeDetail, the payout Transfer and the fee pair (PeakpumpFactory.sol and
// Curve.sol). The Trade of a dev-buy reports the creator as trader (the `to`)
// while TradeDetail reports the factory as the caller, and the position must
// land on the creator.
const CREATE_TX = `0x${"22".repeat(32)}`;

describe("factory dev-buy", () => {
  it("puts the position and the holder row on the creator, not the factory", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: {
        5042002: {
          simulate: [
            mintTransfer(
              { block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX },
              CURVE,
              1_500_000n,
            ),
            credited(
              { block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX },
              { to: TREASURY, amount6: 1_000_000n, reason: 1n },
            ),
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 2, hash: CREATE_TX }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 3, hash: CREATE_TX }),
            trade(
              { block: BLOCK, timestamp: TS, logIndex: 4, hash: CREATE_TX },
              {
                trader: CREATOR,
                isBuy: true,
                usdcIn6: 5_000_000n,
                tokenOut: 50_000n,
                fee6: 62_500n,
                tReserve6After: 4_937_500n,
                supplySold6After: 50_000n,
              },
            ),
            tradeDetail(
              { block: BLOCK, timestamp: TS, logIndex: 5, hash: CREATE_TX },
              { trader: FACTORY, to: CREATOR, spend6: 5_000_000n, poolDelta6: 4_937_500n },
            ),
            transfer({ block: BLOCK, timestamp: TS, logIndex: 6, hash: CREATE_TX }, CURVE, CREATOR, 50_000n),
            credited(
              { block: BLOCK, timestamp: TS, logIndex: 7, hash: CREATE_TX },
              // floor(62500 * 30/125) and the remainder of the split.
              { to: CREATOR, amount6: 15_000n, reason: 0n },
            ),
            credited(
              { block: BLOCK, timestamp: TS, logIndex: 8, hash: CREATE_TX },
              { to: TREASURY, amount6: 47_500n, reason: 1n },
            ),
          ],
        },
      },
    });

    // The registration block is backfilled: the dev-buy's Trade, emitted after
    // the registration event in the same block, was processed.
    expect(result.changes.some((change) => change.Trade?.sets?.length === 1)).toBe(true);

    const tradeRow = await indexer.Trade.getOrThrow(`${BLOCK}-4`);
    expect(tradeRow.trader).toBe(CREATOR);
    expect(tradeRow.isBuy).toBe(true);
    expect(tradeRow.usdcIn6).toBe(5_000_000n);
    expect(tradeRow.tokenOut).toBe(50_000n);
    expect(tradeRow.fee6).toBe(62_500n);
    expect(tradeRow.curve).toBe(CURVE);
    expect(tradeRow.transactionHash).toBe(CREATE_TX);

    const position = await indexer.Position.getOrThrow(`${TOKEN}-${CREATOR}`);
    expect(position.trader).toBe(CREATOR);
    expect(position.tokensHeld).toBe(50_000n);
    // spend6, not usdcIn6: the buyer's true outlay, fee included.
    expect(position.costBasis6).toBe(5_000_000n);
    expect(position.feePaid6).toBe(62_500n);
    expect(position.buys).toBe(1);
    expect(position.sells).toBe(0);
    expect(position.realised6).toBe(0n);

    // The factory called buy() but holds nothing and owns no position.
    const factoryPosition = await indexer.Position.get(`${TOKEN}-${FACTORY}`);
    expect(factoryPosition).toBeUndefined();
    const factoryHolder = await indexer.Holder.get(`${TOKEN}-${FACTORY}`);
    expect(factoryHolder).toBeUndefined();

    const holder = await indexer.Holder.getOrThrow(`${TOKEN}-${CREATOR}`);
    expect(holder.balance).toBe(50_000n);
    // The curve is not a holder and the mint to it was ignored.
    const curveHolder = await indexer.Holder.get(`${TOKEN}-${CURVE}`);
    expect(curveHolder).toBeUndefined();
    const token = await indexer.Token.getOrThrow(CURVE);
    expect(token.holderCount).toBe(1);

    // The dev-buy's credits are attributed to the curve by the
    // (transactionHash, logIndex) join: they follow the Trade in the same
    // transaction, unlike the creation fee that precedes it.
    const creatorCredit = await indexer.FeeCredit.getOrThrow(`${BLOCK}-7`);
    expect(creatorCredit.curve).toBe(CURVE);
    expect(creatorCredit.recipient).toBe(CREATOR);
    expect(creatorCredit.reason).toBe(0);
    expect(creatorCredit.amount6).toBe(15_000n);

    const creator = await indexer.Creator.getOrThrow(CREATOR);
    expect(creator.totalCreatorFees6).toBe(15_000n);
    expect(token.creatorFees6).toBe(15_000n);

    const global = await indexer.Global.getOrThrow("global");
    expect(global.totalCreatorFees6).toBe(15_000n);
    // Creation fee and dev-buy protocol fee together.
    expect(global.totalProtocolFees6).toBe(1_047_500n);
    expect(global.totalMarkets).toBe(1);
    expect(global.totalTrades).toBe(1);
    expect(global.totalVolume6).toBe(5_000_000n);
  });
});
