#!/usr/bin/env node
/**
 * THE CLEAN-CONSUMER PROOF.
 *
 * Builds and packs `flowcms` and the Aurora example theme, installs both
 * TARBALLS into a throwaway directory outside this repository, and then does
 * from there everything a real theme author would do: typecheck against the
 * published declarations, execute the runtime exports, render a theme surface
 * to static markup, and confirm the internals are unreachable.
 *
 * WHY A TEMP DIRECTORY AND TARBALLS, RATHER THAN THE WORKSPACE LINKS
 *
 * The repository resolves `flowcms` and `@example/flowcms-theme-aurora` through
 * `file:` links in node_modules. That is the right setup for developing them and
 * it is worthless as evidence: a link exposes the whole source directory, so
 * every `files` mistake, every missing export and every unpublished file works
 * anyway. Only an installed tarball has the shape a stranger gets.
 *
 * EVERYTHING IS INSTALLED FROM A LOCAL TARBALL, INCLUDING REACT
 *
 * React, react-dom, TypeScript and the type packages are packed out of this
 * repository's node_modules rather than fetched. That keeps the proof runnable
 * offline and deterministic, and it removes the one way this script could pass
 * for a reason unrelated to FlowCMS — a registry serving something different
 * from what was tested here.
 *
 * Run: node scripts/verify-package-consumer.mjs
 */

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const KEEP = process.argv.includes("--keep")

const failures = []
const notes = []

function step(title) {
  console.log(`\n=== ${title} ===`)
}

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...options })
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
function npmRun(args, cwd) {
  return run(npm, args, { cwd, shell: process.platform === "win32" })
}

function node(args, cwd) {
  return run(process.execPath, args, { cwd })
}

// ---------------------------------------------------------------------------
// 1. Build the packages exactly as a release would
// ---------------------------------------------------------------------------

step("Build")
node([join(ROOT, "scripts", "build-package.mjs")], ROOT)
node([join(ROOT, "scripts", "build-example-theme.mjs")], ROOT)

// ---------------------------------------------------------------------------
// 2. Pack
// ---------------------------------------------------------------------------

const WORK = mkdtempSync(join(tmpdir(), "flowcms-consumer-"))
const TARBALLS = join(WORK, "tarballs")
const CONSUMER = join(WORK, "consumer")
mkdirSync(TARBALLS, { recursive: true })
mkdirSync(join(CONSUMER, "src"), { recursive: true })

console.log(`workspace: ${WORK}`)

step("npm pack")

function pack(dir) {
  const out = npmRun(["pack", dir, "--pack-destination", TARBALLS, "--silent"], WORK)
  const name = out.trim().split("\n").pop().trim()
  return join(TARBALLS, name)
}

const flowcmsTarball = pack(join(ROOT, "packages", "flowcms"))
const auroraTarball = pack(join(ROOT, "packages", "flowcms-theme-aurora"))
console.log(`  flowcms -> ${flowcmsTarball.replace(TARBALLS, "…")}`)
console.log(`  aurora  -> ${auroraTarball.replace(TARBALLS, "…")}`)

// The consumer's other dependencies, packed out of this repository so the
// install needs no registry.
const VENDORED = [
  "react",
  "react-dom",
  "scheduler",
  "typescript",
  "csstype",
  "clsx",
  "tailwind-merge",
  join("@types", "react"),
  join("@types", "react-dom"),
]
const vendoredTarballs = VENDORED.map((name) => pack(join(ROOT, "node_modules", name)))

// ---------------------------------------------------------------------------
// 3. Audit the tarballs
// ---------------------------------------------------------------------------

step("Tarball contents")

function listTarball(tarball) {
  const out = npmRun(["pack", "--dry-run", "--json", tarball === flowcmsTarball
    ? join(ROOT, "packages", "flowcms")
    : join(ROOT, "packages", "flowcms-theme-aurora")], WORK)
  const parsed = JSON.parse(out)
  return parsed[0].files.map((f) => f.path)
}

const flowcmsFiles = listTarball(flowcmsTarball)
const auroraFiles = listTarball(auroraTarball)

