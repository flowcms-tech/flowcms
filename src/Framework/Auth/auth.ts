import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/db/client"
import { users, accounts, sessions, verificationTokens } from "@/db/tables"
import { authConfig } from "./auth.config"
import { normalizeEmail } from "./identity"
import { verifyPassword } from "./password"
import { resolveRole } from "./permissions"
import { CAPTCHA_COOKIE_NAME, consumeCaptcha } from "@/Framework/Captcha/captcha"
import {
  clearLoginAttempts,
  clientIpFromHeaders,
  registerLoginAttempt,
} from "./loginProtection"


/**
 * Sign-in refusals, as codes that reach the login page without telling an
 * attacker anything.
 *
 * None of these distinguish "no such account" from "wrong password" — the
 * generic code covers both, and it is returned identically whether or not the
 * email exists. `rate_limited` and `captcha` are safe to reveal because both
 * are produced before the user table is consulted, so neither confirms that an
 * account is there.
 */
export const SIGN_IN_ERROR_CODES = {
  invalidCredentials: "invalid_credentials",
  captcha: "captcha",
  rateLimited: "rate_limited",
} as const

class SignInRefused extends CredentialsSignin {
  constructor(code: string) {
    super()
    this.code = code
  }
}

// Credentials provider forces JWT sessions (Auth.js does not support the
// "database" session strategy for Credentials). To still get near-instant
// revocation when a staff account is deactivated, the jwt callback re-checks
// the DB at most once per this interval instead of on every request.
const FRESHNESS_CHECK_INTERVAL_MS = 60_000

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        captcha: { label: "Security code", type: "text" },
      },
      /**
       * THE ONLY PLACE A PASSWORD IS EVER CHECKED.
       *
       * Everything guarding sign-in has to live here, because this is the only
       * point every attempt provably passes through. It previously did not:
       * the login page called a `verifyCaptcha` server action and then called
       * `signIn("credentials")` as a separate step, so posting directly at
       * /api/auth/callback/credentials skipped the captcha entirely and
       * permitted unlimited password guessing. `src/proxy.ts` could not have
       * caught it either — its matcher deliberately excludes /api, so it never
       * sees /api/auth.
       *
       * Order matters and is deliberate:
       *
       *   1. Throttle first, so a throttled attempt never reaches bcrypt and
       *      cannot be used to burn CPU.
       *   2. Captcha second, so automated guessing has to solve one per try.
       *   3. Only then look the user up and compare the password.
       *
       * Steps 1 and 2 run before the user table is touched, so their refusals
       * cannot be used to enumerate accounts.
       */
      async authorize(credentials, request) {
        const email = credentials?.email
        const password = credentials?.password
        const captcha = credentials?.captcha
        if (typeof email !== "string" || typeof password !== "string") {
          throw new SignInRefused(SIGN_IN_ERROR_CODES.invalidCredentials)
        }

        const ip = clientIpFromHeaders(
          request instanceof Request ? request.headers : new Headers()
        )
        const identity = { email, ip }

        const throttle = await registerLoginAttempt(identity)
        if (throttle.limited) {
          throw new SignInRefused(SIGN_IN_ERROR_CODES.rateLimited)
        }

        // Read from the cookie jar rather than trusting anything the client
        // says about having already passed — a "captchaVerified: true" field
        // would be worth exactly what the client decides it is worth.
        const cookieStore = await cookies()
        const token = cookieStore.get(CAPTCHA_COOKIE_NAME)?.value
        if (typeof captcha !== "string" || !(await consumeCaptcha(token, captcha))) {
          throw new SignInRefused(SIGN_IN_ERROR_CODES.captcha)
        }

        // Normalised before lookup, matching the form it was stored in. Without
        // this, a user who signed up as `User@…` and typed `user@…` would be
        // told their own account does not exist — on PostgreSQL and SQLite
        // only, because MySQL and MariaDB compare case-insensitively. A bug
        // that appears on half the supported engines is the worst kind to hunt.
        const user = await db.query.users.findFirst({
          where: eq(users.email, normalizeEmail(email)),
        })
        if (!user?.passwordHash || !user.isActive) {
          throw new SignInRefused(SIGN_IN_ERROR_CODES.invalidCredentials)
        }

        const valid = await verifyPassword(password, user.passwordHash)
        if (!valid) {
          throw new SignInRefused(SIGN_IN_ERROR_CODES.invalidCredentials)
        }

        // Only a completed sign-in clears the counters, so a successful login
        // does not leave a user carrying their own earlier typos.
        await clearLoginAttempts(identity)

        return { id: user.id, email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = resolveRole(user.role)
        token.lastChecked = Date.now()
        return token
      }

      const lastChecked = token.lastChecked ?? 0
      if (!token.id || Date.now() - lastChecked < FRESHNESS_CHECK_INTERVAL_MS) {
        return token
      }

      const dbUser = await db.query.users.findFirst({
        where: eq(users.id, token.id),
      })

      if (!dbUser || !dbUser.isActive) {
        token.id = undefined
        return token
      }

      // Folded into the existing revocation read rather than given a query of
      // its own: a demotion has the same urgency as a deactivation, and both
      // now land within FRESHNESS_CHECK_INTERVAL_MS for the cost of reading one
      // more column off a row already in hand.
      token.role = resolveRole(dbUser.role)
      token.lastChecked = Date.now()
      return token
    },
  },
})
