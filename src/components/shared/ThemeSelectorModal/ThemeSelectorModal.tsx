'use client'

import * as React from 'react'
import { motion } from 'framer-motion'
import { Check, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Dialog as DialogPrimitive } from 'radix-ui'
import ElementButton from '@/components/shared/ElementButton/ElementButton'
import {
  getThemeCookie,
  setThemeCookie,
  type ThemeScheme,
} from '@/Framework/utils/cookieUtils'

interface ThemeVariant {
  value: ThemeScheme
  label: string
  mock: {
    bg: string
    sidebar: string
    sidebarActive: string
    cardBg: string
    line: string
    lineDim: string
    primary: string
    text: string
  }
}

const LIGHT_VARIANTS: ThemeVariant[] = [
  {
    value: 'light',
    label: 'Default',
    mock: {
      bg: 'bg-white',
      sidebar: 'bg-neutral-50 border-neutral-200',
      sidebarActive: 'bg-neutral-900',
      cardBg: 'bg-neutral-50',
      line: 'bg-neutral-300',
      lineDim: 'bg-neutral-100',
      primary: 'bg-neutral-900',
      text: 'text-neutral-500',
    },
  },
  {
    value: 'light-blue',
    label: 'Blue',
    mock: {
      bg: 'bg-[oklch(0.975_0.012_240)]',
      sidebar: 'bg-[oklch(0.955_0.016_240)] border-[oklch(0.88_0.02_240)]',
      sidebarActive: 'bg-[oklch(0.5_0.18_256)]',
      cardBg: 'bg-[oklch(0.93_0.018_240)]',
      line: 'bg-[oklch(0.6_0.05_250)]',
      lineDim: 'bg-[oklch(0.9_0.02_240)]',
      primary: 'bg-[oklch(0.5_0.18_256)]',
      text: 'text-[oklch(0.5_0.03_250)]',
    },
  },
]

const DARK_VARIANTS: ThemeVariant[] = [
  {
    value: 'dark',
    label: 'Default',
    mock: {
      bg: 'bg-neutral-900',
      sidebar: 'bg-neutral-800 border-neutral-700',
      sidebarActive: 'bg-white',
      cardBg: 'bg-neutral-800',
      line: 'bg-neutral-500',
      lineDim: 'bg-neutral-700',
      primary: 'bg-white',
      text: 'text-neutral-400',
    },
  },
  {
    value: 'dark-blue',
    label: 'Navy',
    mock: {
      bg: 'bg-[oklch(0.12_0.022_256)]',
      sidebar: 'bg-[oklch(0.14_0.024_256)] border-[oklch(1_0_0/8%)]',
      sidebarActive: 'bg-[oklch(0.62_0.12_254)]',
      cardBg: 'bg-[oklch(0.16_0.028_256)]',
      line: 'bg-[oklch(0.62_0.02_245)]',
      lineDim: 'bg-[oklch(0.2_0.025_256)]',
      primary: 'bg-[oklch(0.62_0.12_254)]',
      text: 'text-[oklch(0.62_0.02_245)]',
    },
  },
]

function PanelPreview({ mock, isSidebarActiveLight }: { mock: ThemeVariant['mock']; isSidebarActiveLight: boolean }) {
  return (
    <div className={cn('flex h-24 w-full overflow-hidden rounded-lg border', mock.bg, mock.sidebar.split(' ')[1])}>
      <div className={cn('flex w-8 flex-col gap-1.5 border-e p-2', mock.sidebar)}>
        <div className={cn('h-2 w-full rounded-sm', mock.sidebarActive)} />
        <div className={cn('h-2 w-full rounded-sm', mock.lineDim)} />
        <div className={cn('h-2 w-full rounded-sm', mock.lineDim)} />
        <div className={cn('h-2 w-full rounded-sm', mock.lineDim)} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-center justify-between">
          <div className={cn('h-1.5 w-10 rounded-full', mock.line)} />
          <div className={cn('h-2.5 w-2.5 rounded-full', mock.primary, isSidebarActiveLight && 'ring-1 ring-black/10')} />
        </div>
        <div className="grid grid-cols-3 gap-1">
          <div className={cn('h-6 rounded-sm', mock.cardBg)} />
          <div className={cn('h-6 rounded-sm', mock.cardBg)} />
          <div className={cn('h-6 rounded-sm', mock.cardBg)} />
        </div>
        <div className={cn('h-1.5 w-2/3 rounded-full', mock.lineDim)} />
      </div>
    </div>
  )
}

