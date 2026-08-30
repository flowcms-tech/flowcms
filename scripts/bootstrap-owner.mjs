import bcrypt from "bcryptjs"
import { resolveConfig, redactDatabaseUrl } from "./migrate.mjs"

/**
 * Create the first FlowCMS owner, once, on a fresh installation.
 *
 *   FLOWCMS_OWNER_EMAIL=you@example.com \
 *   FLOWCMS_OWNER_PASSWORD='…' \
 *   FLOWCMS_OWNER_NAME='Your Name' \
 *     node scripts/bootstrap-owner.mjs
 *
 * WHY ENVIRONMENT AND NOT ARGUMENTS
 *
 * The future `create-flowcms` installer invokes this without a shell. Passing a
 * password as an argv element puts it in `ps` output and in shell history for
 * every other user on the machine; an environment variable is visible to far
 * fewer eyes and needs no quoting rules to get right.
 *
 * WHY THIS IS NOT THE DEV SEED
 *
 * `src/db/seed.ts` is sample data for a developer's machine. This is a
 * production bootstrap primitive: it makes exactly one owner on an empty
 * install and refuses everything else. Conflating them is how projects end up
 * shipping `admin@example.com` / `password123` to the internet.
 *
 * Plain ESM so it runs in the Node 22 production image, with no TypeScript
 * loader and no Bun — the same constraint as `migrate.mjs`.
 */

const BCRYPT_COST = 12 // must match src/Framework/Auth/password.ts
const MIN_PASSWORD_LENGTH = 6 // must match MIN_OWNER_PASSWORD_LENGTH in src/Framework/Setup/ownerRules.ts

/** Deliberately the same normalisation as src/Framework/Auth/identity.ts.
 *  Email identity must not depend on which engine stores it. */
function normalizeEmail(value) {
  return String(value).trim().toLowerCase()
}

function fail(message) {
  console.error(`Bootstrap failed: ${message}`)
  process.exit(1)
}

