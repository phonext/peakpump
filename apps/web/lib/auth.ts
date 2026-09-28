import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { parseSiweMessage } from "viem/siwe";

import { db } from "@/lib/db";
import { configuredEnv } from "@/lib/env";
import { verifySiweSignature } from "@/lib/siwe";

// SIWE: one message, one nonce, one session. The statement is the exact
// sentence this module fixes, the chain is Arc Testnet, and the domain is the deployed
// host with no scheme. Sign-in is never required to read or to trade; a session
// exists to comment, to upload, and to edit a profile.

export const SIWE_STATEMENT = "Sign in to peakpump. This request will not create a transaction or cost any fee.";
export const SIWE_CHAIN_ID = 5_042_002;

const NONCE_TTL_MS = 5 * 60 * 1000;
export const NONCE_TTL_SECONDS = NONCE_TTL_MS / 1000;

// The expected domain comes from NEXTAUTH_URL and never from a request header:
// x-forwarded-host is client-forgeable whenever a request arrives unproxied, and
// a domain check against attacker input is a domain check an attacker passes.
function expectedDomain(): string | null {
  const url = configuredEnv("NEXTAUTH_URL");
  if (url === null) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// verifySiweMessage pins address, domain, nonce, scheme and time against the
// message's own text, and answers EOAs and smart accounts alike (ERC-1271 and
// the ERC-6492 counterfactual unwrap). It cannot pin the fields below, so the
// parse and the comparisons are ours, and every field of the parse may be
// undefined because a malformed message is data, not an exception.
export async function verifySiwe(message: string, signature: string): Promise<{ id: string; address: string } | null> {
  const domain = expectedDomain();
  if (domain === null) return null;

  const parsed = parseSiweMessage(message);
  if (parsed.address === undefined) return null;
  if (parsed.statement !== SIWE_STATEMENT) return null;
  if (parsed.chainId !== SIWE_CHAIN_ID) return null;
  if (parsed.version !== "1") return null;
  if (parsed.domain !== domain) return null;
  if (parsed.nonce === undefined) return null;

  const address = parsed.address.toLowerCase();
  const prisma = db();
  if (prisma === null) return null;

  // The nonce must exist, be unexpired, and belong to the address presenting
  // it. A nonce minted for one wallet signing a message for another is the
  // replay this binding closes.
  const nonce = await prisma.siweNonce.findFirst({
    where: { nonce: parsed.nonce, address, expiresAt: { gt: new Date() } },
  });
  if (nonce === null) return null;

  if (!(await verifySiweSignature(message, signature as `0x${string}`))) return null;

  // Delete by (nonce, address) and require exactly one row gone. Two verifies
  // racing on one nonce both find the row, and the delete count is what makes
  // the second one fail instead of minting two sessions from one challenge.
  const deleted = await prisma.siweNonce.deleteMany({ where: { nonce: parsed.nonce, address } });
  if (deleted.count !== 1) return null;

  // First sign-in creates a User with this Wallet; a returning address finds
  // its wallet. Multiple wallets per user is the schema's capability, and the
  // linking flow that would exercise it is not built yet.
  const wallet = await prisma.wallet.findUnique({ where: { address } });
  if (wallet !== null) return { id: wallet.id, address };

  const user = await prisma.user.create({
    data: { wallets: { create: { address } } },
    include: { wallets: { where: { address } } },
  });
  // The nested create above is what put the row there, so [0] cannot be a miss.
  const created = user.wallets[0]!;
  return { id: created.id, address: created.address };
}

declare module "next-auth" {
  interface Session {
    user: { id: string; address: string };
  }

  interface User {
    id: string;
    address: string;
  }
}

export const authOptions: NextAuthOptions = {
  // JWT strategy is mandatory for a Credentials provider. The cookie carrying
  // it is an encrypted JWE, so it is signed and opaque to the browser alike.
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  providers: [
    CredentialsProvider({
      name: "Ethereum",
      credentials: {
        message: { label: "SIWE message", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        if (credentials?.message === undefined || credentials?.signature === undefined) return null;
        return await verifySiwe(credentials.message, credentials.signature);
      },
    }),
  ],
  callbacks: {
    // The token carries the wallet id and address and nothing else; the session
    // exposes the same two, so a client learns who is signed in and no more.
    async jwt({ token, user }) {
      if (user !== undefined) {
        token.id = user.id;
        token.address = user.address;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = { id: token.id as string, address: token.address as string };
      return session;
    },
  },
  cookies: {
    sessionToken: {
      // Pinned rather than left to the derived default: Auth.js derives
      // useSecureCookies from the request's own view of the scheme, which a
      // misread proxy header can downgrade. Production serves over HTTPS,
      // full stop.
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.session-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
};
