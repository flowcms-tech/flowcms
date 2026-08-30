"use client"

import { useFormContext } from "react-hook-form"
import { Sparkles } from "lucide-react"

/**
 * "Generate strong password", as the end content of the password field.
 *
 * WHY IT EXISTS. `MIN_OWNER_PASSWORD_LENGTH` is six, which is a floor rather
 * than a recommendation, and a floor is what people build on when nothing
 * easier is offered. This makes the strong option the cheaper one: a click,
 * versus inventing something and typing it twice.
 *
 * IT DISPLAYS NOTHING ITSELF. An earlier version rendered the generated value
 * in a panel below the field, which meant the same password appeared on screen
 * three times — masked in Password, in plain text in the panel, and masked
 * again in Confirm password. The field's own eye toggle already reveals it, so
 * the panel was a third copy of something the form was showing twice.
 */

/**
 * Twenty characters from a 74-character alphabet — about 124 bits, and far
 * enough above the six-character minimum that the two are not really the same
 * kind of thing.
 */
const GENERATED_LENGTH = 20

/**
 * No quotes, backslashes, backticks or spaces. This value gets pasted into
 * shells, YAML files and env files by people wiring up a deployment, and every
 * one of those characters is a quoting bug waiting for a bad day. Excluding
 * them costs about two bits and removes a class of support ticket.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+"

/**
 * Rejection sampling, not `byte % length`.
 *
 * 256 is not a multiple of 74, so the modulo would make the first 34 letters of
 * the alphabet measurably likelier than the rest. It is a small bias and it is
 * a real one, and discarding the tail of the byte range costs nothing here.
 */
function generatePassword(): string {
  const limit = 256 - (256 % ALPHABET.length)
  const out: string[] = []
  const buffer = new Uint8Array(GENERATED_LENGTH)

  while (out.length < GENERATED_LENGTH) {
    // `crypto.getRandomValues`, never `Math.random` — which is seeded,
    // predictable, and explicitly not for anything anyone has to trust.
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= limit) continue
      out.push(ALPHABET[byte % ALPHABET.length])
      if (out.length === GENERATED_LENGTH) break
    }
  }

  return out.join("")
}

export default function GeneratePassword() {
  const { setValue } = useFormContext()

  const handleGenerate = () => {
    const password = generatePassword()
    // BOTH fields. Asking someone to retype a twenty-character random string
    // they did not choose is asking them to fail a comparison they cannot see.
    setValue("ownerPassword", password, { shouldValidate: true, shouldDirty: true })
    setValue("confirmPassword", password, { shouldValidate: true, shouldDirty: true })
  }

  return (
    <button
      type="button"
      onClick={handleGenerate}
      // FOCUSABLE, unlike the eye and hint buttons. Those reveal what is
      // already there; this one is an action with a result, and a keyboard
      // user who cannot reach it simply does not have the feature.
      title="Generate strong password"
      aria-label="Generate strong password"
      className="inline-flex h-full shrink-0 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Sparkles size={16} aria-hidden />
      Generate
    </button>
  )
}
