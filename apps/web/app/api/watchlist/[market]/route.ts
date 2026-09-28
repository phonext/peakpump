import { isAddress } from "@/lib/address";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

// Unwatching. Idempotent on purpose: a second click of the same button is the
// same intent, and it answers 200 whether the row was there or already gone.

const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const MARKET = "That market does not exist.";

type Context = { params: Promise<{ market: string }> };

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const verdict = await checkLimit("write", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const gate = await requireSession();
  if (gate.kind === "denied") return gate.response;

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  const { market } = await context.params;
  if (!isAddress(market)) return fail(404, MARKET, rate);

  // The session's id is a wallet id (see the follows POST); the row keys on
  // the user behind it.
  const wallet = await prisma.wallet.findUnique({
    where: { id: gate.session.user.id },
    select: { userId: true },
  });

  const removed = await prisma.watchlistItem.deleteMany({
    where: { userId: wallet!.userId, market: market.toLowerCase() },
  });

  return Response.json(
    { removed: removed.count > 0 },
    { status: 200, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
