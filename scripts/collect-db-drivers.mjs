import { cpSync, mkdirSync, existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

/**
 * Stage the packages the standalone runtime scripts need but the Next tracer
 * cannot see.
 *
 * Next's file tracer cannot see these. `createDatabase.ts` reaches them through
 * `require()` inside a dialect switch so a SQLite deployment never loads a
 * PostgreSQL driver, and `scripts/migrate.mjs` is not part of the Next build at
 * all. The result was an image that ran fine on SQLite and failed on PostgreSQL
 * with "Cannot find package 'postgres'" — a failure that only appears for the
 * operators least able to debug it.
 *
 * The closure is computed rather than written down. A hardcoded list would be
 * correct today and quietly wrong the first time a driver adds a dependency,
 * and the symptom would again be a runtime failure on one dialect only.
 *
 * IT IS COMPUTED FROM `node_modules`, NOT FROM A LOCKFILE. This script runs
 * inside a generated project's image build, and a generated project's lockfile
 * is whichever one its package manager wrote — `package-lock.json`,
 * `pnpm-lock.yaml`, `yarn.lock` or `bun.lock`. Reading `package-lock.json` by
 * name made the Docker build fail with ENOENT for every operator who chose
 * anything but npm, at a step three minutes into the build. `node_modules` is
 * the one artefact all four produce, and resolving through it the way Node
 * itself does is also the only way to find a dependency that a manager did not
 * hoist to the top level (pnpm's default layout does not).
 *
 *   node scripts/collect-db-drivers.mjs <destination>
 */

// bcryptjs is here for the same reason as the drivers: scripts/ is outside the
// Next build, so nothing traces its imports.
const ROOTS = ["postgres", "mysql2", "bcryptjs"]

const destination = process.argv[2]
if (!destination) {
  console.error("usage: node scripts/collect-db-drivers.mjs <destination>")
  process.exit(1)
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..")

/**
 * Where Node itself would find `name` when required from `fromDir`.
 *
 * The plain node_modules walk, deliberately, rather than `require.resolve`: a
 * package whose `exports` map does not list `./package.json` — and many do not
 * — cannot be resolved that way at all, and the directory is what has to be
 * copied here regardless.
 *
 * `realpathSync` matters for pnpm, whose top-level entries are symlinks into
 * `.pnpm/…`; the real directory is both what must be copied and the place from
 * which that package's own dependencies resolve.
 */
function locate(name, fromDir) {
  let dir = fromDir
  for (;;) {
    const candidate = join(dir, "node_modules", name)
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** @type {Map<string, string>} package name → the directory to copy */
const closure = new Map()

function visit(name, fromDir) {
  if (closure.has(name)) return
  const located = locate(name, fromDir)
  if (!located) {
    console.error(`missing dependency in node_modules: ${name}`)
    process.exit(1)
  }
  closure.set(name, located)

  const manifest = JSON.parse(readFileSync(join(located, "package.json"), "utf8"))
  // Runtime dependencies only. devDependencies are not installed for a
  // dependency, and optionalDependencies are allowed to be absent — a missing
  // one must not fail the image build.
  for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, located)
}

for (const root of ROOTS) visit(root, PROJECT_ROOT)

mkdirSync(destination, { recursive: true })

for (const name of [...closure.keys()].sort()) {
  const target = join(destination, ...name.split("/"))
  mkdirSync(dirname(target), { recursive: true })
  // Dereferenced: the runner image gets plain directories, not links back into
  // a builder-stage store that will not exist there.
  cpSync(closure.get(name), target, { recursive: true, dereference: true })
}

console.log(`staged ${closure.size} driver packages: ${[...closure.keys()].sort().join(", ")}`)
