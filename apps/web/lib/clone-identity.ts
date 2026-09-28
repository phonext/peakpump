import type { Address } from "viem";
import { getAddress, isAddressEqual } from "viem";
import type { ReadClient } from "@/lib/viem";

// The EIP-1167 runtime OpenZeppelin's Clones.clone writes, split around the 20
// bytes that name the implementation:
// 363d3d373d3d3d363d73 <impl> 5af43d82803e903d91602b57fd5bf3
// Both halves are compared as written, so a proxy that merely ends in a
// DELEGATECALL — one with an admin slot, or one whose target is a storage read
// rather than an immediate — does not match. That is the point: a badge saying
// there is no admin key is only worth anything if the shape it recognises is the
// shape that has none.
const PREFIX = "363d3d373d3d3d363d73";
const SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const RUNTIME_LENGTH = 2 + (PREFIX.length + 40 + SUFFIX.length);

// Undefined for anything that is not this exact runtime, including an account with
// no code at all: an EOA, a self-destructed clone and a hand-written proxy are all
// "not provably a clone of anything", which is the answer the badge needs.
export function eip1167Implementation(code: string | undefined): Address | undefined {
  if (code === undefined || code.length !== RUNTIME_LENGTH) return undefined;
  const body = code.slice(2).toLowerCase();
  if (!body.startsWith(PREFIX) || !body.endsWith(SUFFIX)) return undefined;
  return getAddress(`0x${body.slice(PREFIX.length, PREFIX.length + 40)}`);
}

export interface CloneIdentity {
  implementation: Address | undefined;
  // Separate from a null implementation so a render can tell "not a clone" from
  // "a clone of something else". The first is a chain that answered; the second
  // is a market that is not ours.
  matches: boolean;
}

export async function readCloneIdentity(
  client: ReadClient,
  address: Address,
  expected: Address,
): Promise<CloneIdentity> {
  const implementation = eip1167Implementation(await client.getCode({ address }));
  return {
    implementation,
    matches: implementation !== undefined && isAddressEqual(implementation, expected),
  };
}
