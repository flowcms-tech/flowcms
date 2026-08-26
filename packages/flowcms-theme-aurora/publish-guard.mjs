/**
 * Refuses `npm publish` of the Aurora example theme — permanently.
 *
 * THIS GUARD IS NOT THE SAME KIND AS THE OTHER TWO. `flowcms` and
 * `create-flowcms` are blocked *until* release prerequisites are settled;
 * Aurora is blocked *always*. It is a fixture: the proof that a third-party
 * theme can be written against the published contract, built with its own
 * tsconfig and installed from a tarball. Publishing a fixture would put a
 * package nobody maintains into other people's dependency trees, under an
 * `@example` scope that means what it says.
 *
 * A theme author copies Aurora's SHAPE from docs/themes/authoring.md; they do
 * not install it.
 *
 * Runs from `prepublishOnly`, which npm invokes on `publish` and NOT on `pack`
 * — the tarball proofs in `scripts/verify-package-consumer.mjs` pack this
 * package on every run and must keep working.
 *
 * The first guard is `"private": true` in package.json. Two guards, because
 * `private` is one word somebody removes while tidying and this file says why
 * it was there.
 */

console.error("\nRefusing to publish `@example/flowcms-theme-aurora`.\n")
console.error(
  "  - It is an INTEGRATION FIXTURE, not a product. It exists to prove the\n" +
    "    public theme contract is sufficient on its own, and it is registered in\n" +
    "    the application only when FLOWCMS_INTEGRATION_THEMES=1.\n" +
    "  - The `@example` scope is not a namespace this project owns or should own.\n" +
    "  - Its licence header says MIT so that theme authors may copy from it\n" +
    "    freely; that is a statement about a fixture and is NOT the FlowCMS\n" +
    "    project licence, which is GPL-2.0-or-later.\n" +
    "\n" +
    "If FlowCMS ever wants a first-party theme on npm, it is a new package with\n" +
    "a real name, a maintainer and a support commitment — not this one renamed.\n",
)
process.exit(1)
