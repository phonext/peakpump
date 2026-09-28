import type { Creator } from "envio";

// The two rows handlers create lazily. getOrCreate seeds from these on first
// sight and returns the stored row afterwards, so the same code covers a fresh
// start and a restart mid-chain.
//
// No total in Global is ever reconciled against another entity's:
// Trade fees and FeeVault credits are two different ledgers and no equality
// between them is asserted anywhere.
// No Global type annotation: the name "Global" imported from "envio" is the
// SDK's own config interface, not this schema's entity (the entity types the
// context exposes are unaffected), so the seed row is left to its inferred
// shape, which is what context.Global.getOrCreate takes.
export const EMPTY_GLOBAL = {
  id: "global",
  totalMarkets: 0,
  totalTrades: 0,
  totalVolume6: 0n,
  totalCreatorFees6: 0n,
  totalProtocolFees6: 0n,
  totalClaims6: 0n,
};

export function creatorRow(id: string): Creator {
  return { id, totalCreatorFees6: 0n, claimed6: 0n, marketCount: 0 };
}
