import { isAddress } from "@/lib/address";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

// Unfollowing. Idempotent, like unwatching: the answer is 200 whether the row
// was there or already gone.

const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const ADDRESS = "That address is not an address.";

type Context = { params: Promise<{ address: string }> };

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

  const { address } = await context.params;
  if (!isAddress(address)) return fail(404, ADDRESS, rate);

  // The session's id is a wallet id (see the POST above); the row keys on the
  // user behind it.
  const wallet = await prisma.wallet.findUnique({
    where: { id: gate.session.user.id },
    select: { userId: true },
  });

  const removed = await prisma.follow.deleteMany({
    where: { userId: wallet!.userId, targetAddress: address.toLowerCase() },
  });

  return Response.json(
    { removed: removed.count > 0 },
    { status: 200, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