interface ThemeColumnProps {
  groupLabel: string
  groupIcon: React.ReactNode
  variants: ThemeVariant[]
  selected: ThemeScheme
  onSelect: (theme: ThemeScheme) => void
}

function ThemeColumn({ groupLabel, groupIcon, variants, selected, onSelect }: ThemeColumnProps) {
  return (
    <div className="flex flex-1 flex-col gap-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {groupIcon}
        {groupLabel}
      </div>
      {variants.map((variant) => {
        const isSelected = selected === variant.value
        return (
          <button
            key={variant.value}
            type="button"
            onClick={() => onSelect(variant.value)}
            className={cn(
              'relative flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors',
              isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
            )}
          >
            {isSelected && (
              <motion.span
                layoutId="theme-selected-check"
                transition={{ duration: 0.18 }}
                className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                <Check size={11} strokeWidth={3} />
              </motion.span>
            )}
            <PanelPreview mock={variant.mock} isSidebarActiveLight={variant.value === 'dark'} />
            <span className="text-xs font-medium text-foreground">{variant.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export interface ThemeSelectorModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function ThemeSelectorModal({ open, onOpenChange }: ThemeSelectorModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ThemeSelectorModalContent onOpenChange={onOpenChange} />}
    </Dialog>
  )
}

function ThemeSelectorModalContent({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const initialTheme = document.documentElement.classList.contains('dark')
    ? (document.documentElement.classList.contains('theme-blue') ? 'dark-blue' : 'dark')
    : (document.documentElement.classList.contains('theme-blue') ? 'light-blue' : 'light')
  const originalThemeRef = React.useRef<ThemeScheme>(initialTheme)
  const [selected, setSelected] = React.useState<ThemeScheme>(
    () => getThemeCookie() ?? initialTheme
  )

  React.useEffect(() => {
    const original = originalThemeRef.current
    return () => {
      if (!getThemeCookie()) {
        document.documentElement.classList.toggle('dark', original.startsWith('dark'))
        document.documentElement.classList.toggle('theme-blue', original.endsWith('blue'))
      }
    }
  }, [])

  function applyPreview(theme: ThemeScheme) {
    setSelected(theme)
    document.documentElement.classList.toggle('dark', theme.startsWith('dark'))
    document.documentElement.classList.toggle('theme-blue', theme.endsWith('blue'))
  }

  function handleSkip() {
    document.documentElement.classList.toggle('dark', originalThemeRef.current.startsWith('dark'))
    document.documentElement.classList.toggle('theme-blue', originalThemeRef.current.endsWith('blue'))
    onOpenChange(false)
  }

  function handleConfirm() {
    document.documentElement.classList.toggle('dark', selected.startsWith('dark'))
    document.documentElement.classList.toggle('theme-blue', selected.endsWith('blue'))
    setThemeCookie(selected)
    onOpenChange(false)
  }

  return (
    <DialogContent
      aria-describedby={undefined}
      className="w-[92vw] max-w-[480px] gap-0 overflow-hidden rounded-2xl p-0"
    >
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
          L
        </span>
        <div>
          <DialogTitle className="text-base font-semibold text-foreground">
            Choose your panel theme
          </DialogTitle>
          <DialogPrimitive.Description className="text-xs text-muted-foreground">
            You can change this anytime from the header
          </DialogPrimitive.Description>
        </div>
      </div>

      <div className="flex gap-4 p-5">
        <ThemeColumn
          groupLabel="Light"
          groupIcon={<Sun size={13} />}
          variants={LIGHT_VARIANTS}
          selected={selected}
          onSelect={applyPreview}
        />
        <div className="w-px shrink-0 self-stretch bg-border" />
        <ThemeColumn
          groupLabel="Dark"
          groupIcon={<Moon size={13} />}
          variants={DARK_VARIANTS}
          selected={selected}
          onSelect={applyPreview}
        />
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border bg-background px-5 py-3.5">
        <ElementButton variant="cancel" size="default" onClick={handleSkip}>
          Later
        </ElementButton>
        <ElementButton variant="primary" size="default" onClick={handleConfirm}>
          Confirm
        </ElementButton>
      </div>
    </DialogContent>
  )
}
