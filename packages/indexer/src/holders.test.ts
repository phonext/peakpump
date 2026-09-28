import { createTestIndexer, type Address } from "envio";
import { describe, expect, it } from "vitest";
import { FACTORY } from "./deployment";
import {
  BLOCK,
  CURVE,
  TOKEN,
  TS,
  marketCreated,
  marketMetadata,
  trade,
  tradeDetail,
  transfer,
} from "./test-fixtures";

const CREATE_TX = `0x${"cc".repeat(32)}`;
const BUYER: Address = "0x2222222222222222222222222222222222222222";
const TAKER: Address = "0x3333333333333333333333333333333333333333";
const FRESH: Address = "0x4444444444444444444444444444444444444444";
const BYSTANDER: Address = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";

function buy(m: { block: number; timestamp: number; hash: string }, buyer: Address, tokens: bigint) {
  return [
    trade(
      { ...m, logIndex: 0 },
      { trader: buyer, isBuy: true, usdcIn6: 5_000_000n, tokenOut: tokens, fee6: 62_500n },
    ),
    tradeDetail({ ...m, logIndex: 1 }, { trader: buyer, to: buyer, spend6: 5_000_000n }),
    transfer({ ...m, logIndex: 2 }, CURVE, buyer, tokens),
  ];
}

describe("holder counts", () => {
  it("counts positive balances only, in both directions, excluding the curve and the factory", async () => {
    const indexer = createTestIndexer();
    const at = (block: number, timestamp: number, hash: string) => ({ block, timestamp, hash });

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX }),
            // A buy pays out from the curve: the curve's own leg is not a
            // holder, the buyer's is. Count goes 0 -> 1.
            ...buy(at(BLOCK + 1, TS + 10, `0x${"dd".repeat(32)}`), BUYER, 100_000n),
            // P2P to a fresh address: count 1 -> 2.
            transfer(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 0, hash: `0x${"ee".repeat(32)}` },
              BUYER,
              TAKER,
              40_000n,
            ),
            // Everything moved on: TAKER drops to zero, count 2 -> 1, and the
            // zero row is kept.
            transfer(
              { block: BLOCK + 3, timestamp: TS + 50, logIndex: 0, hash: `0x${"ef".repeat(32)}` },
              TAKER,
              FRESH,
              40_000n,
            ),
            // The buyer sells everything back to the curve: count 1 -> 0.
            ...[
              trade(
                { block: BLOCK + 4, timestamp: TS + 70, logIndex: 0, hash: `0x${"f0".repeat(32)}` },
                { trader: BUYER, isBuy: false, usdcOut6: 2_000_000n, tokenIn: 60_000n, fee6: 25_000n },
              ),
              tradeDetail(
                { block: BLOCK + 4, timestamp: TS + 70, logIndex: 1, hash: `0x${"f0".repeat(32)}` },
                { trader: BUYER, spend6: 0n },
              ),
              transfer(
                { block: BLOCK + 4, timestamp: TS + 70, logIndex: 2, hash: `0x${"f0".repeat(32)}` },
                BUYER,
                CURVE,
                60_000n,
              ),
            ],
            // A transfer to the factory moves the sender's balance but never
            // counts the factory.
            transfer(
              { block: BLOCK + 5, timestamp: TS + 90, logIndex: 0, hash: `0x${"f1".repeat(32)}` },
              FRESH,
              FACTORY,
              40_000n,
            ),
            // A zero-value transfer to a bystander creates a row that does not
            // count, and a self-transfer is skipped entirely.
            transfer(
              { block: BLOCK + 6, timestamp: TS + 110, logIndex: 0, hash: `0x${"f2".repeat(32)}` },
              FRESH,
              BYSTANDER,
              0n,
            ),
            transfer(
              { block: BLOCK + 6, timestamp: TS + 110, logIndex: 1, hash: `0x${"f2".repeat(32)}` },
              BYSTANDER,
              BYSTANDER,
              5n,
            ),
          ],
        },
      },
    });

    const token = await indexer.Token.getOrThrow(CURVE);
    // FRESH emptied into the factory; only the zero-balance rows remain.
    expect(token.holderCount).toBe(0);

    const buyerRow = await indexer.Holder.getOrThrow(`${TOKEN}-${BUYER}`);
    expect(buyerRow.balance).toBe(0n);
    const takerRow = await indexer.Holder.getOrThrow(`${TOKEN}-${TAKER}`);
    expect(takerRow.balance).toBe(0n);
    const freshRow = await indexer.Holder.getOrThrow(`${TOKEN}-${FRESH}`);
    expect(freshRow.balance).toBe(0n);
    // The bystander holds a zero row from the zero-value transfer, kept but
    // never counted, and the self-transfer changed nothing on it.
    const bystanderRow = await indexer.Holder.getOrThrow(`${TOKEN}-${BYSTANDER}`);
    expect(bystanderRow.balance).toBe(0n);

    // The curve and the factory never have rows.
    expect(await indexer.Holder.get(`${TOKEN}-${CURVE}`)).toBeUndefined();
    expect(await indexer.Holder.get(`${TOKEN}-${FACTORY}`)).toBeUndefined();
  });

  it("counts up again after a zero: a returning holder is not double counted", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        5042002: {
          simulate: [
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX }),
            ...buy({ block: BLOCK + 1, timestamp: TS + 10, hash: `0x${"fa".repeat(32)}` }, BUYER, 100_000n),
            transfer(
              { block: BLOCK + 2, timestamp: TS + 30, logIndex: 0, hash: `0x${"fb".repeat(32)}` },
              BUYER,
              TAKER,
              100_000n,
            ),
            transfer(
              { block: BLOCK + 3, timestamp: TS + 50, logIndex: 0, hash: `0x${"fc".repeat(32)}` },
              TAKER,
              BUYER,
              30_000n,
            ),
          ],
        },
      },
    });

    const token = await indexer.Token.getOrThrow(CURVE);
    // BUYER emptied (1 -> 0), TAKER received (0 -> 1), BUYER came back
    // (0 -> 1) without TAKER dropping.
    expect(token.holderCount).toBe(2);
    expect((await indexer.Holder.getOrThrow(`${TOKEN}-${BUYER}`)).balance).toBe(30_000n);
    expect((await indexer.Holder.getOrThrow(`${TOKEN}-${TAKER}`)).balance).toBe(70_000n);
  });
});
