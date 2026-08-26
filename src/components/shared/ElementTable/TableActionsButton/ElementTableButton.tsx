import type { ReactNode, ComponentType } from 'react'
import { Loader2, Pencil, Trash2, CheckCircle, XCircle, Eye, Ban, RotateCcw, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ClassValue } from 'clsx'

interface TableButtonProps {
  onClick?: () => void
  title?: string
  label?: string
  icon?: ReactNode
  className?: ClassValue
  isLoading?: boolean
  disabled?: boolean
}

function EditButton({
  onClick,
  title = 'Edit',
  icon,
  className,
  isLoading = false,
  disabled = false,
}: TableButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={isLoading || disabled}
            className={cn(
              'inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              className,
            )}
          >
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : (icon ?? <Pencil size={15} />)}
          </button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DeleteButton({
  onClick,
  title = 'Delete',
  icon,
  className,
}: TableButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
              className,
            )}
          >
            {icon ?? <Trash2 size={15} />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function AcceptButton({
  onClick,
  title = 'Approve',
  icon,
  className,
  isLoading = false,
  disabled = false,
}: TableButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={isLoading || disabled}
            className={cn(
              'inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-success-light hover:text-success transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              className,
            )}
          >
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : (icon ?? <CheckCircle size={15} />)}
          </button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DenyButton({
  onClick,
  title = 'Deny',
  icon,
  className,
  isLoading = false,
  disabled = false,
}: TableButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={isLoading || disabled}
            className={cn(
              'inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              className,
            )}
          >
            {isLoading ? <Loader2 size={15} className="animate-spin" /> : (icon ?? <XCircle size={15} />)}
          </button>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DetailButton({
  onClick,
  title = 'Details',
  label,
  icon,
  className,
  isLoading = false,
  disabled = false,
}: TableButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            disabled={isLoading || disabled}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md text-info transition-colors',
              'disabled:pointer-events-none disabled:opacity-50',
              label
                ? 'bg-info-light px-2.5 py-1.5 text-xs font-medium hover:bg-info/15'
                : 'justify-center size-8 hover:bg-info-light',
              className,
            )}
          >
            {isLoading ? <Loader2 size={13} className="animate-spin" /> : (icon ?? <Eye size={13} />)}
            {label && <span>{label}</span>}
          </button>
        </TooltipTrigger>
        {!label && <TooltipContent>{title}</TooltipContent>}
      </Tooltip>
    </TooltipProvider>
  )
}

function makeLabeledButton(
  defaultTitle: string,
  DefaultIcon: ComponentType<{ size?: number }>,
  colorClasses: { text: string; bg: string; hover: string },
) {
  return function LabeledButton({
    onClick,
    title = defaultTitle,
    label,
    icon,
    className,
    isLoading = false,
    disabled = false,
  }: TableButtonProps) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onClick}
              disabled={isLoading || disabled}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md transition-colors',
                colorClasses.text,
                'disabled:pointer-events-none disabled:opacity-50',
                label
                  ? `${colorClasses.bg} px-2.5 py-1.5 text-xs font-medium ${colorClasses.hover}`
                  : `justify-center size-8 ${colorClasses.hover}`,
                className,
              )}
            >
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : (icon ?? <DefaultIcon size={13} />)}
              {label && <span>{label}</span>}
            </button>
          </TooltipTrigger>
          {!label && <TooltipContent>{title}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
    )
  }
}

const RejectButton   = makeLabeledButton('Reject',   Ban,       { text: 'text-destructive', bg: 'bg-destructive-light', hover: 'hover:bg-destructive/15' })
const RestoreButton  = makeLabeledButton('Restore',  RotateCcw, { text: 'text-success',     bg: 'bg-success-light',     hover: 'hover:bg-success/15' })
const PriorityButton = makeLabeledButton('Prioritise', Star,    { text: 'text-violet',      bg: 'bg-violet-light',      hover: 'hover:bg-violet/15' })

const ElementTableButton = {
  edit:      EditButton,
  delete:    DeleteButton,
  accept:    AcceptButton,
  deny:      DenyButton,
  detail:    DetailButton,
  reject:    RejectButton,
  restore:   RestoreButton,
  priority:  PriorityButton,
}

export default ElementTableButton
