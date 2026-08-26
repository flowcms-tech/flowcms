import { defineConfig } from "drizzle-kit"

/**
 * PostgreSQL migration track.
 *
 * The schema entry point re-exports the tables derived from the canonical
 * SQLite definitions — see src/db/schema.postgresql.ts.
 */
export default defineConfig({
  schema: "./src/db/schema.postgresql.ts",
  out: "./src/db/migrations/postgresql",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://flowcms:flowcms@127.0.0.1:5432/flowcms",
  },
})
