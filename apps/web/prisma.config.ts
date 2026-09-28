import { env } from "node:process";

import "dotenv/config";

import { defineConfig } from "prisma/config";

// The CLI's connection lives here in Prisma 7, not in the schema block. Migrate
// must use the direct connection: Neon's pooled endpoint holds transactions
// open across a connection pool that migrations assume is one session, and the
// migration fails without the second URL. The runtime never reads this file;
// the app connects through the pg driver adapter with DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: env.DIRECT_URL,
    shadowDatabaseUrl: env.SHADOW_DATABASE_URL,
  },
});
