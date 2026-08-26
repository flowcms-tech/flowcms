/**
 * The package-manager section of the generated Dockerfile.
 *
 * ONE DOCKERFILE, ONE RENDERED REGION. Four near-identical Dockerfiles would
 * drift the first time anything else in the build changed, and the difference
 * between them is genuinely four lines.
 *
 * The template carries markers:
 *
 *     # flowcms:render:package-manager
 *     …npm's lines…
 *     # flowcms:render:end
 *
 * and the installer replaces what is between them. Nothing operator-controlled
 * is interpolated: the manager is an enum member, so the rendered text comes
 * from the table below and from nowhere else.
 *
 * LAYER CACHING IS PRESERVED. Manifests are copied, dependencies installed, and
 * only then are sources copied — so an edit to a component does not reinstall
 * `node_modules`.
 *
 * COREPACK IS NOT ON BY DEFAULT in Node 22, which is why pnpm and yarn enable
 * it explicitly rather than assuming a shim exists.
 *
 * THE RUNTIME STAYS NODE in every case. Bun installs dependencies; it does not
 * run the server. That is a fixed architecture decision and this file does not
 * get to change it.
 */

export const MARKER_START = "# flowcms:render:package-manager"
export const MARKER_END = "# flowcms:render:end"

/**
 * Lockfile per manager.
 *
 * Bun writes the text `bun.lock` from 1.2 onwards; the binary `bun.lockb` was
 * the older default. The repository's own lockfile is `bun.lock`, so 1.2+ is
 * what FlowCMS is developed against and what the generated project expects.
 */
/** @type {Record<string, string>} */
export const LOCKFILES = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
}

/**
 * The frozen-install command each manager uses in an image build.
 *
 * "Frozen" is the point: a Docker build must install exactly what the lockfile
 * pins, not re-resolve. A build that quietly updates a dependency is a build
 * that is not reproducible, and the symptom appears weeks later.
 *
 * Yarn's flag depends on its major version — `--immutable` from v2, and
 * `--frozen-lockfile` in v1 — which is why the renderer takes the version it
 * probed rather than guessing.
 */
export function installCommandFor(manager, { yarnMajor = 1 } = {}) {
  switch (manager) {
    case "npm":
      return "npm ci --ignore-scripts"
    case "pnpm":
      return "pnpm install --frozen-lockfile --ignore-scripts"
    case "yarn":
      return yarnMajor >= 2
        ? "yarn install --immutable"
        : "yarn install --frozen-lockfile --ignore-scripts"
    case "bun":
      return "bun install --frozen-lockfile --ignore-scripts"
    default:
      throw new Error(`No image install command for package manager "${manager}".`)
  }
}

/** Whether the image needs `corepack enable` before the manager exists. */
export function needsCorepack(manager) {
  return manager === "pnpm" || manager === "yarn"
}

/**
 * The lines that replace the marked region.
 *
 * The lockfile is copied with a wildcard and then checked, rather than named
 * directly. A directly-named missing file fails with buildkit's "not found",
 * which tells an operator nothing; this fails with a sentence naming the
 * command they skipped. That case is real and common: `--skip-install` leaves
 * no lockfile, and Docker cannot build without one.
 */
export function renderPackageManagerBlock(manager, options = {}) {
  const lockfile = LOCKFILES[manager]
  const install = installCommandFor(manager, options)
  const lines = []

  lines.push(`# Dependencies, installed with ${manager}.`)
  lines.push("#")
  lines.push("# The manifests first, then the install, then (later) the sources — so a")
  lines.push("# change to a component does not reinstall node_modules.")
  lines.push(`COPY package.json ${lockfile}* ./`)
  lines.push("# The local packages' MANIFESTS, and only those: the lockfile carries a")
  lines.push("# `file:` entry for `flowcms`, and an install refuses to run without the")
  lines.push("# directory it points at.")
  lines.push("COPY packages/flowcms/package.json ./packages/flowcms/")
  lines.push(`RUN test -f ${lockfile} || ( \\`)
  lines.push(`      echo "" && \\`)
  lines.push(`      echo "No ${lockfile} in the build context." && \\`)
  lines.push(`      echo "Run '${manager} install' in the project first — the image build" && \\`)
  lines.push(`      echo "installs exactly what the lockfile pins and cannot create one." && \\`)
  lines.push(`      exit 1 )`)

  if (needsCorepack(manager)) {
    lines.push("# Corepack ships with Node 22 but is not enabled by default, so the")
    lines.push("# manager's shim does not exist until this runs.")
    lines.push(`RUN corepack enable && ${install}`)
  } else if (manager === "bun") {
    lines.push("# Bun is used to INSTALL only. The runtime below is Node, unchanged —")
    lines.push("# FlowCMS runs on Node and choosing bun as a package manager does not")
    lines.push("# alter that.")
    lines.push("COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun")
    lines.push(`RUN ${install}`)
  } else {
    lines.push(`RUN ${install}`)
  }

  return lines.join("\n")
}

/** Replace the marked region in a Dockerfile's text. */
export function renderDockerfile(source, manager, options = {}) {
  const start = source.indexOf(MARKER_START)
  const end = source.indexOf(MARKER_END)

  if (start < 0 || end < 0 || end < start) {
    throw new Error(
      "The template Dockerfile has no flowcms:render:package-manager region. " +
        "The template was built incorrectly.",
    )
  }

  return (
    source.slice(0, start) +
    renderPackageManagerBlock(manager, options) +
    source.slice(end + MARKER_END.length)
  )
}

/**
 * What the operator types, outside Docker.
 *
 * Separate from the image commands because they are a different question: this
 * is the install the CLI runs and the one the README tells them to repeat.
 */
export function localInstallCommand(manager) {
  return `${manager} install`
}
