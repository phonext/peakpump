import type { Address } from "viem";

// Unset means the indexer is treated as offline, which is a supported state:
// SPEC 6.2 makes it a convenience layer, so a page that loses it
// loses the chart and the lists and nothing else. No tradeable number is read
// through this module.
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL;

// Long enough for a cold Envio query, short enough that a hung host does not
// hold a panel in its skeleton. The lists are not on the trade path.
const TIMEOUT_MS = 5_000;

interface GraphQLBody<T> {
  data?: T;
  errors?: readonly unknown[];
}

// Null, never a throw: an unset URL, a DNS failure, a timeout, a 502 and a
// GraphQL errors array are one outcome to every caller — the indexer did not
// answer. try/catch is here because fetch rejects on network failure and abort,
// not to cover an impossible state.
export async function indexerQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  if (INDEXER_URL === undefined || INDEXER_URL === "") return null;
  try {
    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as GraphQLBody<T>;
    if (body.errors !== undefined || body.data === undefined) return null;
    return body.data;
  } catch {
    return null;
  }
}

// The eleven-field Trade event is frozen at SPEC 5.5; these are its own names, so
// a row is traceable to the log it came from. timestamp is display material for
// formatTimeAgo only: it never orders, paginates or deduplicates anything, which
// is why (blockNumber, logIndex) sits beside it.
export interface TradeRow {
  id: string;
  trader: Address;
  isBuy: boolean;
  usdcIn6: bigint;
  usdcOut6: bigint;
  tokenIn: bigint;
  tokenOut: bigint;
  fee6: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  logIndex: number;
}

// The four intervals the chart supports, four and no more.
export type CandleInterval = "1m" | "5m" | "1h" | "1d";

// open, high, low, close and volume6 are the indexer's own names. The four prices are in the
// curve's own price unit, USDC per whole token scaled by 1e18, because priceX18
// is the only price unit this codebase has; volume6 is 6-decimal USDC.
export interface CandleRow {
  bucketStart: bigint;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume6: bigint;
  tradeCount: number;
}

export interface HolderRow {
  address: Address;
  balance: bigint;
}

// BigInt arrives over JSON as a string, so every amount is parsed here rather
// than at each render site.
type Raw<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };

function toTrade(raw: Raw<TradeRow>): TradeRow {
  return {
    ...raw,
    usdcIn6: BigInt(raw.usdcIn6),
    usdcOut6: BigInt(raw.usdcOut6),
    tokenIn: BigInt(raw.tokenIn),
    tokenOut: BigInt(raw.tokenOut),
    fee6: BigInt(raw.fee6),
    timestamp: BigInt(raw.timestamp),
    blockNumber: BigInt(raw.blockNumber),
  };
}

function toCandle(raw: Raw<CandleRow>): CandleRow {
  return {
    ...raw,
    bucketStart: BigInt(raw.bucketStart),
    open: BigInt(raw.open),
    high: BigInt(raw.high),
    low: BigInt(raw.low),
    close: BigInt(raw.close),
    volume6: BigInt(raw.volume6),
  };
}

function toHolder(raw: Raw<HolderRow>): HolderRow {
  return { ...raw, balance: BigInt(raw.balance) };
}

const TRADE_FIELDS = "id trader isBuy usdcIn6 usdcOut6 tokenIn tokenOut fee6 timestamp blockNumber logIndex";

// Trade carries the event's own curve field; Candle and Holder are keyed on
// token, which is the indexer's name for the same curve address, since the Token entity
// is keyed by it. Descending on the (blockNumber, logIndex) pair, so two trades
// in one sub-second block cannot swap places between two fetches.
const TRADES_QUERY = `query Trades($curve: String!, $limit: Int!) {
  Trade(where: {curve: {_eq: $curve}}, order_by: [{blockNumber: desc}, {logIndex: desc}], limit: $limit) { ${TRADE_FIELDS} }
}`;

// Kept as its own document rather than one query with nullable cursor arguments,
// so paging stays isolated from the first-page query. Envio serves every BigInt
// field as Hasura's numeric scalar, so the cursor variable is declared numeric —
// verified against the live endpoint, where BigInt! is rejected with
// "declared as 'BigInt!', but used where 'numeric' is expected".
const TRADES_BEFORE_QUERY = `query TradesBefore($curve: String!, $limit: Int!, $block: numeric!, $logIndex: Int!) {
  Trade(
    where: {curve: {_eq: $curve}, _or: [{blockNumber: {_lt: $block}}, {blockNumber: {_eq: $block}, logIndex: {_lt: $logIndex}}]}
    order_by: [{blockNumber: desc}, {logIndex: desc}]
    limit: $limit
  ) { ${TRADE_FIELDS} }
}`;

const CANDLES_QUERY = `query Candles($token: String!, $interval: String!, $limit: Int!) {
  Candle(where: {token: {_eq: $token}, interval: {_eq: $interval}}, order_by: {bucketStart: desc}, limit: $limit) {
    bucketStart open high low close volume6 tradeCount
  }
}`;

// Ordered by balance with address as the tiebreak, because equal balances would
// otherwise arrive in a different order on each fetch and reshuffle the list.
const HOLDERS_QUERY = `query Holders($token: String!, $limit: Int!) {
  Holder(where: {token: {_eq: $token}}, order_by: [{balance: desc}, {address: asc}], limit: $limit) { address balance }
}`;

export interface TradeCursor {
  blockNumber: bigint;
  logIndex: number;
}

// Null is the indexer being unreachable and an empty array is a market with no
// trades. Consumers render a different sentence for each, so the two are not
// collapsed here.
export async function fetchTrades(
  curve: Address,
  limit: number,
  before?: TradeCursor,
): Promise<TradeRow[] | null> {
  const data =
    before === undefined
      ? await indexerQuery<{ Trade: Raw<TradeRow>[] }>(TRADES_QUERY, { curve, limit })
      : await indexerQuery<{ Trade: Raw<TradeRow>[] }>(TRADES_BEFORE_QUERY, {
          curve,
          limit,
          block: before.blockNumber.toString(),
          logIndex: before.logIndex,
        });
  return data === null ? null : data.Trade.map(toTrade);
}

// Fetched newest first so the limit takes the most recent buckets, then reversed
// because a candlestick series has to be handed over ascending. bucketStart is
// unique per (token, interval), so unlike a raw log timestamp it cannot tie.
export async function fetchCandles(
  token: Address,
  interval: CandleInterval,
  limit: number,
): Promise<CandleRow[] | null> {
  const data = await indexerQuery<{ Candle: Raw<CandleRow>[] }>(CANDLES_QUERY, {
    token,
    interval,
    limit,
  });
  return data === null ? null : data.Candle.map(toCandle).reverse();
}

export async function fetchHolders(token: Address, limit: number): Promise<HolderRow[] | null> {
  const data = await indexerQuery<{ Holder: Raw<HolderRow>[] }>(HOLDERS_QUERY, { token, limit });
  return data === null ? null : data.Holder.map(toHolder);
}
