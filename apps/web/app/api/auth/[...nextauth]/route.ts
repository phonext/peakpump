import NextAuth from "next-auth";

import { authOptions } from "@/lib/auth";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests, type LimitTier } from "@/lib/ratelimit";

// The Auth.js v4 catch-all mount. The app itself uses csrf, callback/credentials,
// session and signout; the other default endpoints (providers, signin) are also
// answered here and are declared in the route table rather than hidden. The
// default sign-in page renders through preact and is unused — sign-in is the
// SIWE modal — but it is served, so it is limited like everything
// else.
//
// The limiter sits in front of the handler rather than inside it: POST costs an
// on-chain signature verification, which is the write-tier cost, and GET
// (csrf, session) is a plain read.

type Context = { params: Promise<Record<string, string[]>> };

const handler = NextAuth(authOptions);

async function limited(tier: LimitTier, request: Request, context: Context): Promise<Response> {
  const verdict = await checkLimit(tier, clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const response = await handler(request, context);
  // No-store on both verbs: the csrf and session pages are read-only, but a cached
  // nonce answer is a replay surface, and the policy is one header for the whole
  // mount rather than a per-endpoint decision about which one is dangerous.
  response.headers.set("cache-control", "no-store");
  // The counters belong on the answer whatever answered it, so a caller can
  // read its allowance off an Auth.js page as off any other route.
  for (const [name, value] of Object.entries(limitHeaders(verdict))) {
    response.headers.set(name, value);
  }
  return response;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return await limited("read", request, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return await limited("write", request, context);
}
