import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import * as searchconsoleEntry from "googleapis/build/src/apis/searchconsole"
import * as indexingEntry from "googleapis/build/src/apis/indexing"
import * as pagespeedEntry from "googleapis/build/src/apis/pagespeedonline"

// THE BARREL IS LOADED UNTYPED, ON PURPOSE. tsconfig.json includes `**/*.ts`,
// so this file is part of the same type program `next build` checks: a static
// import of the package root here would put all 328 APIs' types back into every
// build this test exists to protect. `createRequire` returns `any`, so the
// runtime reference costs the type-checker nothing.
const { google } = createRequire(import.meta.url)("googleapis")

/**
 * THE GOOGLEAPIS BARREL STAYS OUT OF THE APPLICATION.
 *
 * Importing `{ google }` from the package root pulls the type declarations of
 * all 328 Google APIs into the program. FlowCMS uses three. (This comment avoids
 * spelling that import out: the scan below would find it in this very file.) Measured cold, the barrel was
 * 917 of 4,653 files and enough on its own to push `tsc` to 2.88 GB — past the
 * ~2 GB default heap of a memory-limited container, which is where production
 * builds died. The per-API entry points carry only what they name.
 *
 * googleapis 173 has no `exports` map, which is why the deep paths resolve. If a
 * future major version adds one, these imports fail at BUILD time (TS2307), not
 * at runtime — and this file fails with them.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(entry) ? [path] : []
  })
}

const BARREL = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']googleapis["']/

describe("the googleapis barrel is not in the type program", () => {
  // src/ AND tests/: both sit inside tsconfig's `**/*.ts`, so a barrel import in
  // either one is paid for by every type-check, `next build`'s included.
  it("no TypeScript file under src/ or tests/ imports the bare googleapis specifier", () => {
    const offenders = [...sourceFiles(join(ROOT, "src")), ...sourceFiles(join(ROOT, "tests"))]
      .filter((file) => BARREL.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file).split("\\").join("/"))
    expect(offenders).toEqual([])
  })
})

describe("the per-API entry points are the barrel's own code", () => {
  it("OAuth2 is the same class the barrel exposes", () => {
    expect(searchconsoleEntry.auth.OAuth2).toBe(google.auth.OAuth2)
  })

  it("every method FlowCMS calls exists on the entry-point clients", () => {
    const client = new searchconsoleEntry.auth.OAuth2("id", "secret", "http://localhost/callback")
    const gsc = searchconsoleEntry.searchconsole({ version: "v1", auth: client })
    const indexing = indexingEntry.indexing({ version: "v3", auth: client })
    const pagespeed = pagespeedEntry.pagespeedonline({ version: "v5" })

    const methods = {
      "OAuth2.generateAuthUrl": client.generateAuthUrl,
      "OAuth2.getToken": client.getToken,
      "OAuth2.setCredentials": client.setCredentials,
      "OAuth2.getAccessToken": client.getAccessToken,
      "OAuth2.getTokenInfo": client.getTokenInfo,
      "searchconsole.sites.list": gsc.sites.list,
      "searchconsole.urlInspection.index.inspect": gsc.urlInspection.index.inspect,
      "searchconsole.searchanalytics.query": gsc.searchanalytics.query,
      "searchconsole.sitemaps.submit": gsc.sitemaps.submit,
      "searchconsole.sitemaps.list": gsc.sitemaps.list,
      "searchconsole.sitemaps.delete": gsc.sitemaps.delete,
      "indexing.urlNotifications.publish": indexing.urlNotifications.publish,
      "pagespeedonline.pagespeedapi.runpagespeed": pagespeed.pagespeedapi.runpagespeed,
    }
    for (const [name, method] of Object.entries(methods)) {
      expect(typeof method, name).toBe("function")
    }
  })
})
