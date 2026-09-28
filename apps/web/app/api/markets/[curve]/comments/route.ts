import { descriptionSchema } from "@peakpump/shared/validation";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

import { isAddress } from "@/lib/address";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";

// Flat comments, one market at a time: no threading, no replies, no
// nesting, at most 500 characters, one per address per market per 30 seconds,
// enforced here and nowhere else. A read is public and cached for a minute at
// the CDN so the list catches a new comment within the minute; a write is
// no-store and gated on a session, because reading and trading never need a
// session and commenting does.

const LIST_CACHE = "public, max-age=30, s-maxage=60";
const NO_STORE = "no-store";

// SPEC fixes the shape of a comment, not the size of a page; 50 is this
// route's own choice, and the cursor makes any deeper page reachable.
const PAGE_SIZE = 50;

const COMMENT_INTERVAL_MS = 30_000;

const NO_DATABASE = "The database is not configured.";
const NOT_JSON = "The request body must be JSON.";
const NO_MARKET = "That market does not exist.";

type Context = { params: Promise<{ curve: string }> };

type CommentRow = {
  id: string;
  body: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  wallet: { address: string };
};

function serialized(row: CommentRow) {
  // A tombstone keeps the row and drops the body: the list still counts the
  // comment and still shows who wrote it, but the words are gone for good.
  if (row.deletedAt !== null || row.body === null) {
    return { id: row.id, address: row.wallet.address, deleted: true, createdAt: row.createdAt.toISOString() };
  }
  return {
    id: row.id,
    address: row.wallet.address,
    body: row.body,
    deleted: false,
    createdAt: row.createdAt.toISOString(),
  };
}

function fail(status: number, error: string, rate: Record<string, string>, cache = NO_STORE): Response {
  return Response.json({ error }, { status, headers: { "cache-control": cache, ...rate } });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const { curve } = await context.params;
  if (!isAddress(curve)) return fail(404, NO_MARKET, rate, LIST_CACHE);

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  const market = curve.toLowerCase();

  // Keyset, not offset: a new comment during paging shifts every offset and
  // repeats a row, while (createdAt, id) has a total order because the id is
  // unique. Postgres wall clock, not a chain timestamp — this codebase never orders
  // by block.timestamp, and these rows are not chain data.
  let cursorClause: Prisma.CommentWhereInput = {};
  const before = new URL(request.url).searchParams.get("before");
  if (before !== null) {
    const cursor = await prisma.comment.findUnique({ where: { id: before } });
    if (cursor === null) return fail(404, "That comment does not exist.", rate, LIST_CACHE);
    cursorClause = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  const rows = await prisma.comment.findMany({
    where: { market, ...cursorClause },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE,
    include: { wallet: { select: { address: true } } },
  });

  return Response.json(
    { comments: rows.map(serialized) },
    { status: 200, headers: { "cache-control": LIST_CACHE, ...rate } },
  );
}

const commentRequestSchema = z.object({ body: descriptionSchema });

export async function POST(request: Request, context: Context): Promise<Response> {
  const verdict = await checkLimit("write", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const gate = await requireSession();
  if (gate.kind === "denied") return gate.response;

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  const { curve } = await context.params;
  if (!isAddress(curve)) return fail(404, NO_MARKET, rate);
  const market = curve.toLowerCase();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, NOT_JSON, rate);
  }

  // descriptionSchema from packages/shared: the same 500-codepoint cap the
  // create form enforces, so a comment cannot drift from the one length rule
  // the project already states.
  const input = commentRequestSchema.safeParse(body);
  if (!input.success) {
    return fail(400, input.error.issues[0]?.message ?? NOT_JSON, rate);
  }

  // The throttle probe, any row included — a deleted comment must not reset
  // the clock, or deleting and reposting becomes the bypass.
  const latest = await prisma.comment.findFirst({
    where: { walletId: gate.session.user.id, market },
    orderBy: { createdAt: "desc" },
  });
  if (latest !== null) {
    const waited = Date.now() - latest.createdAt.getTime();
    if (waited < COMMENT_INTERVAL_MS) {
      const seconds = Math.max(1, Math.ceil((COMMENT_INTERVAL_MS - waited) / 1000));
      return Response.json(
        { error: `Wait ${seconds} second${seconds === 1 ? "" : "s"} before commenting again.` },
        {
          status: 429,
          headers: { "cache-control": NO_STORE, "retry-after": String(seconds), ...rate },
        },
      );
    }
  }

  const row = await prisma.comment.create({
    data: { walletId: gate.session.user.id, market, body: input.data.body },
    include: { wallet: { select: { address: true } } },
  });

  return Response.json(
    { comment: serialized(row) },
    { status: 201, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