console.log(`  flowcms tarball: ${flowcmsFiles.length} files`)
for (const f of flowcmsFiles) console.log(`    ${f}`)
console.log(`  aurora tarball: ${auroraFiles.length} files`)
for (const f of auroraFiles) console.log(`    ${f}`)

/**
 * Nothing outside `dist/`, the manifest and the README may ship.
 *
 * The specific things being kept out are the reason the allowlist exists rather
 * than an ignore file: this repository contains a developer's `.env`, a SQLite
 * database, Docker state and internal design notes, and an ignore list is a
 * denial of the things somebody remembered.
 */
const ALLOWED_TOP = {
  flowcms: /^(dist\/|package\.json$|README\.md$)/,
  aurora: /^(dist\/|package\.json$|README\.md$|screenshot\.png$)/,
}
for (const [name, files, pattern] of [
  ["flowcms", flowcmsFiles, ALLOWED_TOP.flowcms],
  ["aurora", auroraFiles, ALLOWED_TOP.aurora],
]) {
  const strays = files.filter((f) => !pattern.test(f))
  check(`${name}: tarball contains only allowlisted paths`, strays.length === 0, strays.join(", "))
}

const SECRET_SHAPES = [
  /(^|\/)\.env/,
  /data-info/,
  /\.db$/,
  /\.sqlite/,
  /(^|\/)\.git/,
  /credential/i,
  /\.pem$/,
  /\.key$/,
  /(^|\/)tests?\//,
  /(^|\/)docs?\//,
  /(^|\/)node_modules\//,
  /tsconfig/,
  /publish-guard/,
]
for (const [name, files] of [["flowcms", flowcmsFiles], ["aurora", auroraFiles]]) {
  const bad = files.filter((f) => SECRET_SHAPES.some((re) => re.test(f)))
  check(`${name}: no secret, database, test, doc or config file in the tarball`, bad.length === 0, bad.join(", "))
}

check("aurora: ships its screenshot asset", auroraFiles.includes("screenshot.png"))
check("flowcms: ships no source maps", !flowcmsFiles.some((f) => f.endsWith(".map")))
check("aurora: ships no source maps", !auroraFiles.some((f) => f.endsWith(".map")))

/** A `workspace:` range is a protocol npm cannot install from a registry. */
for (const [name, dir] of [["flowcms", "flowcms"], ["aurora", "flowcms-theme-aurora"]]) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"))
  const ranges = [
    ...Object.values(manifest.dependencies ?? {}),
    ...Object.values(manifest.peerDependencies ?? {}),
  ]
  check(
    `${name}: every dependency range is external semver, not workspace:/file:`,
    ranges.every((r) => !/^(workspace|file|link):/.test(r)),
    ranges.join(", "),
  )
}

// ---------------------------------------------------------------------------
// 4. The clean consumer project
// ---------------------------------------------------------------------------

step("Clean consumer")

writeFileSync(
  join(CONSUMER, "package.json"),
  JSON.stringify(
    {
      name: "flowcms-theme-consumer-probe",
      version: "1.0.0",
      private: true,
      type: "module",
    },
    null,
    2,
  ) + "\n",
)

/**
 * Strict, and with `skipLibCheck` OFF.
 *
 * Skipping declaration checks is exactly how a package with broken `.d.ts`
 * files passes a consumer's build and fails on the first hover. The point of
 * this project is to check the declarations, so the one setting that would
 * stop it doing that is the one setting that must be false.
 *
 * There are no `paths`. A consumer has no FlowCMS tsconfig; if anything here
 * resolves, it resolved through node_modules.
 */
writeFileSync(
  join(CONSUMER, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "esnext"],
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noImplicitAny: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: false,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    },
    null,
    2,
  ) + "\n",
)

