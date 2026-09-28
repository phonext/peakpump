import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

// An author soft-deletes their own comment into a tombstone: the row stays,
// the body goes, and the list serves the row without the words. A hard delete
// does not exist on this route, because a reply-shaped hole in a flat list is
// indistinguishable from a list that was never told the truth.

const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const NO_COMMENT = "That comment does not exist.";
const NOT_AUTHOR = "Only the author can delete that comment.";

type Context = { params: Promise<{ id: string }> };

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

  const { id } = await context.params;

  const comment = await prisma.comment.findUnique({ where: { id } });
  if (comment === null) return fail(404, NO_COMMENT, rate);
  if (comment.walletId !== gate.session.user.id) return fail(403, NOT_AUTHOR, rate);

  // Idempotent on a tombstone: deleting twice is the same act, and the second
  // answer is the same 200 rather than an error about a comment that is
  // already gone from every list.
  await prisma.comment.update({
    where: { id },
    data: { body: null, deletedAt: new Date() },
  });

  return Response.json({ deleted: true }, { status: 200, headers: { "cache-control": NO_STORE, ...rate } });
}
