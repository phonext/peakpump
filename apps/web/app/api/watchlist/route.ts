import { isAddress } from "@/lib/address";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { z } from "zod";

// A signed-in user's saved markets. The read is public because a watchlist is
// a public opinion about markets, and it is cached for five minutes at the
// CDN: nothing on this list is a price, and a market sitting on it for an
// extra minute is not a lie about anything.

const LIST_CACHE = "public, max-age=60, s-maxage=300";
const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const NOT_JSON = "The request body must be JSON.";
const ADDRESS = "Address must be a wallet address.";
const MARKET = "Market must be a wallet address.";

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

export async function GET(request: Request): Promise<Response> {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const address = new URL(request.url).searchParams.get("address");
  if (address === null || !isAddress(address)) return fail(400, ADDRESS, rate);

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  // An unknown address is an empty list and not an error: a wallet that has
  // never signed in has watched nothing, and that is the same answer as a
  // wallet that has (graphql.ts's null-versus-empty law).
  const wallet = await prisma.wallet.findUnique({
    where: { address: address.toLowerCase() },
    include: { user: { include: { watchlistItems: { orderBy: { createdAt: "desc" } } } } },
  });
  const markets = wallet === null ? [] : wallet.user.watchlistItems.map((item) => item.market);

  return Response.json(
    { markets },
    { status: 200, headers: { "cache-control": LIST_CACHE, ...rate } },
  );
}

const watchRequestSchema = z.object({
  market: z.string().regex(/^0x[0-9a-fA-F]{40}$/, MARKET),
});

export async function POST(request: Request): Promise<Response> {
  const verdict = await checkLimit("write", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const gate = await requireSession();
  if (gate.kind === "denied") return gate.response;

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, NOT_JSON, rate);
  }

  const input = watchRequestSchema.safeParse(body);
  if (!input.success) return fail(400, input.error.issues[0]?.message ?? NOT_JSON, rate);
  const market = input.data.market.toLowerCase();

  // The session's id is a wallet id; a WatchlistItem belongs to the user
  // behind that wallet, for the same reason a Follow does (the follows POST
  // carries the full explanation). Non-null by construction: a session exists
  // only because verifySiwe found or created this wallet.
  const wallet = await prisma.wallet.findUnique({
    where: { id: gate.session.user.id },
    select: { userId: true },
  });
  const userId = wallet!.userId;

  // The unique (userId, market) is what makes watching twice the same act, so
  // the route reads it and answers 200 rather than letting the constraint
  // surface as an error about a row that already exists.
  const existing = await prisma.watchlistItem.findUnique({
    where: { userId_market: { userId, market } },
  });
  if (existing !== null) {
    return Response.json(
      { market, watched: true },
      { status: 200, headers: { "cache-control": NO_STORE, ...rate } },
    );
  }

  await prisma.watchlistItem.create({
    data: { userId, market },
  });

  return Response.json(
    { market, watched: true },
    { status: 201, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