writeFileSync(
  join(CONSUMER, "src", "theme.tsx"),
  `import {
  defineThemeSettings,
  themeSettingsOf,
  THEME_SURFACES,
  JsonLd,
  cn,
  readingTimeMinutes,
  howToStepAnchor,
  publicImageUrl,
  publicImagePath,
  FLOWCMS_VERSION,
  type FlowCMSTheme,
  type ThemeManifest,
  type LayoutProps,
  type HomeView,
  type BlogPostView,
  type ThemeSurfaceProps,
  type NavItem,
  type PublicCustomPage,
  type ThemeSettingsOf,
} from "flowcms/theme"

export const manifest: ThemeManifest = {
  slug: "probe",
  name: "Probe",
  version: "1.0.0",
  flowcmsCompat: "^0.1.0",
  menuSlots: ["primary"],
}

export const settings = defineThemeSettings({
  version: 1,
  fields: [
    { key: "showTagline", type: "boolean", label: "Show tagline", default: true },
    { key: "columns", type: "number", label: "Columns", default: 3 },
    { key: "density", type: "select", label: "Density", default: "cosy",
      options: [{ value: "cosy", label: "Cosy" }, { value: "tight", label: "Tight" }] },
  ],
})

export type ProbeSettings = ThemeSettingsOf<typeof settings>

function Layout({ brand, nav, settings: values, children }: LayoutProps) {
  const s = themeSettingsOf(settings, values)
  const items: NavItem[] = nav.slots.primary ?? []
  return (
    <div className={cn("probe-shell", s.density === "tight" && "probe-tight")}>
      <header>
        <span>{brand.siteName}</span>
        {s.showTagline && brand.tagline ? <em>{brand.tagline}</em> : null}
        <nav>{items.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</nav>
      </header>
      <main data-columns={s.columns}>{children}</main>
    </div>
  )
}

function Home({ brand, jsonLd }: ThemeSurfaceProps<HomeView>) {
  return (
    <section className={cn("probe-home", "px-4")}>
      <JsonLd data={jsonLd} />
      <h1>{brand.siteName}</h1>
    </section>
  )
}

function BlogPost({ post, askQuestion, howTo }: ThemeSurfaceProps<BlogPostView>) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{readingTimeMinutes(post.wordCount ?? 0)} min</p>
      <img src={publicImagePath(post.featuredImageUrl)} alt={post.featuredImageAltText} />
      {howTo ? <ol>{howTo.steps.map((s, i) => <li key={i} id={howToStepAnchor(i)}>{s.name}</li>)}</ol> : null}
      {askQuestion}
    </article>
  )
}

export const probeTheme: FlowCMSTheme = { manifest, settings, Layout, Home, BlogPost }

/** Types that are only useful if they are real. */
export function describePage(page: PublicCustomPage): string {
  return \`\${page.title} @ \${page.path} (updated \${page.updatedAt.toISOString()})\`
}

export const surfaces: readonly string[] = THEME_SURFACES
export const version: string = FLOWCMS_VERSION
export const absolute: string = publicImageUrl("a/b.png")
`,
)

writeFileSync(
  join(CONSUMER, "src", "inference.ts"),
  `import { defineThemeSettings, themeSettingsOf, type ThemeSettingsOf } from "flowcms/theme"

/**
 * Per-key inference, asserted at the type level.
 *
 * If \`ThemeSettingsOf\` degraded to an index signature — which is what a broken
 * declaration bundle produces — every one of these would widen to
 * \`string | number | boolean\` and the assertions below would fail to compile.
 */
const definition = defineThemeSettings({
  version: 2,
  fields: [
    { key: "showTagline", type: "boolean", label: "Show tagline", default: false },
    { key: "columns", type: "number", label: "Columns", default: 2 },
    { key: "heading", type: "text", label: "Heading", default: "Hello" },
    { key: "density", type: "select", label: "Density", default: "cosy",
      options: [{ value: "cosy", label: "Cosy" }, { value: "tight", label: "Tight" }] },
  ],
})

type S = ThemeSettingsOf<typeof definition>

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

export const booleanStaysBoolean: Exact<S["showTagline"], boolean> = true
export const numberStaysNumber: Exact<S["columns"], number> = true
export const textStaysString: Exact<S["heading"], string> = true
export const selectNarrowsToUnion: Exact<S["density"], "cosy" | "tight"> = true

/** And no \`any\` anywhere in it. */
type IsAny<T> = 0 extends 1 & T ? true : false
export const noAnyBoolean: IsAny<S["showTagline"]> = false
export const noAnyDensity: IsAny<S["density"]> = false

export const resolved = themeSettingsOf(definition, {
  showTagline: true, columns: 2, heading: "Hi", density: "tight",
})
export const tagline: boolean = resolved.showTagline
export const density: "cosy" | "tight" = resolved.density
`,
)

