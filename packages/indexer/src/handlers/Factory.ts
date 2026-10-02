import { indexer } from "envio";
import { creatorRow, EMPTY_GLOBAL } from "../seed";

// Dynamic registration from MarketCreated itself: it is the only event that
// carries both addresses. Envio backfills the whole registration block, so the
// factory dev-buy in the same transaction is captured too.
indexer.contractRegister(
  { contract: "PeakpumpFactory", event: "MarketCreated" },
  async ({ event, context }) => {
    context.chain.Curve.add(event.params.curve);
    context.chain.PeakToken.add(event.params.token);
  },
);

indexer.onEvent(
  { contract: "PeakpumpFactory", event: "MarketCreated" },
  async ({ event, context }) => {
    const p = event.params;
    // name, symbol and metadataURI stay absent here: they come from
    // MarketMetadata, in the same transaction, and from nowhere else.
    context.Token.set({
      id: p.curve,
      token: p.token,
      creator: p.creator,
      marketId: Number(p.marketId),
      name: undefined,
      symbol: undefined,
      metadataURI: undefined,
      y0: p.y0,
      // Frozen misnomers in the event: tSupply6 is S and tSummit6 is Ts, both token
      // wei.
      S: p.tSupply6,
      Ts: p.tSummit6,
      antiSnipeEndBlock: p.antiSnipeEndBlock,
      maxBuyPerAddress6: p.maxBuyPerAddress6,
      feeBps: Number(p.feeBpsTotal),
      creatorBps: Number(p.feeBpsCreator),
      protocolBps: Number(p.feeBpsProtocol),
      creationFee6: p.creationFee6,
      phase: 0,
      raised6: 0n,
      // MATH 4: y = y0 - sold while ASCENT, and sold is zero at creation, so y
      // starts at y0. A 0n initializer makes the lists derive sold = y0 - 0 = y0
      // and every market that never trades reads the whole pre-Summit supply as
      // sold — 133.3% at the preset ratio. The Trade and Summit handlers are
      // what move it after this.
      y: p.y0,
      // The event carries no start price (x0 is not in it), so an untraded
      // market has no traded figure for a list to show until its first Trade.
      priceX18: 0n,
      creatorFees6: 0n,
      holderCount: 0,
      tradeCount: 0,
      volume6: 0n,
      timestamp: BigInt(event.block.timestamp),
    });

    const creator = await context.Creator.getOrCreate(creatorRow(p.creator));
    context.Creator.set({ ...creator, marketCount: creator.marketCount + 1 });

    const global = await context.Global.getOrCreate(EMPTY_GLOBAL);
    context.Global.set({ ...global, totalMarkets: global.totalMarkets + 1 });
  },
);

indexer.onEvent(
  { contract: "PeakpumpFactory", event: "MarketMetadata" },
  async ({ event, context }) => {
    const token = await context.Token.get(event.params.curve);
    // MarketCreated always precedes MarketMetadata in the same transaction;
    // the missing row is handled rather than assumed because one throw
    // stops the whole indexer.
    if (token === undefined) return;
    context.Token.set({
      ...token,
      name: event.params.name,
      symbol: event.params.symbol,
      metadataURI: event.params.metadataURI,
    });
  },
);
