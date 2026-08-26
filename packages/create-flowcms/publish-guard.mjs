/**
 * Refuses `npm publish` of create-flowcms while release prerequisites are unresolved.
 *
 * Runs from `prepublishOnly`, which npm invokes on `publish` and NOT on `pack`
 * — so every packaging proof in the repository still runs unchanged, and only
 * the irreversible step is blocked.
 *
 * This is the second of two guards. The first is `"private": true` in
 * package.json, which npm refuses to publish on its own. Two guards because
 * they fail differently: `private` is one word somebody removes while tidying,
 * and this script says WHY it is there.
 *
 * Deleting either one is a release decision, not a cleanup.
 *
 * IT REFUSES UNCONDITIONALLY — no override flag, no environment escape hatch.
 * See the note in packages/flowcms/publish-guard.mjs.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))

const BLOCKERS = [
  // Phase 9.1 settled the licence (GPL-2.0-or-later) and the repository and
  // maintainer metadata. Those two entries are gone because they are done, not
  // because the bar was lowered.
  // Phase 9.2: the repository is now PUBLIC and @flowcms-tech exists with 2FA
  // enforced. Those entries are gone because they are done. Provenance being
  // POSSIBLE is not provenance being CONFIGURED.
  "npm provenance is not configured and has never produced an attestation. " +
    "The repository is public and the organisation enforces 2FA, so it is now " +
    "possible — and it cannot be added to a version after publication.",
  "The public repository is still EMPTY: nothing has been pushed, so no " +
    "workflow has ever run and no release has ever been rehearsed.",
  "`flowcms` is not published yet, and `create-flowcms` must not go first. " +
    "Generated v0.1 projects vendoring a local copy is the DELIBERATE model " +
    "(Option A, docs/distribution/create-flowcms.md) — that part is no longer a " +
    "defect. What is still true is that theme authors are pointed at `flowcms` " +
    "on the registry, so a scaffolder published ahead of it documents an import " +
    "nobody can resolve.",
  "Release automation exists but has NEVER RUN: six workflows, a " +
    "published-artifact gate and a release proof, none of which has executed on " +
    "a real commit — there is no remote to run them on. A publish today is still " +
    "one person's laptop and whatever was in it.",
  "The npm name `create-flowcms` has never been checked against the registry. " +
    "`npm create flowcms` resolves to exactly that name and no other, so the " +
    "documented invocation depends on a name nobody has confirmed is free.",
]

console.error("\nRefusing to publish `create-flowcms`.\n")
for (const blocker of BLOCKERS) console.error(`  - ${blocker}`)

/**
 * Say so loudly if the OTHER guard is already gone. See the sibling guard.
 */
try {
  const manifest = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"))
  if (manifest.private !== true) {
    console.error(
      '\n  !! `"private": true` has been REMOVED from packages/create-flowcms/package.json.\n' +
        "     This script is now the only guard. Restore it, or finish the release\n" +
        "     decisions above and delete both together.",
    )
  }
  // Watches for drift away from the DECIDED licence (GPL-2.0-or-later,
  // Phase 9.1), not away from "UNLICENSED".
  if (manifest.license !== "GPL-2.0-or-later") {
    console.error(
      `\n  !! package.json now declares license "${manifest.license}".\n` +
        "     If that was a real decision, record it in dev-docs/decisions/ and\n" +
        "     make the LICENSE file agree before publishing. If it was not,\n" +
        "     revert it — it is a legal claim.",
    )
  }
} catch {
  // A guard that crashes while reading its own manifest must still refuse.
}

console.error(
  "\nSee docs/distribution/create-flowcms.md, “Release blockers” in " +
    "docs/distribution/packages.md. " +
    "When those are settled, remove `private` and this guard together, in the " +
    "commit that settles them.\n",
)
process.exit(1)