function readInputs(env) {
  const email = normalizeEmail(env.FLOWCMS_OWNER_EMAIL ?? "")
  const password = env.FLOWCMS_OWNER_PASSWORD ?? ""
  const name = (env.FLOWCMS_OWNER_NAME ?? "").trim() || null

  if (!email) fail("FLOWCMS_OWNER_EMAIL is required")
  // Shape only. The authoritative validation is the Zod schema the admin UI
  // uses; this is the same rule expressed where Zod cannot reach.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("FLOWCMS_OWNER_EMAIL is not a valid email address")
  if (email.length > 100) fail("FLOWCMS_OWNER_EMAIL is too long (max 100)")

  if (!password) fail("FLOWCMS_OWNER_PASSWORD is required")
  if (password.length < MIN_PASSWORD_LENGTH) {
    // The length is reported; the password never is.
    fail(`FLOWCMS_OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  return { email, password, name }
}

/**
 * Open a connection for the configured dialect and hand back the operations
 * bootstrap needs. Dialect knowledge stops here — the bootstrap logic below
 * never learns which engine it is talking to.
 *
 * `initialize` does the owner insert and the setup marker IN ONE TRANSACTION,
 * and that is the whole reason this shape changed in Phase 7.1. Two separate
 * statements can half-succeed, and both halves are bad:
 *
 *   owner written, marker not  ->  /setup stays open on an installation that
 *                                  already has an owner, so a stranger holding
 *                                  the deployment token can claim it too
 *   marker written, owner not  ->  /setup is closed on an installation nobody
 *                                  can log into, and nothing in the product
 *                                  can reopen it
 *
 * The settings row may or may not exist — a database bootstrapped before ever
 * opening the admin panel has no row — so the marker write is an insert-if-
 * absent followed by a conditional update, which is the same claim
 * `src/Framework/Setup/completeSetup.ts` makes for the web path.
 */
async function openDatabase(config) {
  if (config.driverFamily === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const client = createClient({ url: config.url })
    await client.execute("PRAGMA foreign_keys = ON")
    return {
      anyUserExists: async () => {
        const r = await client.execute("select count(*) as n from user")
        return Number(r.rows[0]?.n ?? 0) > 0
      },
      setupCompleted: async () => {
        const r = await client.execute(
          "select count(*) as n from settings where id = 'global' and setupCompletedAt is not null",
        )
        return Number(r.rows[0]?.n ?? 0) > 0
      },
      initialize: async (row) => {
        // `batch(..., "write")` is libsql's transaction: every statement
        // commits together or none does.
        await client.batch(
          [
            {
              sql: `insert into user (id, name, email, passwordHash, isActive, role, createdAt, updatedAt)
                    values (?, ?, ?, ?, 1, 'owner', ?, ?)`,
              args: [row.id, row.name, row.email, row.passwordHash, row.now, row.now],
            },
            {
              sql: `insert into settings (id, setupCompletedAt, updatedAt)
                    select 'global', ?, ? from (select 1) as d
                    where not exists (select 1 from settings)`,
              args: [row.now, row.now],
            },
            {
              sql: `update settings set setupCompletedAt = ?, updatedAt = ?
                    where id = 'global' and setupCompletedAt is null`,
              args: [row.now, row.now],
            },
          ],
          "write",
        )
      },
      close: async () => client.close(),
    }
  }

  if (config.driverFamily === "postgresql") {
    const { default: postgres } = await import("postgres")
    const sql = postgres(config.url, { max: 1, onnotice: () => {} })
    return {
      anyUserExists: async () => {
        const rows = await sql`select count(*)::int as n from "user"`
        return Number(rows[0]?.n ?? 0) > 0
      },
      setupCompleted: async () => {
        const rows = await sql`
          select count(*)::int as n from "settings"
          where "id" = 'global' and "setupCompletedAt" is not null
        `
        return Number(rows[0]?.n ?? 0) > 0
      },
      initialize: async (row) => {
        await sql.begin(async (tx) => {
          await tx`
            insert into "user" (id, name, email, "passwordHash", "isActive", role, "createdAt", "updatedAt")
            values (${row.id}, ${row.name}, ${row.email}, ${row.passwordHash}, true, 'owner', ${row.now}, ${row.now})
          `
          await tx`
            insert into "settings" ("id", "setupCompletedAt", "updatedAt")
            select 'global', ${row.now}, ${row.now} from (select 1) as d
            where not exists (select 1 from "settings")
          `
          await tx`
            update "settings" set "setupCompletedAt" = ${row.now}, "updatedAt" = ${row.now}
            where "id" = 'global' and "setupCompletedAt" is null
          `
        })
      },
      close: async () => sql.end({ timeout: 5 }),
    }
  }

  const { default: mysql } = await import("mysql2/promise")
  const conn = await mysql.createConnection({ uri: config.url })
  return {
    anyUserExists: async () => {
      const [rows] = await conn.query("select count(*) as n from user")
      return Number(rows[0]?.n ?? 0) > 0
    },
    setupCompleted: async () => {
      const [rows] = await conn.query(
        "select count(*) as n from settings where id = 'global' and setupCompletedAt is not null",
      )
      return Number(rows[0]?.n ?? 0) > 0
    },
    initialize: async (row) => {
      await conn.beginTransaction()
      try {
        await conn.execute(
          `insert into user (id, name, email, passwordHash, isActive, role, createdAt, updatedAt)
           values (?, ?, ?, ?, 1, 'owner', ?, ?)`,
          [row.id, row.name, row.email, row.passwordHash, row.now, row.now],
        )
        await conn.execute(
          `insert into settings (id, setupCompletedAt, updatedAt)
           select 'global', ?, ? from (select 1) as d
           where not exists (select 1 from (select 1 from settings limit 1) as existing)`,
          [row.now, row.now],
        )
        await conn.execute(
          `update settings set setupCompletedAt = ?, updatedAt = ?
           where id = 'global' and setupCompletedAt is null`,
          [row.now, row.now],
        )
        await conn.commit()
      } catch (error) {
        await conn.rollback().catch(() => {})
        throw error
      }
    },
    close: async () => conn.end(),
  }
}

async function main() {
  const { email, password, name } = readInputs(process.env)
  const config = resolveConfig(process.env)

  console.log(`FlowCMS: bootstrapping first owner on ${config.dialect} (${config.safeUrl})`)

  const store = await openDatabase(config)

  try {
    // Refuse if this installation has already been INITIALIZED, whether or not
    // it currently has users.
    //
    // The two checks are not redundant. `setupCompletedAt` survives someone
    // deleting every account, and without this check a bootstrap run against
    // such a database would mint a "first owner" on an installation that
    // already had one — the mirror image of the defect the marker exists to
    // prevent on the web side.
    if (await store.setupCompleted()) {
      fail(
        "this installation has already been initialized. " +
          "Bootstrap only runs on a fresh installation; create further accounts in the admin panel.",
      )
    }

    // Refuse if ANY user exists. This is a bootstrap primitive, not user
    // administration: it must not quietly mint a second owner, and it must not
    // promote somebody's existing account. An installed system is configured
    // through the admin panel.
    if (await store.anyUserExists()) {
      fail(
        "this installation already has at least one user. " +
          "Bootstrap only runs on an empty installation; create further accounts in the admin panel.",
      )
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

    // The unique index on `user.email` is the real guard against two
    // bootstraps racing: whichever insert loses raises a constraint violation
    // rather than producing a second owner. The check above is the friendly
    // path; this is the correct one, and it holds on all four engines without
    // any dialect-specific locking.
    //
    // Owner and marker are written together, in one transaction. Creating the
    // owner while leaving `/setup` open would be a security defect: the
    // installation would have an owner AND still offer ownership to anyone
    // holding the deployment token.
    await store.initialize({
      id: crypto.randomUUID(),
      name,
      email,
      passwordHash,
      now: Date.now(),
    })

    console.log(`Owner created: ${email} (role: owner)`)
    // Site identity is deliberately left at its defaults. This is an OWNER
    // primitive — it takes no site name or tagline, because a value passed on
    // the command line of a bootstrap script is a value nobody revisits. The
    // owner sets brand identity in Admin > Settings after signing in.
    console.log("First-run setup is now closed. Sign in to configure site identity.")
  } finally {
    await store.close().catch(() => {})
  }
}

main().catch((error) => {
  const raw = error instanceof Error ? error.message : String(error)
  const url = process.env.DATABASE_URL
  let message = url ? raw.split(url).join(redactDatabaseUrl(url)) : raw

  // Belt and braces: never let a password reach a log, however it got into the
  // error. Errors from drivers can quote the statement they were running.
  const password = process.env.FLOWCMS_OWNER_PASSWORD
  if (password) message = message.split(password).join("***")

  if (/duplicate|unique/i.test(message)) {
    message = "an account with that email already exists"
  }

  console.error("Bootstrap failed:", message)
  process.exitCode = 1
})
