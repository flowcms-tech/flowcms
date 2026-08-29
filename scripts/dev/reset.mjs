#!/usr/bin/env node
/**
 * `npm run dev:reset` — return the local installation to its uninitialized,
 * first-run state, and change nothing else.
 *
 * WHAT MAKES AN INSTALLATION "FIRST RUN"
 *
 * One row, one column: `settings.setupCompletedAt`. `Framework/Setup/setupState.ts`
 * treats that marker as the only authority — deliberately not "are there any
 * users?", because deleting accounts must never reopen public setup on a live
 * site. So the smallest correct reset is to remove the database that holds the
 * marker and let the next start migrate a new one. Nothing else needs to move.
 *
 * HOW SMALL "SMALLEST" HAD TO BE, measured rather than assumed
 *
 * The obvious implementation — remove the app container, remove its volume —
 * was written first and rejected on evidence. Removing the container discards
 * the anonymous volume masking `/app/node_modules`, and Docker then re-seeds it
 * from the image on the next start: **1.3 GB across 647 packages**, which on
 * Windows is minutes of copying every single time. A reset command that costs
 * more than the thing it resets does not get used.
 *
 * So this deletes the DATABASE FILE, not the volume that holds it. The app
 * container is stopped (SQLite holds the file open, and a delete underneath a
 * live server leaves it serving a deleted inode) and then kept, along with its
 * node_modules and .next volumes. A throwaway container mounted on the data
 * volume ALONE does the deletion — no anonymous volumes, so it starts instantly.
 *
 * WHAT THIS DELETES
 *
 *   • `/data/app.db` and its `-wal`, `-shm` and `-journal` sidecars — the
 *     database, and with it every owner account, setting, page, post, category,
 *     tag and comment.
 *
 * WHAT THIS PRESERVES, and the list is the point
 *
 *   • `garage-data` and `garage-meta` — uploaded media survives a reset. They
 *     are named below as a REFUSAL, not merely left out: a reset that quietly
 *     widened to "every volume in the project" is exactly the regression this
 *     shape exists to make impossible.
 *   • the `flowcms-data` volume itself, and the app container's node_modules
 *     and .next volumes — so the next start is seconds, not minutes.
 *   • `.env.dev.local` and `.env` — the setup token a developer has in their
 *     clipboard is still the right one afterwards, and the Garage credentials
 *     still match the storage volume they were created against.
 */

import { ensureLocalEnvironment, LOCAL_ENV_FILENAME } from "./localEnv.mjs"
import { capture, readComposeProject, requireDocker, runCompose } from "./compose.mjs"

/**
 * Volume keys this command must never write to, whatever else changes.
 *
 * A denylist beside the derivation. `resolveDatabaseTarget` already returns one
 * mount, so this can only fire if the compose topology is rearranged such that
 * storage and the database share it — in which case stopping is correct and a
 * developer needs to read the diff.
 */
const NEVER_TOUCH = ["garage-data", "garage-meta"]

/**
 * Where the database lives, derived from the running configuration rather than
 * hardcoded.
 *
 * `/data` is where `DATABASE_URL=file:/data/app.db` points and where the
 * Dockerfile declares its `VOLUME`, so the MOUNT is the durable fact and the
 * volume's key is not. The URL is read from the same resolved config Compose
 * itself would use, so an overridden `DATABASE_URL` is followed rather than
 * ignored.
 */
function resolveDatabaseTarget(services) {
  const app = services?.app
  const environment = app?.environment ?? {}

  const dialect = (environment.DATABASE_DIALECT ?? "sqlite").trim()
  if (dialect !== "sqlite") {
    throw new Error(
      `This development stack is configured for ${dialect}, not SQLite.\n\n` +
        "dev:reset only knows how to reset the default SQLite topology — dropping\n" +
        "a PostgreSQL or MySQL schema is a different operation with different\n" +
        "consequences, and guessing at it is not something a reset command should do.\n" +
        "Reset that engine's own volume with `docker compose down` plus a targeted\n" +
        "`docker volume rm`, or point DATABASE_URL back at SQLite.",
    )
  }

  const url = (environment.DATABASE_URL ?? "").trim()
  const filePath = url.replace(/^file:/, "")
  if (!url.startsWith("file:") || !filePath.startsWith("/")) {
    throw new Error(
      `Refusing to act on DATABASE_URL "${url}" — dev:reset expects an absolute\n` +
        "file: URL inside a mounted volume.",
    )
  }

  const mounts = app?.volumes ?? []
  const mount = mounts.find(
    (candidate) =>
      candidate.type === "volume" &&
      candidate.target &&
      (filePath === candidate.target || filePath.startsWith(`${candidate.target}/`)),
  )

  if (!mount?.source) {
    throw new Error(
      `The database path ${filePath} is not inside any named volume in the\n` +
        "development compose configuration. Refusing to guess what to delete.",
    )
  }
  if (NEVER_TOUCH.includes(mount.source)) {
    throw new Error(
      `The database resolves to volume "${mount.source}", which this command\n` +
        "must never modify. Refusing to continue.",
    )
  }

  return { volumeKey: mount.source, mountTarget: mount.target, filePath, image: app?.image }
}

