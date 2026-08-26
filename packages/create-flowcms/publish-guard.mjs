/**
 * Release-safety validation for `npm publish` of `create-flowcms`.
 *
 * Runs from `prepublishOnly`, which npm invokes on `publish` and NOT on `pack`
 * — so every packaging proof in the repository still runs unchanged, and only
 * the irreversible step is validated.
 *
 * WHAT CHANGED, AND WHY IT IS STILL A GUARD.
 *
 * This script used to refuse unconditionally. The licence is now settled
 * (GPL-2.0-or-later), the repository is public and carries its metadata, and
 * the owner has authorised a first publication, so an unconditional refusal
 * would now be a lie. The honest replacement is a guard that checks what must
 * be true at the moment of publishing.
 *
 * It still refuses by default: `npm publish` by hand, from a laptop, with no
 * release in progress fails exactly as before. Publication requires
 * FLOWCMS_RELEASE=1, which only the `publish` job in
 * .github/workflows/release.yml sets, behind an explicit workflow_dispatch, a
 * typed confirmation phrase and the `npm-publish` environment.
 *
 * ORDERING. `flowcms` must reach the registry first. Not because a generated
 * project needs it — it vendors its own copy, by decision — but because this
 * scaffolder ships documentation pointing theme authors at a package that would
 * not exist yet. The release workflow publishes them in order and stops if the
 * first fails; this guard states the rule so a hand-run cannot invert it.
 */

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = "https://github.com/flowcms-tech/flowcms"

/**
 * Conditions that must hold before this package may reach the registry.
 */
const BLOCKERS = [
  "A release must be deliberate: FLOWCMS_RELEASE=1 is set only by the release workflow's publish job.",
  "`flowcms` must be published before `create-flowcms`, because this package's documentation points theme authors at it.",
  "The licence must still be GPL-2.0-or-later, matching the repository LICENSE file.",
  "The manifest must carry the repository metadata npm provenance resolves and npm renders as the source link.",
  "The generated application template must have been built — a scaffolder with no template produces an empty project.",
]

const problems = []

if (process.env.FLOWCMS_RELEASE !== "1") {
  problems.push(
    "This is not a release. `npm publish` is refused unless FLOWCMS_RELEASE=1, which\n" +
      "     only the publish job in .github/workflows/release.yml sets. If you meant to\n" +
      "     release, dispatch that workflow — do not set the variable by hand.",
  )
}

let manifest
try {
  manifest = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"))
} catch {
  problems.push("package.json could not be read, so nothing about it could be verified.")
}

if (manifest) {
  if (manifest.license !== "GPL-2.0-or-later") {
    problems.push(
      `package.json declares license "${manifest.license}", not the GPL-2.0-or-later\n` +
        "     this project is released under. A licence string is a legal claim: if this\n" +
        "     is a deliberate change, make the repository LICENSE file agree before\n" +
        "     publishing. If it is not, revert it.",
    )
  }
  if (manifest.private === true) {
    problems.push('`"private": true` is set, so npm would refuse this publish anyway.')
  }
  if (!manifest.version) {
    problems.push("package.json declares no version.")
  }
  const url = manifest.repository?.url ?? ""
  if (!url.includes("github.com/flowcms-tech/flowcms")) {
    problems.push(
      `repository.url is "${url}", which is not ${REPO}. Provenance resolves this field,\n` +
        "     and npm renders it as the package's only visible link back to its source.",
    )
  }
  for (const entry of manifest.files ?? []) {
    if (entry === "README.md") continue
    if (!existsSync(join(HERE, entry))) {
      problems.push(
        `the \`files\` allowlist promises "${entry}", which does not exist. Run\n` +
          "     `npm run build:template` before publishing.",
      )
    }
  }
}

if (problems.length > 0) {
  console.error("\nRefusing to publish `create-flowcms`.\n")
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    "\nThe conditions this guard enforces:\n" +
      BLOCKERS.map((b) => `  - ${b}`).join("\n") +
      "\n\nSee docs/distribution/create-flowcms.md.\n",
  )
  process.exit(1)
}

console.error("[publish-guard] create-flowcms: release conditions hold — proceeding.\n")
