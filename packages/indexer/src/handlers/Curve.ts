import { indexer, type Position, type Token, type Trade } from "envio";
import { bucketStart, CANDLE_INTERVALS, priceAfterTrade } from "../candles";
import { EMPTY_GLOBAL } from "../seed";
import { nearestPrecedingTrade } from "../trade-join";

function emptyPosition(id: string, token: string, trader: string): Position {
  return {
    id,
    token,
    trader,
    tokensHeld: 0n,
    costBasis6: 0n,
    realised6: 0n,
    feePaid6: 0n,
    buys: 0,
    sells: 0,
  };
}

indexer.onEvent(
  { contract: "Curve", event: "Trade" },
  async ({ event, context }) => {
    const p = event.params;
    const timestamp = BigInt(event.block.timestamp);

    context.Trade.set({
      id: `${event.block.number}-${event.logIndex}`,
      curve: p.curve,
      // `to` on a buy, msg.sender on a sell: the event's own trader field.
      trader: p.trader,
      isBuy: p.isBuy,
      usdcIn6: p.usdcIn6,
      usdcOut6: p.usdcOut6,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      fee6: p.fee6,
      timestamp,
      blockNumber: BigInt(event.block.number),
      logIndex: event.logIndex,
      transactionHash: event.transaction.hash,
    });

    const token = await context.Token.get(p.curve);
    if (token === undefined) return;

    // MATH section 4: y = y0 - sold while ASCENT, S - sold after it. The phase
    // the Trade event reports is the phase after the trade, so the crossing
    // buy already prices on the PEAK branch.
    const sold = p.supplySold6After;
    const y = p.phaseAfter === 0n ? token.y0 - sold : token.S - sold;
    const price = priceAfterTrade(p.tReserve6After, y);
    // The USDC leg (SPEC 5.5): what the buyer paid in, what the seller got out.
    const volumeLeg = p.isBuy ? p.usdcIn6 : p.usdcOut6;

    // Sparse candles: a bucket exists only once a trade lands in it, and an
    // empty bucket is never backfilled. open is the first trade's price, with
    // no carry-forward from an earlier bucket.
    for (const interval of CANDLE_INTERVALS) {
      const start = bucketStart(timestamp, interval.seconds);
      const id = `${token.token}-${interval.id}-${start}`;
      const candle = await context.Candle.get(id);
      if (candle === undefined) {
        context.Candle.set({
          id,
          token: token.token,
          interval: interval.id,
          bucketStart: start,
          open: price,
          high: price,
          low: price,
          close: price,
          volume6: volumeLeg,
          tradeCount: 1,
        });
      } else {
        context.Candle.set({
          ...candle,
          high: price > candle.high ? price : candle.high,
          low: price < candle.low ? price : candle.low,
          close: price,
          volume6: candle.volume6 + volumeLeg,
          tradeCount: candle.tradeCount + 1,
        });
      }
    }

    context.Token.set({
      ...token,
      tradeCount: token.tradeCount + 1,
      volume6: token.volume6 + volumeLeg,
      priceX18: price,
      // y is written here and not only at the Summit: the lists derive sold from
      // it as y0 - y, so a field left at its creation value of 0n reports the
      // whole pre-Summit supply as sold and every ASCENT market reads 133.3%.
      y,
    });

    const global = await context.Global.getOrCreate(EMPTY_GLOBAL);
    context.Global.set({
      ...global,
      totalTrades: global.totalTrades + 1,
      totalVolume6: global.totalVolume6 + volumeLeg,
    });
  },
);

indexer.onEvent(
  { contract: "Curve", event: "TradeDetail" },
  async ({ event, context }) => {
    const p = event.params;

    // TradeDetail carries no isBuy and no fee6; both sit on the Trade event
    // emitted immediately before it in the same transaction.
    const trade: Trade | undefined = await nearestPrecedingTrade(
      context,
      event.transaction.hash,
      event.logIndex,
    );
    if (trade === undefined) return;

    const market: Token | undefined = await context.Token.get(trade.curve);
    if (market === undefined) return;

    // On a buy the position lands on the recipient; a sell has no recipient
    // and the proceeds go to the caller. On a factory dev-buy the two differ
    // and the creator gets the position, not the factory.
    const owner = trade.isBuy ? p.to : p.trader;
    const id = `${market.token}-${owner}`;
    const existing = await context.Position.get(id);
    const position = existing === undefined ? emptyPosition(id, market.token, owner) : existing;

    if (trade.isBuy) {
      // spend6 is the buyer's true outlay, usdcIn6 minus the refund, fee
      // included, so the basis absorbs the fee on the way in.
      context.Position.set({
        ...position,
        tokensHeld: position.tokensHeld + trade.tokenOut,
        costBasis6: position.costBasis6 + p.spend6,
        feePaid6: position.feePaid6 + trade.fee6,
        buys: position.buys + 1,
      });
    } else {
      // tokensHeld can be zero or below tokenIn: tokens that arrived by a P2P
      // transfer move Holder but not Position, so a seller can sell a
      // position this entity says they do not hold. The guard is a reachable
      // case, not defensive code, and a BigInt division by zero would stop the
      // indexer.
      let removed = 0n;
      if (position.tokensHeld > 0n && position.costBasis6 > 0n) {
        const scaled = (position.costBasis6 * trade.tokenIn) / position.tokensHeld;
        removed = scaled < position.costBasis6 ? scaled : position.costBasis6;
      }
      context.Position.set({
        ...position,
        tokensHeld: position.tokensHeld - trade.tokenIn,
        costBasis6: position.costBasis6 - removed,
        realised6: position.realised6 + trade.usdcOut6 - removed,
        feePaid6: position.feePaid6 + trade.fee6,
        sells: position.sells + 1,
      });
    }
  },
);

indexer.onEvent(
  { contract: "Curve", event: "Summit" },
  async ({ event, context }) => {
    const token = await context.Token.get(event.srcAddress);
    if (token === undefined) return;
    // raised6, y and priceX18 are copied from the event, never recomputed from
    // reserves: the contract's numbers are the authority.
    context.Token.set({
      ...token,
      phase: 1,
      raised6: event.params.raised6,
      y: event.params.y,
      priceX18: event.params.priceX18,
    });
  },
);
