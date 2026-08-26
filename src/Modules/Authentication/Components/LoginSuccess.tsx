import { CheckCircle2 } from "lucide-react"

export default function LoginSuccess({ isShown }: { isShown: boolean }) {
  if (!isShown) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-50 px-3 py-2 text-sm text-green-700">
      <CheckCircle2 size={16} className="shrink-0" />
      <span>Signed in successfully. Redirecting…</span>
    </div>
  )
}
