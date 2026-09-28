import { isAddress } from "@/lib/address";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { z } from "zod";

// Follows read two ways: the markets-less version of a watchlist (who this
// address follows) and the follower list (who follows this address). The two
// questions are one query apart on the same table, so they share a route and a
// cache, and exactly one of the two parameters decides which question it is.

const LIST_CACHE = "public, max-age=60, s-maxage=300";
const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const NOT_JSON = "The request body must be JSON.";
const ONE_OF = "Pass exactly one of address or target.";
const ADDRESS = "Address must be a wallet address.";

function fail(status: number, error: string, rate: Record<string, string>, cache = NO_STORE): Response {
  return Response.json({ error }, { status, headers: { "cache-control": cache, ...rate } });
}

export async function GET(request: Request): Promise<Response> {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const params = new URL(request.url).searchParams;
  const address = params.get("address");
  const target = params.get("target");
  if ((address === null) === (target === null)) return fail(400, ONE_OF, rate);

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  // Unknown addresses are empty lists, not errors: an address that never
  // signed in follows no one and is followed by no one, and both are facts
  // worth saying with an array (graphql.ts's null-versus-empty law).
  if (address !== null) {
    if (!isAddress(address)) return fail(400, ADDRESS, rate);
    const wallet = await prisma.wallet.findUnique({
      where: { address: address.toLowerCase() },
      include: { user: { include: { follows: { orderBy: { createdAt: "desc" } } } } },
    });
    const following = wallet === null ? [] : wallet.user.follows.map((follow) => follow.targetAddress);
    return Response.json(
      { following },
      { status: 200, headers: { "cache-control": LIST_CACHE, ...rate } },
    );
  }

  // target is non-null here: the ONE_OF check above made exactly-one a fact.
  if (!isAddress(target!)) return fail(400, ADDRESS, rate);
  const rows = await prisma.follow.findMany({
    where: { targetAddress: target!.toLowerCase() },
    orderBy: { createdAt: "desc" },
    include: { user: { include: { wallets: { select: { address: true } } } } },
  });
  // A follow belongs to a user, and an address is how a user is named in
  // public: every wallet the user has signed in with stands for them here.
  const followers = rows.flatMap((row) => row.user.wallets.map((wallet) => wallet.address));

  return Response.json(
    { followers },
    { status: 200, headers: { "cache-control": LIST_CACHE, ...rate } },
  );
}

const followRequestSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, ADDRESS),
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

  const input = followRequestSchema.safeParse(body);
  if (!input.success) return fail(400, input.error.issues[0]?.message ?? NOT_JSON, rate);
  const targetAddress = input.data.address.toLowerCase();

  // The session names the wallet that signed in; a Follow row belongs to the
  // user behind that wallet, because one user can hold several wallets and the
  // follow is theirs (verifySiwe puts a wallet id in the token, and the
  // Comment and Report rows key on it directly). Non-null by construction: a
  // session exists only because verifySiwe found or created this wallet, and
  // nothing in this app deletes one.
  const wallet = await prisma.wallet.findUnique({
    where: { id: gate.session.user.id },
    select: { userId: true },
  });
  const userId = wallet!.userId;

  // Same law as the watchlist: the unique (userId, targetAddress) makes
  // following twice the same act, so a repeat is a 200 and not a constraint
  // error.
  const existing = await prisma.follow.findUnique({
    where: { userId_targetAddress: { userId, targetAddress } },
  });
  if (existing !== null) {
    return Response.json(
      { address: targetAddress, following: true },
      { status: 200, headers: { "cache-control": NO_STORE, ...rate } },
    );
  }

  await prisma.follow.create({
    data: { userId, targetAddress },
  });

  return Response.json(
    { address: targetAddress, following: true },
    { status: 201, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