writeFileSync(
  join(CONSUMER, "src", "aurora.ts"),
  `import auroraTheme, { manifest, auroraSettings } from "@example/flowcms-theme-aurora"
import type { FlowCMSTheme, ThemeManifest } from "flowcms/theme"

/**
 * A PACKED theme compiling against a PACKED core.
 *
 * The assignment is the assertion: Aurora's declarations were emitted against
 * its own copy of \`flowcms/theme\`, and this file's \`FlowCMSTheme\` comes from
 * the copy installed here. If those two were not the same type — the classic
 * "two copies of the types" failure — this line would not compile.
 */
export const asTheme: FlowCMSTheme = auroraTheme
export const asManifest: ThemeManifest = manifest
export const settingsVersion: number = auroraSettings.version
`,
)

/** A file that MUST NOT compile. Kept out of `include` and checked separately. */
mkdirSync(join(CONSUMER, "negative"), { recursive: true })
writeFileSync(
  join(CONSUMER, "negative", "bad.tsx"),
  `import { defineThemeSettings, themeSettingsOf, type FlowCMSTheme } from "flowcms/theme"

const definition = defineThemeSettings({
  version: 1,
  fields: [{ key: "showTagline", type: "boolean", label: "Show tagline", default: true }],
})

const values = themeSettingsOf(definition, { showTagline: true })

// 1. A boolean setting is not a string.
export const wrong: string = values.showTagline

// 2. A key the theme never declared.
export const missing = values.doesNotExist

// 3. A theme missing its required Layout.
export const brokenTheme: FlowCMSTheme = {
  manifest: { slug: "x", name: "X", version: "1.0.0", flowcmsCompat: "*", menuSlots: [] },
}

// 4. A surface whose props do not match its view model.
export const wrongSurface: FlowCMSTheme = {
  manifest: { slug: "x", name: "X", version: "1.0.0", flowcmsCompat: "*", menuSlots: [] },
  Layout: () => null,
  Home: ({ nope }: { nope: number }) => null,
}
`,
)
writeFileSync(
  join(CONSUMER, "tsconfig.negative.json"),
  JSON.stringify(
    { extends: "./tsconfig.json", include: ["negative/**/*.ts", "negative/**/*.tsx"] },
    null,
    2,
  ) + "\n",
)

step("npm install (tarballs only, no registry)")
const installArgs = [
  "install",
  "--no-audit",
  "--no-fund",
  "--no-package-lock",
  "--ignore-scripts",
  flowcmsTarball,
  auroraTarball,
  ...vendoredTarballs,
]
npmRun(installArgs, CONSUMER)
console.log("  installed")

// ---------------------------------------------------------------------------
// 5. Resolution comes from node_modules, not from the repository
// ---------------------------------------------------------------------------

step("Resolution")

const resolveProbe = node(
  [
    "--input-type=module",
    "-e",
    `import { createRequire } from "node:module"
     const require = createRequire(${JSON.stringify(join(CONSUMER, "probe.js"))})
     const out = {
       flowcmsTheme: require.resolve("flowcms/theme"),
       aurora: require.resolve("@example/flowcms-theme-aurora"),
       react: require.resolve("react"),
     }
     console.log(JSON.stringify(out))`,
  ],
  CONSUMER,
)
const resolved = JSON.parse(resolveProbe.trim().split("\n").pop())
for (const [name, path] of Object.entries(resolved)) {
  const normalized = path.split("\\").join("/")
  check(
    `${name} resolves inside the consumer's node_modules`,
    normalized.includes("/node_modules/") && !normalized.startsWith(ROOT.split("\\").join("/")),
    normalized,
  )
}

