import { z } from "zod"
import { normalizeEmail } from "@/Framework/Auth/identity"
import {
  MAX_OWNER_EMAIL_LENGTH,
  MAX_OWNER_NAME_LENGTH,
  MAX_OWNER_PASSWORD_LENGTH,
  MAX_SITE_NAME_LENGTH,
  MAX_TAGLINE_LENGTH,
  MIN_OWNER_PASSWORD_LENGTH,
} from "@/Framework/Setup/ownerRules"

/**
 * The transport schema for first-run setup, shared by the form and the route —
 * the same arrangement every other module uses.
 *
 * THE BOUNDS ARE IMPORTED, NOT RESTATED. `Framework/Setup/ownerRules` holds
 * them, and `completeSetup` — the domain — imports the same module, so
 * `create-flowcms` or any other caller gets the same answer without knowing
 * which Zod schema to reach for.
 *
 * They come from `ownerRules` rather than from `completeSetup` for a concrete
 * reason: this file is imported by a `'use client'` form, and importing the
 * domain pulled `@/db/client` — and therefore `postgres`, `mysql2` and
 * `@libsql/client` — into the browser bundle. `next build` fails on that with
 * unresolved `net`/`dns`/`fs`, which is how it was found.
 *
 * This schema
 * exists to give the browser a good error before a round trip, and to bound
 * every field before anything reaches the database.
 *
 * `.strict()` because this endpoint is unauthenticated: an unexpected key is
 * either a client bug or someone probing for a mass-assignment path into the
 * settings row, and neither deserves to be silently ignored.
 */

/**
 * Rejects control characters, including the ones that survive a `trim()`.
 *
 * Site name and tagline are operator content that ends up in a `<title>`, in
 * structured data, and in an RSS feed. They are stored verbatim and escaped at
 * render — the right amount of rewriting an operator's own words is none — but
 * a raw newline or a NUL in a title is a formatting bug in three places at
 * once, so the boundary refuses it rather than the renderer papering over it.
 */
const NO_CONTROL_CHARS = (value: string) => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export const setupSchema = z
  .object({
    siteName: z
      .string()
      .trim()
      .min(1, "Site name is required")
      .max(MAX_SITE_NAME_LENGTH, `Site name must be at most ${MAX_SITE_NAME_LENGTH} characters`)
      .refine(NO_CONTROL_CHARS, "Site name must not contain control characters"),

    tagline: z
      .string()
      .trim()
      .max(MAX_TAGLINE_LENGTH, `Tagline must be at most ${MAX_TAGLINE_LENGTH} characters`)
      .refine(NO_CONTROL_CHARS, "Tagline must not contain control characters")
      .optional()
      .or(z.literal("")),

    ownerName: z.string().trim().max(MAX_OWNER_NAME_LENGTH, `Name must be at most ${MAX_OWNER_NAME_LENGTH} characters`).optional().or(z.literal("")),

    ownerEmail: z
      .string()
      .trim()
      .min(1, "Email is required")
      .email("Invalid email")
      .max(MAX_OWNER_EMAIL_LENGTH, `Email must be at most ${MAX_OWNER_EMAIL_LENGTH} characters`)
      .transform(normalizeEmail),

    ownerPassword: z
      .string()
      .min(MIN_OWNER_PASSWORD_LENGTH, `Password must be at least ${MIN_OWNER_PASSWORD_LENGTH} characters`)
      // Bounded because bcrypt is expensive and this endpoint is
      // unauthenticated. bcrypt also silently truncates past 72 bytes, so a
      // longer value would create a password whose tail does nothing.
      .max(MAX_OWNER_PASSWORD_LENGTH, `Password must be at most ${MAX_OWNER_PASSWORD_LENGTH} characters`),

    confirmPassword: z.string(),

    /**
     * The deployment secret. Bounded like everything else, and NEVER given a
     * message that repeats it — a Zod error is rendered on the page and
     * serialised into a log.
     */
    setupToken: z.string().min(1, "Setup token is required").max(512, "Setup token is too long"),
  })
  .strict()
  .refine((values) => values.ownerPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

export type SetupFormValues = z.infer<typeof setupSchema>
