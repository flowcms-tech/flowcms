import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // TinyMCE's own vendor bundle, copied into public/ by scripts/copy-tinymce.mjs
    // (postinstall) — not project source, shouldn't be linted.
    "public/assets/tinymce/**",
    // Build output under packages/: the compiled `flowcms` package, and the
    // application template `create-flowcms` carries. The template is a COPY of
    // src/, so linting it reports every warning in this project a second time
    // and makes the baseline meaningless.
    "packages/*/dist/**",
    "packages/create-flowcms/template/**",
  ]),
]);

export default eslintConfig;
