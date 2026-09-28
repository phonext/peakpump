import type { Session } from "next-auth";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/lib/auth";

// The gate every mutating social route stands behind: no session, no write.
// Reading and trading never come through here — a session buys commenting,
// uploading and profile edits and nothing else.
//
// getServerSession takes no request argument: it reads next/headers itself,
// which is also why a unit test of a route has to mock this module rather than
// build a request scope.

export type SessionGate = { kind: "ok"; session: Session } | { kind: "denied"; response: Response };

const SIGN_IN = "Sign in to do that.";

export async function requireSession(): Promise<SessionGate> {
  // The promise rejects only on a broken deployment (no secret, no URL), and a
  // caller facing that deserves the 500 the throw becomes rather than a 401
  // that would send them hunting for a wallet popup.
  const session = await getServerSession(authOptions);
  if (session === null || session.user.address === undefined) {
    return {
      kind: "denied",
      response: Response.json({ error: SIGN_IN }, { status: 401, headers: { "cache-control": "no-store" } }),
    };
  }
  return { kind: "ok", session };
}
