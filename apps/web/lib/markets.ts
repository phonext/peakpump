import type { Address } from "viem";
import { cache } from "react";
import { indexerQuery } from "@/lib/graphql";

// The Token entity behind every market list: the home page's rail, its table
// and its stat bar, the sitemap, and the profile page's created markets. List
// data only — priceX18 here is the last traded price a list may show, never
// the live figure the token page reads from the curve (SPEC 6.1).

export interface MarketRow {
  // The Token entity's id: the curve address, which is also the route segment.
  id: Address;
  token: Address;
  creator: Address;
  marketId: number;
  name: string | null;
  symbol: string | null;
  metadataURI: string | null;
  phase: number;
  y0: bigint;
  S: bigint;
  Ts: bigint;
  raised6: bigint;
  y: bigint;
  priceX18: bigint;
  creatorFees6: bigint;
  holderCount: number;
  tradeCount: number;
  volume6: bigint;
  timestamp: bigint;
}

export interface GlobalRow {
  totalMarkets: number;
  totalTrades: number;
  totalVolume6: bigint;
  totalCreatorFees6: bigint;
}

// BigInt arrives over JSON as a string, parsed here once rather than at each
// render site — the same law graphql.ts follows.
type Raw<T> = { [K in keyof T]: T[K] extends bigint ? string : T[K] };

const MARKET_FIELDS =
  "id token creator marketId name symbol metadataURI phase y0 S Ts raised6 y priceX18 creatorFees6 holderCount tradeCount volume6 timestamp";

function toMarket(raw: Raw<MarketRow>): MarketRow {
  return {
    ...raw,
    y0: BigInt(raw.y0),
    S: BigInt(raw.S),
    Ts: BigInt(raw.Ts),
    raised6: BigInt(raw.raised6),
    y: BigInt(raw.y),
    priceX18: BigInt(raw.priceX18),
    creatorFees6: BigInt(raw.creatorFees6),
    volume6: BigInt(raw.volume6),
    timestamp: BigInt(raw.timestamp),
  };
}

// progressBps() as Curve.sol:461 states it, evaluated on the entity's snapshot
// fields: state PEAK answers 10000, otherwise floor(sold * 10000 / Ts), where
// sold is y0 - y because y = y0 - sold for the whole of ASCENT — the identical
// derivation packages/indexer/src/handlers/Curve.ts makes. This is a list
// figure: the number the token page shows comes from the view, at read time.
export function marketProgressBps(market: MarketRow): number {
  if (market.phase !== 0) return 10_000;
  const sold = market.y0 - market.y;
  return Number((sold * 10_000n) / market.Ts);
}

// The rail's and the Final Ascent tab's threshold: above 80 percent of supply
// sold. A single named constant because two literals would drift apart.
export const ASCENT_RAIL_BPS = 8_000;

// The page size every server-rendered tab serves. A number a reader can scan
// in one glance; anything deeper is the cursor's job.
export const MARKET_PAGE_SIZE = 25;

// The Final Ascent set is sorted on progress, which the Token entity does not
// store, so no cursor on a stored field can order it. The whole ASCENT set is
// fetched and ranked here instead — bounded on a testnet by the number of live
// markets, and the fetch is shared by the tab and the rail.
export const ASCENT_FETCH_LIMIT = 500;

export type MarketTab = "all" | "volume" | "ascent" | "peak";

export const MARKET_TABS: readonly { id: MarketTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "volume", label: "Volume" },
  { id: "ascent", label: "Final Ascent" },
  { id: "peak", label: "In PEAK" },
];

