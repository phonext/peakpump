import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { z } from "zod";

// The report action: one row, one reporter, one target, one reason from
// the fixed set. There is no admin UI, no notification and no email on
// testnet; a report is triaged by a direct database query, and this route is
// the only way a row gets written.
//
// No target-existence validation, by design: a market or account target is a
// chain address, and checking it against the chain would put chain data in a
// route that must not hold any. The zod schema is the whole check.

const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const NOT_JSON = "The request body must be JSON.";
const ADDRESS = "That target is not an address.";

const TARGET_TYPE = "Target type must be market, comment or account.";
const REASON = "Reason must be one of spam, impersonation, abuse and other.";

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

// MARKET and ACCOUNT targets are addresses; a COMMENT target is a comment id.
// The split is mechanical validation only, which is all a route is asked to do.
const reportRequestSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("MARKET"),
    targetId: z.string().regex(/^0x[0-9a-fA-F]{40}$/, ADDRESS),
    reason: z.enum(["SPAM", "IMPERSONATION", "ABUSE", "OTHER"], REASON),
  }),
  z.object({
    targetType: z.literal("ACCOUNT"),
    targetId: z.string().regex(/^0x[0-9a-fA-F]{40}$/, ADDRESS),
    reason: z.enum(["SPAM", "IMPERSONATION", "ABUSE", "OTHER"], REASON),
  }),
  z.object({
    targetType: z.literal("COMMENT"),
    targetId: z.string().min(1, ADDRESS),
    reason: z.enum(["SPAM", "IMPERSONATION", "ABUSE", "OTHER"], REASON),
  }),
]);

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

  const input = reportRequestSchema.safeParse(body);
  if (!input.success) {
    // The first issue's sentence, or the union's own when the target type is
    // not one of the three: both name the fixed set in a person's words. A
    // wrong discriminator surfaces as invalid_union, whose own message lists
    // the literals it expected, so that one is replaced outright.
    const issue = input.error.issues[0];
    const error =
      issue !== undefined && issue.code === "invalid_union"
        ? TARGET_TYPE
        : (issue?.message ?? NOT_JSON);
    return fail(400, error, rate);
  }

  const { targetType, reason } = input.data;
  const targetId =
    input.data.targetType === "COMMENT" ? input.data.targetId : input.data.targetId.toLowerCase();

  // One report per address per target, the unique constraint's law. A second
  // click of a report button is not an error state: it answers 200 with the
  // row that is already there.
  const existing = await prisma.report.findUnique({
    where: {
      reporterWalletId_targetType_targetId: {
        reporterWalletId: gate.session.user.id,
        targetType,
        targetId,
      },
    },
  });
  if (existing !== null) {
    return Response.json(
      { reported: true },
      { status: 200, headers: { "cache-control": NO_STORE, ...rate } },
    );
  }

  await prisma.report.create({
    data: { reporterWalletId: gate.session.user.id, targetType, targetId, reason },
  });

  return Response.json(
    { reported: true },
    { status: 201, headers: { "cache-control": NO_STORE, ...rate } },
  );
}
