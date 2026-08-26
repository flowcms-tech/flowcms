"use client"

/**
 * What the deployment can and cannot do, in the safest terms that are still
 * useful.
 *
 * This renders on an UNAUTHENTICATED page that anyone who finds a fresh install
 * can read, so it carries states and nothing else — no endpoint, no bucket, no
 * hostname, no credential, no exception text. An operator who needs the detail
 * reads the server log, where it is written redacted.
 */

export type PrerequisiteState =
  | "ready"
  | "unavailable"
  | "not_configured"
  | "migrations_pending"
  // Login CAPTCHA configuration (Phase 7.1.1). Deployment configuration, shown
  // here as a state and never editable from this page.
  | "missing"
  | "unsafe"

const LABELS: Record<PrerequisiteState, string> = {
  ready: "Ready",
  unavailable: "Unavailable",
  not_configured: "Not configured",
  migrations_pending: "Migrations pending",
  missing: "Not configured",
  unsafe: "Not usable",
}

const TONES: Record<PrerequisiteState, string> = {
  ready: "text-emerald-500",
  unavailable: "text-red-500",
  not_configured: "text-amber-500",
  migrations_pending: "text-amber-500",
  missing: "text-amber-500",
  unsafe: "text-red-500",
}

function Row({ label, state }: { label: string; state: PrerequisiteState }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${TONES[state]}`}>{LABELS[state]}</span>
    </li>
  )
}

export default function PrerequisiteList({
  database,
  storage,
  captcha,
  auth,
}: {
  database: PrerequisiteState
  storage: PrerequisiteState
  captcha: PrerequisiteState
  auth: PrerequisiteState
}) {
  return (
    <section className="rounded-lg border border-border p-4">
      <h2 className="text-sm font-semibold text-foreground">System checks</h2>
      <ul className="mt-2 divide-y divide-border">
        <Row label="Database" state={database} />
        <Row label="Storage" state={storage} />
        <Row label="Login security" state={captcha} />
        <Row label="Authentication security" state={auth} />
      </ul>
      {storage !== "ready" && (
        <p className="mt-3 text-xs text-muted-foreground">
          FlowCMS stores all media in S3-compatible storage and has no local file backend, so
          setup cannot complete until storage works. Check the deployment&apos;s storage
          configuration, then reload this page.
        </p>
      )}
      {captcha !== "ready" && (
        <p className="mt-3 text-xs text-muted-foreground">
          The login CAPTCHA needs a <code className="rounded bg-muted px-1 py-0.5">CAPTCHA_SECRET</code>{" "}
          in the deployment&apos;s environment. Without one, nobody can sign in after setup — so
          setup will not complete until it is set. Add it and restart, then reload this page.
        </p>
      )}
      {auth !== "ready" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Session security needs an <code className="rounded bg-muted px-1 py-0.5">AUTH_SECRET</code>{" "}
          in the deployment&apos;s environment. It signs every session, so setup will not complete
          until a strong one is set. Add it and restart, then reload this page.
        </p>
      )}
      {/* Redis is deliberately absent. It is optional, it never blocks setup,
          and listing it as a check would imply otherwise. */}
    </section>
  )
}
