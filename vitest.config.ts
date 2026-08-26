import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/**
 * Test runner config.
 *
 * Deliberately minimal and Node-first: FlowCMS's supported runtime for
 * contributors is Node.js (Bun stays an option), so nothing here may depend on
 * a Bun-native API. `vitest run` works identically under `node`, `npx` and
 * `bun run`.
 *
 * `environment: "node"` because every suite in `tests/` exercises server-side
 * logic — pure policy functions, route-handler guards, escaping, SSRF checks.
 * There is no DOM test layer yet; adding one later means adding a per-file
 * `@vitest-environment jsdom` docblock, not changing this default.
 *
 * The `@/*` alias is redeclared here rather than pulled from tsconfig via a
 * plugin: it keeps the dependency count at one (`vitest`) and it is a single
 * line that cannot drift far from `tsconfig.json`'s `paths`.
 */
export default defineConfig({
  test: {
    environment: "node",
    // .tsx is included so theme surfaces can be rendered to static markup.
    // Phase 1 left this at .ts because there was no presentation layer worth
    // testing; Phase 6.1 gives themes one, and rendering them needs JSX.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Route-policy coverage walks the whole src/app/api tree from disk; give
    // it room without letting a genuinely hung test sit forever.
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time marker: importing it from a client bundle
      // is meant to fail the build. Vitest has no client bundle, so its default
      // export throws on import and makes every server module that guards
      // itself — Framework/Config/adminPath.ts, for one — untestable. Next
      // resolves the same package to this exact file under the `react-server`
      // condition, so this is the resolution Next itself uses on the server
      // rather than a stub invented here.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
      // NO ALIAS FOR `flowcms/theme` OR FOR THE AURORA PACKAGE — Phase 7.2
      // deleted both, and their absence is the point.
      //
      // Until then, a test that imported `flowcms/theme` was reading
      // `src/Themes/contract/index.ts` through a line written right here. It
      // proved the contract compiled; it could not possibly have caught the
      // package NOT being a package, because no npm resolution ever happened.
      // Both specifiers now resolve out of node_modules like any dependency, so
      // a test that resolves one is evidence a stranger's project would too.
    },
  },
})