/**
 * Delete the database and its sidecars from inside a throwaway container.
 *
 * The data volume — named by the value Docker's own labels resolved, never by a
 * concatenated guess — is the ONLY mount. That is what makes this fast: no bind
 * mount and no anonymous volumes, so the container starts in about a second
 * instead of re-seeding 1.3 GB of node_modules to delete one file.
 *
 * `-wal`, `-shm` and `-journal` are not optional extras. SQLite in WAL mode
 * keeps committed transactions in `app.db-wal` until a checkpoint, so deleting
 * only `app.db` can leave a write-ahead log that resurrects rows into the fresh
 * database — a "reset" that comes back with yesterday's owner account still in
 * it.
 */
async function deleteDatabase({ image, volumeName, mountTarget, filePath }) {
  const script =
    "const fs=require('node:fs');" +
    "const path=require('node:path');" +
    `const target=${JSON.stringify(filePath)};` +
    "const dir=path.dirname(target);const base=path.basename(target);" +
    "let removed=[];" +
    "for(const entry of (fs.existsSync(dir)?fs.readdirSync(dir):[])){" +
    "  if(entry===base||entry.startsWith(base+'-')){" +
    "    fs.rmSync(path.join(dir,entry),{force:true});removed.push(entry);" +
    "  }" +
    "}" +
    "console.log(removed.join(',')||'(nothing to remove)')"

  return capture("docker", [
    "run",
    "--rm",
    "-v",
    `${volumeName}:${mountTarget}`,
    "--entrypoint",
    "node",
    image,
    "-e",
    script,
  ])
}

/** The real name of one Compose-managed volume, resolved by label. */
async function findVolume(project, volumeKey) {
  const stdout = await capture("docker", [
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    `label=com.docker.compose.volume=${volumeKey}`,
    "--format",
    "{{.Name}}",
  ])
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? null
}

/** Whether an image tag exists locally. */
async function imageExists(image) {
  try {
    await capture("docker", ["image", "inspect", image, "--format", "{{.Id}}"])
    return true
  } catch {
    return false
  }
}

async function main() {
  await requireDocker()

  // Resolve (and generate, on a first-ever run) the environment before any
  // compose call: `compose.yml` guards AUTH_SECRET with `:?`, so every compose
  // subcommand — including `config` — refuses to interpolate without it.
  const { values } = ensureLocalEnvironment()

  const project = await readComposeProject(values)
  const target = resolveDatabaseTarget(project.services)

  console.log("\nFlowCMS — resetting the local installation to first-run state\n")

  // Stopped, not removed. Removing it would discard the anonymous volume that
  // masks /app/node_modules and cost minutes of re-seeding on the next start.
  console.log("  1/2  stopping the app container (garage keeps running)")
  const stopped = await runCompose(["stop", "app"], values)
  if (stopped !== 0) {
    throw new Error("Could not stop the app container. Nothing has been deleted.")
  }

  const volumeName = await findVolume(project.name, target.volumeKey)

  if (volumeName === null) {
    console.log(`  2/2  no ${target.volumeKey} volume exists yet — already first-run`)
  } else if (!target.image || !(await imageExists(target.image))) {
    // Nothing has been built, so there is no node_modules volume to protect and
    // no image to run the deletion in. Removing the volume is then both correct
    // and free. The container must go first — Docker refuses to remove a volume
    // any container still references, running or not.
    console.log(`  2/2  no image yet; removing the ${target.volumeKey} volume instead`)
    await runCompose(["rm", "--force", "app"], values)
    await capture("docker", ["volume", "rm", volumeName])
  } else {
    console.log(`  2/2  deleting the database from ${volumeName}`)
    const removed = await deleteDatabase({
      image: target.image,
      volumeName,
      mountTarget: target.mountTarget,
      filePath: target.filePath,
    })
    console.log(`       removed: ${removed.trim()}`)
  }

  const preserved = []
  for (const key of NEVER_TOUCH) {
    const name = await findVolume(project.name, key)
    if (name) preserved.push(name)
  }

  console.log("")
  console.log(`  Deleted:   ${target.filePath} and its write-ahead log`)
  console.log(
    `  Preserved: ${preserved.length > 0 ? preserved.join(", ") : "(no storage volumes yet)"}`,
  )
  console.log("  Preserved: the app container's node_modules and .next volumes")
  console.log(`  Preserved: ${LOCAL_ENV_FILENAME} — the setup token is unchanged`)
  console.log("")
  console.log("  Next start migrates a fresh database and /setup is open again:")
  console.log("    npm run dev:docker")
  console.log("")
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