// A symlink would mean the "clean" consumer was reading the repository.
const linkProbe = node(
  [
    "--input-type=module",
    "-e",
    `import { lstatSync, realpathSync } from "node:fs"
     import { join } from "node:path"
     const base = ${JSON.stringify(join(CONSUMER, "node_modules"))}
     const out = {}
     for (const p of ["flowcms", join("@example", "flowcms-theme-aurora")]) {
       const full = join(base, p)
       out[p] = { symlink: lstatSync(full).isSymbolicLink(), real: realpathSync(full) }
     }
     console.log(JSON.stringify(out))`,
  ],
  CONSUMER,
)
const links = JSON.parse(linkProbe.trim().split("\n").pop())
for (const [name, info] of Object.entries(links)) {
  check(`${name} is a real directory, not a link back into the repo`, !info.symlink, info.real)
  check(
    `${name} unpacked outside the repository`,
    !info.real.split("\\").join("/").startsWith(ROOT.split("\\").join("/")),
    info.real,
  )
}

// ---------------------------------------------------------------------------
// 6. Typecheck
// ---------------------------------------------------------------------------

step("tsc --noEmit (strict, skipLibCheck off)")
const tscBin = join(CONSUMER, "node_modules", "typescript", "bin", "tsc")
try {
  node([tscBin, "-p", join(CONSUMER, "tsconfig.json")], CONSUMER)
  check("consumer typechecks against the published declarations", true)
} catch (error) {
  check("consumer typechecks against the published declarations", false, String(error.stdout ?? error.message))
}

step("tsc on code that must NOT compile")
let negativeOutput = ""
let negativeFailed = false
try {
  node([tscBin, "-p", join(CONSUMER, "tsconfig.negative.json")], CONSUMER)
} catch (error) {
  negativeFailed = true
  negativeOutput = String(error.stdout ?? "")
}
check("bad theme code is rejected", negativeFailed)

/**
 * Matched on what the compiler SAID, not on where it said it.
 *
 * The first draft asserted line numbers and failed on the last case for a
 * reason that had nothing to do with types: TypeScript reports a mismatched
 * surface at the offending property, two lines below the assignment. A guard
 * keyed on layout breaks whenever the fixture is reformatted, which teaches
 * whoever hits it to loosen the guard rather than read it.
 */
