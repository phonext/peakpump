import { indexer } from "envio";
import { creatorRow, EMPTY_GLOBAL } from "../seed";
import { nearestPrecedingTrade } from "../trade-join";

// FeeVault's own enum: 0 Creator, 1 Protocol.
const REASON_CREATOR = 0n;

indexer.onEvent(
  { contract: "FeeVault", event: "Credited" },
  async ({ event, context }) => {
    const p = event.params;

    // A credit belongs to the market of the trade it followed in the same
    // transaction. The creation fee precedes MarketCreated and every Trade in
    // its transaction, so it matches nothing and carries no curve; so do bare
    // receives and sweeps. A same-transaction protocol credit after a trade
    // (the rare factory residual sweep) attributes to that curve, and no
    // protocol-side equality is ever asserted against it.
    const trade = await nearestPrecedingTrade(context, event.transaction.hash, event.logIndex);

    context.FeeCredit.set({
      id: `${event.block.number}-${event.logIndex}`,
      kind: "credit",
      curve: trade === undefined ? undefined : trade.curve,
      recipient: p.to,
      reason: Number(p.reason),
      amount6: p.amount6,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      timestamp: BigInt(event.block.timestamp),
    });

    // The creator/protocol split is read from these events, never derived
    // arithmetically from the Trade fee. A zero-floored credit emits
    // no event at all, so nothing here assumes one.
    if (p.reason === REASON_CREATOR) {
      const creator = await context.Creator.getOrCreate(creatorRow(p.to));
      context.Creator.set({
        ...creator,
        totalCreatorFees6: creator.totalCreatorFees6 + p.amount6,
      });
      if (trade !== undefined) {
        const token = await context.Token.get(trade.curve);
        if (token !== undefined) {
          context.Token.set({ ...token, creatorFees6: token.creatorFees6 + p.amount6 });
        }
      }
      const global = await context.Global.getOrCreate(EMPTY_GLOBAL);
      context.Global.set({
        ...global,
        totalCreatorFees6: global.totalCreatorFees6 + p.amount6,
      });
    } else {
      const global = await context.Global.getOrCreate(EMPTY_GLOBAL);
      context.Global.set({
        ...global,
        totalProtocolFees6: global.totalProtocolFees6 + p.amount6,
      });
    }
  },
);

indexer.onEvent(
  { contract: "FeeVault", event: "Claimed" },
  async ({ event, context }) => {
    const p = event.params;
    context.FeeCredit.set({
      id: `${event.block.number}-${event.logIndex}`,
      kind: "claim",
      curve: undefined,
      recipient: p.to,
      reason: undefined,
      amount6: p.amount6,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      timestamp: BigInt(event.block.timestamp),
    });
    // A claim is a whole-ledger pull across every market the recipient owns,
    // so it is never attributed to a curve.
    const creator = await context.Creator.getOrCreate(creatorRow(p.to));
    context.Creator.set({ ...creator, claimed6: creator.claimed6 + p.amount6 });
    const global = await context.Global.getOrCreate(EMPTY_GLOBAL);
    context.Global.set({ ...global, totalClaims6: global.totalClaims6 + p.amount6 });
  },
);
