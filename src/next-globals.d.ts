/// <reference types="next" />
/// <reference types="next/image-types/global" />

/**
 * THE NEXT.JS AMBIENT TYPES, IN A FILE THAT SURVIVES A FRESH CLONE.
 *
 * Next generates `next-env.d.ts` in the project root with these same two
 * references, and that file is deliberately NOT in version control — Next's own
 * documentation says so in two places ("should not be tracked by version
 * control" in the project-structure reference, "We recommend adding
 * next-env.d.ts to your .gitignore file" in the TypeScript config reference),
 * and the generated copy imports `./.next/types/routes.d.ts`, which is build
 * output. `.gitignore` therefore ignores it, correctly.
 *
 * The consequence is that a fresh clone has no ambient Next types until
 * something runs `next dev` or `next build`, and `tsc --noEmit` before either
 * of those fails on two real imports:
 *
 *   src/app/layout.tsx     `import "./globals.css"` — `declare module '*.css'`
 *                          lives in next/types/global.d.ts, reached only
 *                          through `/// <reference types="next" />`.
 *   src/Themes/packages.ts `import auroraScreenshot from "…/screenshot.png"` —
 *                          the image module declarations come from
 *                          next/image-types/global.
 *
 * That is a contributor's first command failing for a reason that names neither
 * cause. This file is the fix Next itself prescribes for the case: when you
 * need declarations that persist, "create a new file … and reference it in your
 * tsconfig.json" rather than editing the generated one. No `tsconfig.json`
 * change is needed here — its `include` already covers every `.ts` file in the
 * project, this one among them.
 *
 * It is additive, not a replacement. When `next-env.d.ts` does exist the two
 * files carry the same triple-slash references and TypeScript resolves each
 * reference once, so nothing is duplicated and nothing conflicts. Do not add
 * project-specific declarations here; put those in their own `.d.ts` beside the
 * code that needs them, the way `src/Framework/Auth/next-auth.d.ts` does.
 *
 * No `export` on purpose: this is a global script file, exactly like the
 * `next-env.d.ts` it stands in for. Adding one would turn it into a module and
 * change what a future declaration placed here would mean.
 */
