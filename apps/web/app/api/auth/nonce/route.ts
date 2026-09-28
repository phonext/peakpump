import { randomBytes } from "node:crypto";
import { z } from "zod";

import { NONCE_TTL_SECONDS } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";

// The SIWE challenge minter. A nonce is 32 bytes of CSPRNG hex — viem's
// generateSiweNonce is a uid(96) and not this, which is why it is not used —
// bound from birth to the address that asked for it, single-use, and dead in
// five minutes. Expired rows are deleted by the next request from the same
// address, which is the only sweeper a testnet deployment needs.

const NO_STORE = "no-store";

const NO_DATABASE = "The database is not configured.";
const NOT_JSON = "The request body must be JSON.";

const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Address must be a wallet address");

const nonceRequestSchema = z.object({ address: addressSchema });

function fail(status: number, error: string, rate: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": NO_STORE, ...rate } });
}

export async function POST(request: Request): Promise<Response> {
  const verdict = await checkLimit("write", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const prisma = db();
  if (prisma === null) return fail(503, NO_DATABASE, rate);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, NOT_JSON, rate);
  }

  const input = nonceRequestSchema.safeParse(body);
  if (!input.success) {
    return fail(400, input.error.issues[0]?.message ?? NOT_JSON, rate);
  }
  const address = input.data.address.toLowerCase();

  // The lazy sweep, scoped to the one address that is asking: a global delete
  // per request would put the whole table in one transaction on every call.
  await prisma.siweNonce.deleteMany({ where: { address, expiresAt: { lte: new Date() } } });

  const nonce = randomBytes(32).toString("hex");
  await prisma.siweNonce.create({
    data: { nonce, address, expiresAt: new Date(Date.now() + NONCE_TTL_SECONDS * 1000) },
  });

  return Response.json({ nonce }, { status: 201, headers: { "cache-control": NO_STORE, ...rate } });
}
