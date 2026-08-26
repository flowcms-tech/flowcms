/**
 * Refuses `npm publish` while release prerequisites are unresolved.
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
 * IT REFUSES UNCONDITIONALLY. There is deliberately no environment variable,
 * no `--force`, and no "blockers resolved" flag it consults: a guard with an
 * override is a guard that gets overridden by whatever is quickest at 2am. The
 * way past it is to delete it, in the commit that settles the blockers, where a
 * reviewer sees the deletion next to the reason.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))

// Phase 9.1 settled the licence and the metadata; those two entries are gone
// from this list because they are done, not because the bar was lowered. What
// remains is what is still actually true.
const BLOCKERS = [
  "The npm name `flowcms` has never been checked against the registry. It is a " +
    "short, unscoped, plausible name and may well be taken.",
  // Phase 9.2: the repository is now PUBLIC and the @flowcms-tech organisation
  // exists with 2FA enforced. Those entries are gone because they are done.
  // Provenance is still not configured, which is a different thing from the
  // repository being eligible for it.
  "Release automation exists but has NEVER RUN: six workflows and a " +
    "published-artifact gate, none of which has executed on a real commit. " +
    "The repository is public but still EMPTY — nothing has been pushed, so no " +
    "workflow has ever been triggered. A publish today is still one person's " +
    "laptop and whatever was in it.",
  "npm provenance is not configured and has never produced an attestation. " +
    "The @flowcms-tech organisation enforces 2FA and the repository is public, " +
    "so provenance is now POSSIBLE — it is not yet CONFIGURED, and it cannot be " +
    "added to a version after that version is published.",
  "The distribution documentation (docs/distribution/packages.md) describes an " +
    "unpublished package. Publishing makes those instructions live.",
]

console.error("\nRefusing to publish `flowcms`.\n")
for (const blocker of BLOCKERS) console.error(`  - ${blocker}`)

/**
 * Say so loudly if the OTHER guard is already gone.
 *
 * If `private` has been removed, this script is the only thing left between a
 * mistyped command and an irrevocable publish, and the person who removed it
 * should hear that rather than discover it.
 */
try {
  const manifest = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"))
  if (manifest.private !== true) {
    console.error(
      '\n  !! `"private": true` has been REMOVED from packages/flowcms/package.json.\n' +
        "     This script is now the only guard. Restore it, or finish the release\n" +
        "     decisions above and delete both together.",
    )
  }
  // The licence WAS decided (GPL-2.0-or-later, Phase 9.1), so the tripwire now
  // watches for drift away from that decision rather than away from
  // "UNLICENSED". A licence string is a legal claim either way.
  if (manifest.license !== "GPL-2.0-or-later") {
    console.error(
      `\n  !! package.json declares license "${manifest.license}", not the\n` +
        "     GPL-2.0-or-later this project is released under.\n" +
        "     If that is a new decision, record it in dev-docs/decisions/ and\n" +
        "     make the LICENSE\n" +
        "     file agree. If it is not, revert it — it is a legal claim.",
    )
  }
} catch {
  // A guard that crashes while reading its own manifest must still refuse.
}

console.error(
  "\nSee docs/distribution/packages.md, section “Release blockers”. When those " +
    "are settled, remove `private` and this guard together, in the commit that " +
    "settles them.\n",
)
process.exit(1)
