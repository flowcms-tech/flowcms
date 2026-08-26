import { cpSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, dirname, relative, sep } from "node:path"
import { assertInside } from "./destination.mjs"

/**
 * Copying the application template into a new project.
 *
 * TWO OPERATIONS, KEPT APART:
 *
 *   COPY    byte-for-byte, for everything. The template contains PNGs, a
 *           woff2 font and an ICO; reading those as UTF-8 to run a replacement
 *           through them corrupts them in ways that survive every test that
 *           does not open the file.
 *   RENDER  a closed set of three files, each written deliberately.
 *
 * There is no templating engine and no string substitution across the tree. The
 * rendered files are `package.json` (parsed as JSON, three fields changed),
 * `README.md` (written whole) and `.flowcms/project.json` (written whole).
 */

/**
 * The template's ignore file, and why it is not called `.gitignore`.
 *
 * npm rewrites a `.gitignore` inside a published package — it is one of the
 * filenames the registry treats specially — so a template that shipped one
 * would arrive with it missing or renamed, and every generated project would
 * commit `node_modules` on its first push. Storing it neutrally and renaming on
 * copy is what every scaffolder does, for exactly this reason. The pack audit
 * asserts the neutral name survives.
 */
export const IGNORE_SOURCE = "gitignore"
export const IGNORE_TARGET = ".gitignore"

export function copyTemplate(templateDir, destination) {
  if (!existsSync(templateDir)) {
    throw new Error(`The packaged template is missing from this install (${templateDir}).`)
  }

  for (const entry of readdirSync(templateDir)) {
    const target = assertInside(destination, entry)
    cpSync(join(templateDir, entry), target, {
      recursive: true,
      // A symlink in a generated project could point back into wherever the
      // CLI was installed from. The template build refuses to create one; this
      // refuses to follow one if it ever did.
      dereference: true,
      // Preserves the executable bit that docker/entrypoint.sh depends on.
      preserveTimestamps: false,
    })
  }

  const ignoreSource = join(destination, IGNORE_SOURCE)
  if (existsSync(ignoreSource)) {
    renameSync(ignoreSource, join(destination, IGNORE_TARGET))
  }
}

/**
 * The generated project's own package manifest.
 *
 * PARSED AND RE-SERIALISED, never text-replaced. A regex over a manifest is how
 * a project called `next` ends up with its dependency renamed.
 *
 * Only three fields change. Everything else — dependencies, the scripts that
 * make the application work — is the template's, because the template is the
 * application and the scaffolder is not entitled to an opinion about it.
 */
export function renderPackageJson(templateManifestPath, projectName) {
  const manifest = JSON.parse(readFileSync(templateManifestPath, "utf8"))

  manifest.name = projectName
  // The project's own version, unrelated to the FlowCMS release it was
  // generated from. That relationship lives in .flowcms/project.json.
  manifest.version = "0.1.0"
  // It is an application, not a library, and it carries an operator's site.
  manifest.private = true

  return manifest
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Superseded by `render/marker.mjs` in Phase 7.4.
 *
 * The marker now records the deployment choices as well as the versions, and it
 * is built by a module that also refuses to emit one containing a secret —
 * which matters because this file IS committed, unlike `.env`. Kept here as a
 * re-export so nothing that imported it from this module breaks.
 */
export { buildProjectMarker as projectMarker } from "./render/marker.mjs"

/**
 * Remove a directory ONLY if this process created it.
 *
 * The distinction is the whole point. Scaffolding into an empty directory the
 * operator made themselves is supported, and deleting that directory because a
 * copy failed halfway would destroy something we were handed rather than
 * something we made. When we did not create it, its contents are removed and
 * the directory is left — which restores the state we found without touching
 * the thing itself.
 */
export function cleanUpOwnedPath({ path, existed }) {
  if (!existsSync(path)) return

  if (!existed) {
    rmSync(path, { recursive: true, force: true })
    return
  }

  for (const entry of readdirSync(path)) {
    rmSync(join(path, entry), { recursive: true, force: true })
  }
}

/** Every file under `dir`, as paths relative to it, in a stable order. */
export function walkFiles(dir, base = dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const full = join(dir, entry)
      return statSync(full).isDirectory()
        ? walkFiles(full, base)
        : [relative(base, full).split(sep).join("/")]
    })
}
