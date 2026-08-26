import { resolveConfig } from "./migrate.mjs"

/**
 * Persistence marker, written and read through the same database configuration
 * the application uses.
 *
 * Deliberately writes a real FlowCMS row (`blog_tag`) rather than a scratch
 * table: the question is whether *the application's data* survives a restart,
 * and a bespoke table could persist while the real schema's volume mapping was
 * wrong. It reads the owner back in the same call so one check covers both the
 * bootstrap result and ordinary content.
 *
 * Plain ESM so it runs inside the production image, which has no TypeScript
 * loader.
 */

async function open() {
  const config = resolveConfig(process.env)

  if (config.driverFamily === "sqlite") {
    const { createClient } = await import("@libsql/client")
    const c = createClient({ url: config.url })
    return {
      run: (sql, args = []) => c.execute({ sql, args }),
      all: async (sql, args = []) => (await c.execute({ sql, args })).rows,
      q: (n) => n,
      close: async () => c.close(),
    }
  }

  if (config.driverFamily === "postgresql") {
    const { default: postgres } = await import("postgres")
    const sql = postgres(config.url, { max: 1, onnotice: () => {} })
    let i = 0
    return {
      run: (text, args = []) => sql.unsafe(text.replace(/\?/g, () => `$${++i}`), args),
      all: async (text, args = []) => {
        let j = 0
        return sql.unsafe(text.replace(/\?/g, () => `$${++j}`), args)
      },
      // PostgreSQL folds unquoted identifiers to lower case, so the camelCase
      // column names this schema uses have to be quoted.
      q: (n) => `"${n}"`,
      close: async () => sql.end({ timeout: 5 }),
    }
  }

  const { default: mysql } = await import("mysql2/promise")
  const conn = await mysql.createConnection({ uri: config.url })
  return {
    run: (sql, args = []) => conn.execute(sql, args),
    all: async (sql, args = []) => (await conn.query(sql, args))[0],
    q: (n) => n,
    close: async () => conn.end(),
  }
}

export async function write(slug) {
  const s = await open()
  try {
    const now = Date.now()
    await s.run(
      `insert into ${s.q("blog_tag")} (id, name, slug, ${s.q("isIndexable")}, ${s.q("isActive")}, ${s.q("createdAt")}, ${s.q("updatedAt")})
       values (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), "Matrix Marker", slug, true, true, now, now],
    )
    console.log("marker written")
  } finally {
    await s.close()
  }
}

export async function verify(slug, ownerEmail) {
  const s = await open()
  try {
    const markers = await s.all(`select id from ${s.q("blog_tag")} where slug = ?`, [slug])
    const owners = await s.all(
      `select id from ${s.q("user")} where email = ? and role = 'owner'`,
      [ownerEmail],
    )
    console.log(`marker=${markers.length} owner=${owners.length}`)
  } finally {
    await s.close()
  }
}

// CLI entry: node scripts/matrix-marker.mjs write <slug>
//            node scripts/matrix-marker.mjs verify <slug> <ownerEmail>
//
// Invoked as a real argv command rather than `node -e`, because
// `docker compose run -e …` consumes -e as its own environment flag and the
// container quietly runs its normal entrypoint instead — reporting the
// migration output as though it were the marker result.
const [, , command, slug, email] = process.argv
if (command === "write") {
  await write(slug)
} else if (command === "verify") {
  await verify(slug, email)
} else if (command) {
  console.error(`unknown command: ${command}`)
  process.exitCode = 1
}
