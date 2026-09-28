import type { Address } from "viem";
import { createSiweMessage } from "viem/siwe";

// The client half of the SIWE pair. lib/auth.ts owns the statement and the
// chain id but is a server module — it pulls in prisma and Auth.js, so a
// client component importing it would drag both into the browser. The two
// constants are restated here instead, and a unit test pins them to
// lib/auth's own exports, so the pair cannot drift silently.

export const SIWE_STATEMENT_CLIENT =
  "Sign in to peakpump. This request will not create a transaction or cost any fee.";

export const SIWE_CHAIN_ID_CLIENT = 5_042_002;

export interface SiweMessageInput {
  address: Address;
  nonce: string;
  // The host with no scheme, which is what EIP-4361's domain field is and what
  // the server compares against NEXTAUTH_URL's host.
  domain: string;
  // The origin, which EIP-4361 requires and the server leaves unpinned.
  uri: string;
}

// viem's own composer, so the message's grammar is never hand-written here.
// issuedAt is the moment of signing, and no expiry is stated: the nonce's own
// five-minute TTL is the clock that matters, and the server enforces it.
export function buildSiweMessage(input: SiweMessageInput): string {
  return createSiweMessage({
    address: input.address,
    chainId: SIWE_CHAIN_ID_CLIENT,
    domain: input.domain,
    nonce: input.nonce,
    statement: SIWE_STATEMENT_CLIENT,
    uri: input.uri,
    version: "1",
    issuedAt: new Date(),
  });
}
