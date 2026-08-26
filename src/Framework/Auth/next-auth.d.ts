import type { DefaultSession } from "next-auth"
import type { Role } from "./permissions"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      /** Editorial capability. Carried on the JWT and refreshed by the same
       *  ≤60s freshness read that revokes deactivated accounts, so a role
       *  change takes effect within a minute without a per-request query. */
      role: Role
    } & DefaultSession["user"]
  }

  /** What the Credentials provider's `authorize` returns, and what the `jwt`
   *  callback receives on sign-in. Carrying the role here means the first
   *  token is already correct instead of defaulting until the first refresh. */
  interface User {
    role?: Role
  }
}

/** WHY `@auth/core` AND NOT `next-auth/jwt`.
 *
 *  The `JWT` interface is DECLARED in `@auth/core/jwt`. `next-auth/jwt` is a
 *  one-line re-export — `export * from "@auth/core/jwt"` — and a re-export is
 *  not a declaration, so `declare module "next-auth/jwt"` would introduce a
 *  SECOND, unrelated `JWT` rather than merging with the one the `jwt` and
 *  `session` callbacks actually receive. It would typecheck and do nothing:
 *  `token.id` would stay `{}`, which is the exact failure this fixes.
 *
 *  Augmenting a module therefore means depending on the package that declares
 *  it, so `@auth/core` is a direct dependency of this application. It is
 *  pinned EXACTLY, not caret-ranged: `next-auth` and `@auth/drizzle-adapter`
 *  both pin `@auth/core` exactly, and a root caret range that floated to a
 *  newer patch would install a second copy beside theirs. The augmentation
 *  would then land on the copy the callbacks do not use — silently, with no
 *  error anywhere. One version string, one copy, one `JWT`.
 *
 *  Before Phase 8.7 this augmentation resolved only because npm hoists
 *  `@auth/core` to the top level. pnpm's isolated layout does not, and the
 *  build failed at `auth.config.ts` with
 *  `Type '{}' is not assignable to type 'string'`. Do not remove the
 *  dependency and rely on hoisting again.
 */
declare module "@auth/core/jwt" {
  interface JWT {
    id?: string
    role?: Role
    lastChecked?: number
  }
}