const ALL_QUERY = `query Markets($limit: Int!) {
  Token(order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

// volume6 ties are broken by marketId, because two markets with equal volume
// would otherwise arrive in a different order on each fetch and reshuffle the
// table — the same reason HOLDERS_QUERY tiebreaks on address.
const VOLUME_QUERY = `query MarketsByVolume($limit: Int!) {
  Token(order_by: [{volume6: desc}, {marketId: desc}], limit: $limit) { ${MARKET_FIELDS} }
}`;

const PEAK_QUERY = `query PeakMarkets($limit: Int!) {
  Token(where: {phase: {_eq: 1}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

const ASCENT_QUERY = `query AscentMarkets($limit: Int!) {
  Token(where: {phase: {_eq: 0}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

// marketId is the factory's own counter: unique and strictly monotone in
// creation-log order, so it is a total order no timestamp collision can
// reorder. Envio serves BigInt fields as Hasura's numeric
// scalar, so the cursor variable is numeric — the same discovery the Trade
// cursor query records in graphql.ts.
const ALL_BEFORE_QUERY = `query MarketsBefore($limit: Int!, $marketId: Int!) {
  Token(where: {marketId: {_lt: $marketId}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

const VOLUME_BEFORE_QUERY = `query MarketsByVolumeBefore($limit: Int!, $volume6: numeric!, $marketId: Int!) {
  Token(
    where: {_or: [{volume6: {_lt: $volume6}}, {volume6: {_eq: $volume6}, marketId: {_lt: $marketId}}]},
    order_by: [{volume6: desc}, {marketId: desc}],
    limit: $limit
  ) { ${MARKET_FIELDS} }
}`;

const PEAK_BEFORE_QUERY = `query PeakMarketsBefore($limit: Int!, $marketId: Int!) {
  Token(where: {phase: {_eq: 1}, marketId: {_lt: $marketId}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

// The cursor a "More" fetch resumes from: the last row of the page above,
// carried as the pair the ordering actually sorts on.
export interface MarketCursor {
  marketId: number;
  volume6?: bigint;
}

// Null is the indexer not answering and an empty array is a filter nothing
// matched — kept apart for the same reason graphql.ts keeps them apart.
export async function fetchMarkets(
  tab: MarketTab,
  limit: number,
  before?: MarketCursor,
): Promise<MarketRow[] | null> {
  let query: string;
  const variables: Record<string, unknown> = { limit };
  if (tab === "volume") {
    query = before === undefined ? VOLUME_QUERY : VOLUME_BEFORE_QUERY;
    if (before !== undefined) {
      variables.volume6 = before.volume6?.toString();
      variables.marketId = before.marketId;
    }
  } else if (tab === "peak") {
    query = before === undefined ? PEAK_QUERY : PEAK_BEFORE_QUERY;
    if (before !== undefined) variables.marketId = before.marketId;
  } else if (tab === "ascent") {
    // Progress is derived, so this tab has no stored cursor: the whole set is
    // fetched and ranked by marketProgressBps at the caller.
    query = ASCENT_QUERY;
  } else {
    query = before === undefined ? ALL_QUERY : ALL_BEFORE_QUERY;
    if (before !== undefined) variables.marketId = before.marketId;
  }

  const data = await indexerQuery<{ Token: Raw<MarketRow>[] }>(query, variables);
  if (data === null) return null;
  const rows = data.Token.map(toMarket);
  if (tab === "ascent") {
    return rows
      .map((row) => ({ row, bps: marketProgressBps(row) }))
      .filter(({ bps }) => bps >= ASCENT_RAIL_BPS)
      .sort((a, b) => b.bps - a.bps || b.row.marketId - a.row.marketId)
      .map(({ row }) => row);
  }
  return rows;
}

// Envio's GraphQL is Hasura under the hood, so a by-id select is the list form
// with an equality filter, not TheGraph's `Entity(id:)` argument — that argument
// does not exist on the root field and the endpoint answers a query carrying it
// with a validation error, which indexerQuery reports as the indexer being
// offline. Every query in this file and graphql.ts already used the list form;
// these two were the only holdouts.
const GLOBAL_QUERY = `query GlobalTotals {
  Global(where: {id: {_eq: "global"}}, limit: 1) { totalMarkets totalTrades totalVolume6 totalCreatorFees6 }
}`;

export async function fetchGlobal(): Promise<GlobalRow | null> {
  const data = await indexerQuery<{ Global: Raw<GlobalRow>[] }>(GLOBAL_QUERY, {});
  const raw = data?.Global[0];
  if (raw === undefined) return null;
  return {
    ...raw,
    totalVolume6: BigInt(raw.totalVolume6),
    totalCreatorFees6: BigInt(raw.totalCreatorFees6),
  };
}

// The creator aggregates behind the profile page's earnings panel: one entity
// keyed by the creator address, already maintained per trade by the indexer.
export interface CreatorRow {
  id: Address;
  totalCreatorFees6: bigint;
  claimed6: bigint;
  marketCount: number;
}

const CREATOR_QUERY = `query Creator($id: String!) {
  Creator(where: {id: {_eq: $id}}, limit: 1) { id totalCreatorFees6 claimed6 marketCount }
}`;

export async function fetchCreator(id: Address): Promise<CreatorRow | null> {
  // The address goes over exactly as this library's other queries send one: never
  // lowercased, because the live Envio endpoint matched the checksummed form
  // when the charts were verified against it.
  const data = await indexerQuery<{ Creator: (Raw<CreatorRow> | null)[] }>(CREATOR_QUERY, {
    id,
  });
  const raw = data?.Creator[0];
  if (raw === null || raw === undefined) return null;
  return {
    ...raw,
    totalCreatorFees6: BigInt(raw.totalCreatorFees6),
    claimed6: BigInt(raw.claimed6),
  };
}

const CREATED_QUERY = `query CreatedMarkets($creator: String!, $limit: Int!) {
  Token(where: {creator: {_eq: $creator}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

const CREATED_BEFORE_QUERY = `query CreatedMarketsBefore($creator: String!, $limit: Int!, $marketId: Int!) {
  Token(where: {creator: {_eq: $creator}, marketId: {_lt: $marketId}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
}`;

export async function fetchCreatedMarkets(
  creator: Address,
  limit: number,
  before?: { marketId: number },
): Promise<MarketRow[] | null> {
  // Checksummed, for the same reason as fetchCreator. The cursor is marketId,
  // the same total order the home page's All tab pages on.
  const data =
    before === undefined
      ? await indexerQuery<{ Token: Raw<MarketRow>[] }>(CREATED_QUERY, { creator, limit })
      : await indexerQuery<{ Token: Raw<MarketRow>[] }>(CREATED_BEFORE_QUERY, {
          creator,
          limit,
          marketId: before.marketId,
        });
  return data === null ? null : data.Token.map(toMarket);
}

// A trader's position per market, the profile page's Held list. realised6 is
// net of fees by schema (fees join the basis on a buy and reduce proceeds on a
// sell), which is why the panel prints feePaid6 as its own line rather than
// subtracting it twice.
export interface PositionRow {
  // token-trader, unique per market per trader.
  id: string;
  token: Address;
  trader: Address;
  tokensHeld: bigint;
  costBasis6: bigint;
  realised6: bigint;
  feePaid6: bigint;
  buys: number;
  sells: number;
}

const POSITION_FIELDS = "id token trader tokensHeld costBasis6 realised6 feePaid6 buys sells";

// Biggest cost basis first, id (token-trader) as the tiebreak because equal
// bases would otherwise reshuffle between fetches — the same reason
// HOLDERS_QUERY tiebreaks on address. The cursor is the same pair, so "More"
// pages on exactly what the ordering sorts on.
const POSITIONS_QUERY = `query Positions($trader: String!, $limit: Int!) {
  Position(where: {trader: {_eq: $trader}}, order_by: [{costBasis6: desc}, {id: asc}], limit: $limit) { ${POSITION_FIELDS} }
}`;

const POSITIONS_BEFORE_QUERY = `query PositionsBefore($trader: String!, $limit: Int!, $costBasis6: numeric!, $id: String!) {
  Position(
    where: {trader: {_eq: $trader}, _or: [{costBasis6: {_lt: $costBasis6}}, {costBasis6: {_eq: $costBasis6}, id: {_gt: $id}}]},
    order_by: [{costBasis6: desc}, {id: asc}],
    limit: $limit
  ) { ${POSITION_FIELDS} }
}`;

export interface PositionCursor {
  costBasis6: bigint;
  id: string;
}

export async function fetchPositions(
  trader: Address,
  limit: number,
  before?: PositionCursor,
): Promise<PositionRow[] | null> {
  // Checksummed, like every other address this library sends the indexer.
  const data =
    before === undefined
      ? await indexerQuery<{ Position: Raw<PositionRow>[] }>(POSITIONS_QUERY, { trader, limit })
      : await indexerQuery<{ Position: Raw<PositionRow>[] }>(POSITIONS_BEFORE_QUERY, {
          trader,
          limit,
          costBasis6: before.costBasis6.toString(),
          id: before.id,
        });
  return data === null ? null : data.Position.map(toPosition);
}

function toPosition(raw: Raw<PositionRow>): PositionRow {
  return {
    ...raw,
    tokensHeld: BigInt(raw.tokensHeld),
    costBasis6: BigInt(raw.costBasis6),
    realised6: BigInt(raw.realised6),
    feePaid6: BigInt(raw.feePaid6),
  };
}

// The sitemap wants curves and nothing else, so it gets its own minimal query
// rather than parsing every field the table needs.
export async function fetchMarketCurves(limit: number): Promise<Address[] | null> {
  const data = await indexerQuery<{ Token: { id: string }[] }>(
    `query MarketCurves($limit: Int!) { Token(order_by: {marketId: desc}, limit: $limit) { id } }`,
    { limit },
  );
  return data === null ? null : data.Token.map((row) => row.id as Address);
}

// The watchlist tab's second half: the saved curve addresses are the reader's
// own order (most recently saved first), so the rows are re-sorted to it after
// the fetch rather than inheriting the indexer's marketId order.
// Memoised, because the token route reads the same market twice in one request —
// generateMetadata for the title and the page for its metadataURI — and the
// indexer is a POST the platform's own fetch deduplication does not cover, only
// GET. React's cache() keys object arguments in a WeakMap by identity, and every
// caller passes a fresh array, so the memo key is the joined addresses and the
// exported wrapper is what holds the array.
const readMarketsByIds = cache(async (joined: string): Promise<MarketRow[] | null> => {
  const ids = joined.split(",");
  const data = await indexerQuery<{ Token: Raw<MarketRow>[] }>(
    `query MarketsByIds($ids: [String!], $limit: Int!) {
      Token(where: {id: {_in: $ids}}, order_by: {marketId: desc}, limit: $limit) { ${MARKET_FIELDS} }
    }`,
    { ids, limit: ids.length },
  );
  if (data === null) return null;
  const byId = new Map(
    data.Token.map((raw) => {
      const market = toMarket(raw);
      return [market.id.toLowerCase(), market] as const;
    }),
  );
  return ids.flatMap((id) => {
    const market = byId.get(id.toLowerCase());
    return market === undefined ? [] : [market];
  });
});

export async function fetchMarketsByIds(ids: readonly Address[]): Promise<MarketRow[] | null> {
  if (ids.length === 0) return [];
  return await readMarketsByIds(ids.join(","));
}
