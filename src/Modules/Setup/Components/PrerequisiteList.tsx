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
  // Something WAS set and is wrong — an unknown STORAGE_DRIVER, or a local
  // driver with no path. Kept separate from `not_configured` because the
  // operator's next action differs: fix a value, versus supply one.
  | "misconfigured"
  | "migrations_pending"
  // Login CAPTCHA configuration (Phase 7.1.1). Deployment configuration, shown
  // here as a state and never editable from this page.
  | "missing"
  | "unsafe"

const LABELS: Record<PrerequisiteState, string> = {
  ready: "Ready",
  unavailable: "Unavailable",
  not_configured: "Not configured",
  misconfigured: "Misconfigured",
  migrations_pending: "Migrations pending",
  missing: "Not configured",
  unsafe: "Not usable",
}

const TONES: Record<PrerequisiteState, string> = {
  ready: "text-emerald-500",
  unavailable: "text-red-500",
  not_configured: "text-amber-500",
  // Red, not amber: an unconfigured install is an expected waypoint, a wrong
  // value is a mistake that will not resolve itself.
  misconfigured: "text-red-500",
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
      {storage === "misconfigured" && (
        <p className="mt-3 text-xs text-muted-foreground">
          The deployment&apos;s storage configuration is set to something FlowCMS does not
          recognise. <code className="rounded bg-muted px-1 py-0.5">STORAGE_DRIVER</code> must be{" "}
          <code className="rounded bg-muted px-1 py-0.5">s3</code> or{" "}
          <code className="rounded bg-muted px-1 py-0.5">local</code> — a bundled Garage
          deployment uses <code className="rounded bg-muted px-1 py-0.5">s3</code>, because Garage
          is an S3-compatible server rather than a separate driver. A{" "}
          <code className="rounded bg-muted px-1 py-0.5">local</code> deployment also needs{" "}
          <code className="rounded bg-muted px-1 py-0.5">LOCAL_STORAGE_PATH</code>. Fix it,
          restart, then reload this page.
        </p>
      )}
      {(storage === "not_configured" || storage === "unavailable") && (
        <p className="mt-3 text-xs text-muted-foreground">
          FlowCMS stores every uploaded file through its storage backend, so setup cannot
          complete until that backend works. Check the deployment&apos;s{" "}
          <code className="rounded bg-muted px-1 py-0.5">STORAGE_DRIVER</code> — either{" "}
          <code className="rounded bg-muted px-1 py-0.5">local</code>, with a writable{" "}
          <code className="rounded bg-muted px-1 py-0.5">LOCAL_STORAGE_PATH</code>, or{" "}
          <code className="rounded bg-muted px-1 py-0.5">s3</code> with a reachable bucket — then
          reload this page.
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
