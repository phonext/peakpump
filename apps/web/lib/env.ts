// One reading of one server variable, shared by lib/r2.ts and lib/ratelimit.ts so the
// two do not import each other and drag one another's SDK into the same graph.
//
// Unset and empty are the same state, the two-branch guard lib/graphql.ts:26 uses:
// apps/web/.env.example ships every one of these keys with nothing after the equals
// sign, so "" is what an untouched copy of it produces.
//
// Read per call and never at module scope. lib/graphql.ts reads at module scope because
// NEXT_PUBLIC_INDEXER_URL is inlined at build time by design; a server secret must not
// be captured during a build that may run somewhere the request will not.
export function configuredEnv(name: string): string | null {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? null : raw;
}