for (const [label, pattern] of [
  ["a boolean setting cannot be assigned to a string", /Type 'boolean' is not assignable to type 'string'/],
  ["an undeclared setting key is an error", /Property 'doesNotExist' does not exist/],
  ["a theme without Layout is an error", /Property 'Layout' is missing/],
  ["a surface with the wrong props is an error", /Property 'nope' is missing in type 'ThemeSurfaceProps<HomeView/],
]) {
  check(label, pattern.test(negativeOutput), negativeOutput.split("\n").slice(0, 4).join(" | "))
}

// ---------------------------------------------------------------------------
// 7. Runtime
// ---------------------------------------------------------------------------

step("Runtime smoke")
writeFileSync(
  join(CONSUMER, "smoke.mjs"),
  `import {
  THEME_SURFACES, defineThemeSettings, themeSettingsOf, cn,
  readingTimeMinutes, howToStepAnchor, publicImagePath, publicImageUrl,
  FLOWCMS_VERSION, JsonLd,
} from "flowcms/theme"
import aurora from "@example/flowcms-theme-aurora"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"

const definition = defineThemeSettings({
  version: 1,
  fields: [{ key: "showTagline", type: "boolean", label: "T", default: true }],
})

const layout = renderToStaticMarkup(
  createElement(aurora.Layout, {
    brand: { siteName: "Probe Site", tagline: "Tagline", logoUrl: null, logoAltText: null },
    nav: { slots: { primary: [{ label: "Blog", href: "/blog", opensInNewTab: false, children: [] }] } },
    settings: {},
    children: createElement("p", null, "body"),
  }),
)

const home = renderToStaticMarkup(
  createElement(aurora.Home, {
    brand: { siteName: "Probe Site", tagline: "Tagline", logoUrl: null, logoAltText: null },
    jsonLd: { "@context": "https://schema.org", name: "</script><script>alert(1)</script>" },
    settings: {},
  }),
)

console.log(JSON.stringify({
  surfaces: THEME_SURFACES,
  settingsIdentity: themeSettingsOf(definition, { showTagline: true }).showTagline,
  cn: cn("p-2", "p-4"),
  readingTime: readingTimeMinutes(1000),
  anchor: howToStepAnchor(0),
  imagePath: publicImagePath("dir/a b.png"),
  imageUrl: publicImageUrl("dir/a b.png"),
  version: FLOWCMS_VERSION,
  jsonLdIsComponent: typeof JsonLd === "function",
  auroraSlug: aurora.manifest.slug,
  auroraMenuSlots: aurora.manifest.menuSlots,
  layoutHasSiteName: layout.includes("Probe Site"),
  layoutHasNavLink: layout.includes('href="/blog"'),
  layoutHasClasses: /class="/.test(layout),
  homeEscapesJsonLd: !home.includes("</script><script>"),
  homeHasLdJson: home.includes('application/ld+json'),
}))
`,
)
const smoke = JSON.parse(node([join(CONSUMER, "smoke.mjs")], CONSUMER).trim().split("\n").pop())

check("THEME_SURFACES executes and lists eight surfaces", smoke.surfaces.length === 8)
check("themeSettingsOf returns the value", smoke.settingsIdentity === true)
check("cn merges conflicting Tailwind classes", smoke.cn === "p-4", smoke.cn)
check("readingTimeMinutes computes", smoke.readingTime === 5, String(smoke.readingTime))
check("howToStepAnchor computes", smoke.anchor === "howto-step-1", smoke.anchor)
check("publicImagePath encodes each segment", smoke.imagePath === "/api/public/images/dir/a%20b.png", smoke.imagePath)
check("publicImageUrl builds an absolute-shaped URL", typeof smoke.imageUrl === "string" && smoke.imageUrl.endsWith(smoke.imagePath))
check("FLOWCMS_VERSION is the released version", /^\d+\.\d+\.\d+$/.test(smoke.version), smoke.version)
check("JsonLd is a component", smoke.jsonLdIsComponent)
check("the packed theme reports its slug", smoke.auroraSlug === "aurora", smoke.auroraSlug)
check("the packed theme declares its menu slots", smoke.auroraMenuSlots.join(",") === "primary,sidebar")
check("the packed theme's Layout renders to markup", smoke.layoutHasSiteName && smoke.layoutHasNavLink)
check("the packed theme's markup carries utility classes", smoke.layoutHasClasses)
check("JsonLd escapes a break-out payload in the packed build", smoke.homeEscapesJsonLd)
check("JsonLd emits an ld+json script", smoke.homeHasLdJson)

// ---------------------------------------------------------------------------
// 8. What must NOT be reachable
// ---------------------------------------------------------------------------

step("Internals are unreachable")
writeFileSync(
  join(CONSUMER, "deep.mjs"),
  `const attempts = [
  "flowcms",
  "flowcms/dist/index.js",
  "flowcms/dist/views.js",
  "flowcms/views",
  "flowcms/settings",
  "flowcms/runtime",
  "flowcms/theme/views",
  "flowcms/src/Themes/contract",
  "@example/flowcms-theme-aurora/src/index.ts",
  "@example/flowcms-theme-aurora/dist/manifest.js",
]
const result = {}
for (const specifier of attempts) {
  try {
    await import(specifier)
    result[specifier] = "RESOLVED"
  } catch (error) {
    result[specifier] = error.code ?? "ERROR"
  }
}
console.log(JSON.stringify(result))
`,
)
const deep = JSON.parse(node([join(CONSUMER, "deep.mjs")], CONSUMER).trim().split("\n").pop())
for (const [specifier, outcome] of Object.entries(deep)) {
  check(`\`${specifier}\` is not importable`, outcome !== "RESOLVED", outcome)
}

/** The one subpath that must work. */
const positive = node(
  [
    "--input-type=module",
    "-e",
    `const m = await import("flowcms/theme"); console.log(Object.keys(m).sort().join(","))`,
  ],
  CONSUMER,
)
check(
  "`flowcms/theme` is importable and exports the approved surface",
  positive.trim() ===
    "FLOWCMS_VERSION,JsonLd,THEME_SURFACES,cn,defineThemeSettings,howToStepAnchor,publicImagePath,publicImageUrl,readingTimeMinutes,themeSettingsOf",
  positive.trim(),
)

// ---------------------------------------------------------------------------

step("Result")
if (!KEEP) rmSync(WORK, { recursive: true, force: true })
else notes.push(`workspace kept at ${WORK}`)
for (const note of notes) console.log(`  note: ${note}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log("\nclean-consumer proof: PASS")
