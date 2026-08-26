import { defineConfig } from "drizzle-kit"

/**
 * MySQL migration track, shared with MariaDB.
 *
 * MariaDB is verified independently against a real MariaDB server rather than
 * assumed compatible; the moment it needs different SQL it gets its own track.
 */
export default defineConfig({
  schema: "./src/db/schema.mysql.ts",
  out: "./src/db/migrations/mysql",
  dialect: "mysql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "mysql://flowcms:flowcms@127.0.0.1:3306/flowcms",
  },
})
