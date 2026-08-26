import ElementBadge from '@/components/shared/ElementBadge/ElementBadge'
import type { AuditSeverity } from '../Types'

/** Severity is a status, so it wears the status palette and always ships with
 *  its label — never colour alone. */
const SEVERITY_META: Record<AuditSeverity, { label: string; variant: 'destructive' | 'warning' | 'info' }> = {
  critical: { label: 'Critical', variant: 'destructive' },
  warning: { label: 'Worth fixing', variant: 'warning' },
  info: { label: 'Optional', variant: 'info' },
}

/** Critical first — the list is meant to be worked top-down. */
export const SEVERITY_ORDER: AuditSeverity[] = ['critical', 'warning', 'info']

export function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const meta = SEVERITY_META[severity]
  return <ElementBadge variant={meta.variant}>{meta.label}</ElementBadge>
}

export function scoreTone(score: number): string {
  if (score >= 80) return 'text-success'
  if (score >= 50) return 'text-warning'
  return 'text-destructive'
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'never'
  return date.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}
