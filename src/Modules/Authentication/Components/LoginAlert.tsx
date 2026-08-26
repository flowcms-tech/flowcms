import { AlertCircle } from "lucide-react"

export default function LoginAlert({ message }: { message: string | null }) {
  if (!message) return null

  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <AlertCircle size={16} className="shrink-0" />
      <span>{message}</span>
    </div>
  )
}
