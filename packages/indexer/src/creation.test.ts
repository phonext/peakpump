import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
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
} from "./test-fixtures";

// The create transaction's real emission order (PeakpumpFactory.sol): the
// token is minted to the curve, the creation fee is credited BEFORE
// MarketCreated, then MarketCreated and MarketMetadata land together.
const CREATE_TX = `0x${"11".repeat(32)}`;

describe("market creation", () => {
  it("writes the Token row from MarketCreated and MarketMetadata together", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
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
          ],
        },
      },
    });

    const token = await indexer.Token.getOrThrow(CURVE);
    expect(token.token).toBe(TOKEN);
    expect(token.creator).toBe(CREATOR);
    expect(token.marketId).toBe(1);
    // name, symbol and metadataURI come from MarketMetadata and nothing else.
    expect(token.name).toBe("Test Token");
    expect(token.symbol).toBe("TST");
    expect(token.metadataURI).toBe("ipfs://bafytest");
    // The event's frozen misnomers: tSupply6 is S, tSummit6 is Ts.
    expect(token.S).toBe(1_500_000n);
    expect(token.Ts).toBe(600_000n);
    expect(token.y0).toBe(1_000_000n);
    expect(token.feeBps).toBe(125);
    expect(token.creatorBps).toBe(30);
    expect(token.protocolBps).toBe(95);
    expect(token.creationFee6).toBe(1_000_000n);
    expect(token.antiSnipeEndBlock).toBe(BigInt(BLOCK + 10));
    expect(token.maxBuyPerAddress6).toBe(50_000n);
    expect(token.phase).toBe(0);
    expect(token.holderCount).toBe(0);
    expect(token.tradeCount).toBe(0);
    expect(token.volume6).toBe(0n);
    expect(token.creatorFees6).toBe(0n);
    expect(token.timestamp).toBe(BigInt(TS));

    const creator = await indexer.Creator.getOrThrow(CREATOR);
    expect(creator.marketCount).toBe(1);
    expect(creator.totalCreatorFees6).toBe(0n);
    expect(creator.claimed6).toBe(0n);

    const global = await indexer.Global.getOrThrow("global");
    expect(global.totalMarkets).toBe(1);
    expect(global.totalTrades).toBe(0);

    // The creation fee precedes every Trade in its transaction, so the
    // (transactionHash, logIndex) join leaves its curve unset.
    const fee = await indexer.FeeCredit.getOrThrow(`${BLOCK}-1`);
    expect(fee.kind).toBe("credit");
    expect(fee.curve).toBeUndefined();
    expect(fee.recipient).toBe(TREASURY);
    expect(fee.reason).toBe(1);
    expect(fee.amount6).toBe(1_000_000n);
    expect(fee.blockNumber).toBe(BigInt(BLOCK));
    expect(fee.logIndex).toBe(1);
  });

  it("registers the curve and the token clone dynamically from MarketCreated", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: {
        5042002: {
          simulate: [
            marketCreated({ block: BLOCK, timestamp: TS, logIndex: 0, hash: CREATE_TX }),
            marketMetadata({ block: BLOCK, timestamp: TS, logIndex: 1, hash: CREATE_TX }),
          ],
        },
      },
    });

    const registrations = result.changes.flatMap((change) => change.addresses?.sets ?? []);
    expect(registrations).toContainEqual({ address: CURVE, contract: "Curve" });
    expect(registrations).toContainEqual({ address: TOKEN, contract: "PeakToken" });
  });
});
