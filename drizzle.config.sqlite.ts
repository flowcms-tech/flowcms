import { defineConfig } from "drizzle-kit"

/**
 * SQLite migration track.
 *
 * `dialect: "turso"` is Drizzle's name for the libsql driver even for a purely
 * local file — it is not a hosted-Turso setting.
 */
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations/sqlite",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:data/app.db",
  },
})
