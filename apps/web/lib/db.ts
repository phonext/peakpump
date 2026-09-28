import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

import { configuredEnv } from "@/lib/env";

// One client per process behind a lazy memo, the lib/ratelimit.ts pattern. The
// client owns a pg connection pool, so a second instance per request would
// spend the pooled Neon connection limit without buying anything.
//
// DATABASE_URL is read on first use, never at module scope: an unconfigured
// machine must be able to import this module (health wants to report
// "unconfigured", not crash on load), and a test that changes the environment
// re-imports the module instead of fighting a stale memo.

let client: PrismaClient | null = null;

export function db(): PrismaClient | null {
  if (client !== null) return client;
  const url = configuredEnv("DATABASE_URL");
  if (url === null) return null;
  client = new PrismaClient({ adapter: new PrismaPg(url) });
  return client;
}
