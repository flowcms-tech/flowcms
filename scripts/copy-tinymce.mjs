// Self-hosts TinyMCE static assets into public/assets/tinymce so ElementEditor
// never talks to the TinyMCE cloud CDN (no API key, no "unregistered domain" banner).
// Re-run automatically on `bun install` via the postinstall script.
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(rootDir, '..')
const src = path.join(projectRoot, 'node_modules', 'tinymce')
const dest = path.join(projectRoot, 'public', 'assets', 'tinymce')

if (!existsSync(src)) {
  console.warn('[copy-tinymce] tinymce package not found in node_modules, skipping.')
  process.exit(0)
}

const entries = ['icons', 'models', 'plugins', 'skins', 'themes', 'tinymce.min.js']

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

for (const entry of entries) {
  cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true })
}

console.log(`[copy-tinymce] copied TinyMCE assets to ${path.relative(projectRoot, dest)}`)
