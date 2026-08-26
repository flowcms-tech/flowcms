"use client"

import * as React from "react"
import { useState, useMemo, useCallback, createContext, useContext } from "react"
import { Controller, useFormContext } from "react-hook-form"
import type { Control, UseFormReturn, FieldValues } from "react-hook-form"
import { CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react"
import { format, addMonths, addDays, startOfMonth, endOfMonth, isSameMonth } from "date-fns"
import {
  type CaptionProps,
  type DayClickEventHandler,
  type DateRange,
  type ActiveModifiers,
} from "react-day-picker"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AnimatePresence, motion } from "framer-motion"
import type { ClassValue } from "clsx"
import ElementLabelHint from "@/components/shared/ElementLabelHint/ElementLabelHint"

// --- Range formatting ---------------------------------------------------------

function formatRange(from: Date, to: Date): string {
  return `${format(from, 'MMM d, yyyy')} ~ ${format(to, 'MMM d, yyyy')}`
}

// --- Date helpers -------------------------------------------------------------

function dateToYMD(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function ymdToDate(ymd: string): Date | undefined {
  if (!ymd) return undefined
  const d = new Date(ymd + 'T00:00:00')
  return isNaN(d.getTime()) ? undefined : d
}

function normalizeDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function resolveDisplayDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value
  return ymdToDate(value)
}

// --- Range caption navigation context ----------------------------------------

interface RangeCaptionNav { onPrev: () => void; onNext: () => void }
const RangeCaptionNavCtx = createContext<RangeCaptionNav>({ onPrev: () => {}, onNext: () => {} })

// --- Caption components -------------------------------------------------------

function RangeCaption({ displayMonth }: CaptionProps) {
  const { onPrev, onNext } = useContext(RangeCaptionNavCtx)

  return (
    <div className="flex items-center justify-between px-2 py-1.5 border border-border rounded-lg mb-1">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous month"
        className={cn(buttonVariants({ variant: 'ghost' }), 'h-7 w-7 p-0 opacity-50 hover:opacity-100')}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-sm font-medium text-foreground">{format(displayMonth, 'MMMM yyyy')}</span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next month"
        className={cn(buttonVariants({ variant: 'ghost' }), 'h-7 w-7 p-0 opacity-50 hover:opacity-100')}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

// --- Range calendar classNames ------------------------------------------------

const RANGE_CELL = [
  'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
  '[&:has([aria-selected].day-range-middle)]:bg-primary/10',
  '[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md',
  'first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md',
].join(' ')

const RANGE_CALENDAR_CLASSNAMES = {
  months: 'flex flex-col',
  month: 'space-y-3',
  caption: 'relative',
  caption_label: 'hidden',
  nav: 'hidden', nav_button: 'hidden', nav_button_previous: 'hidden', nav_button_next: 'hidden',
  table: 'w-full border-collapse',
  head_row: 'flex',
  head_cell: 'text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center',
  row: 'flex w-full mt-2',
  cell: RANGE_CELL,
  day_range_start: 'day-range-start !bg-primary !text-primary-foreground rounded-l-full rounded-r-none hover:!rounded-full z-10 relative',
  day_range_end: 'day-range-end !bg-primary !text-primary-foreground rounded-r-full hover:!rounded-full z-10 relative',
  day_selected: '',
  day_today: 'bg-accent text-accent-foreground font-semibold',
  day_outside: 'day-outside text-muted-foreground opacity-30 pointer-events-none aria-selected:!bg-transparent',
  day_disabled: 'text-muted-foreground opacity-50 pointer-events-none',
  day_range_middle: 'day-range-middle aria-selected:!bg-primary/10 aria-selected:!text-foreground aria-selected:rounded-none',
  day_hidden: 'invisible',
}

// --- Default presets ----------------------------------------------------------

export interface DateRangePreset {
  label: string
  startDate: Date
  endDate: Date
}

function buildDefaultPresets(): DateRangePreset[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return [
    { label: 'Today',        startDate: today,                              endDate: today },
    { label: 'Yesterday',    startDate: addDays(today, -1),                 endDate: addDays(today, -1) },
    { label: 'Last 7 days',  startDate: addDays(today, -6),                 endDate: today },
    { label: 'Last 30 days', startDate: addDays(today, -29),                endDate: today },
    { label: 'This month',   startDate: startOfMonth(today),                endDate: endOfMonth(today) },
    { label: 'Last month',   startDate: startOfMonth(addMonths(today, -1)), endDate: endOfMonth(addMonths(today, -1)) },
  ]
}

function isSameOrAfterMonth(a: Date, b: Date) {
  return a.getFullYear() > b.getFullYear() ||
    (a.getFullYear() === b.getFullYear() && a.getMonth() >= b.getMonth())
}

// --- Types --------------------------------------------------------------------

export interface ElementDatePickerClassNames {
  root?:         ClassValue
  label?:        ClassValue
  requiredMark?: ClassValue
  trigger?:      ClassValue
  triggerText?:  ClassValue
  icon?:         ClassValue
  clearButton?:  ClassValue
  content?:      ClassValue
  error?:        ClassValue
  hint?:         ClassValue
}

export type ErrorVariant = 'default' | 'boxBelow'

export interface ElementDatePickerProps {
  /**
   * Field name. When provided inside a <FormProvider>, the picker auto-connects
   * to that form context. You can also pass an explicit `control` prop instead.
   */
  name?: string
  /** Explicit react-hook-form Control object (when not using FormProvider). */
  control?: Control<FieldValues>

  // -- Standalone / controlled mode --
  /** Current value (Date, 'yyyy-MM-dd' string, or null). Used when not in form mode. */
  value?: Date | string | null
  /** Called when a date is selected or cleared. Also called in form mode as a side-effect. */
  onChange?: (date: Date | undefined) => void

  // -- Common props --
  label?:           string
  required?:        boolean
  placeholder?:     string
  disablePast?:     boolean
  disableFuture?:   boolean
  showClearButton?: boolean
  disabled?:        boolean
  hint?:            string
  /** "default" slides error text below; "boxBelow" attaches a bordered box to the trigger bottom. */
  errorVariant?:    ErrorVariant
  className?:       string
  classNames?:      ElementDatePickerClassNames
}

export interface ElementRangeDatePickerClassNames {
  root?:           ClassValue
  trigger?:        ClassValue
  triggerText?:    ClassValue
  icon?:           ClassValue
  clearButton?:    ClassValue
  content?:        ClassValue
  presetsPanel?:   ClassValue
  presetButton?:   ClassValue
  calendarsPanel?: ClassValue
  error?:          ClassValue
}

export interface ElementRangeDatePickerProps {
  /**
   * Field name for the start-date form field.
   * Both startName + endName must be provided together for form mode.
   */
  startName?: string
  /** Field name for the end-date form field. */
  endName?: string
  /** Explicit react-hook-form Control object (when not using FormProvider). */
  control?: Control<FieldValues>

  // -- Standalone / controlled mode --
  startDate?: Date | string | null
  endDate?:   Date | string | null
  onChange?:  (range: { startDate: Date | null; endDate: Date | null }) => void

  // -- Common props --
  placeholder?:     string
  disabled?:        boolean
  showClearButton?: boolean
  showPresets?:     boolean
  presets?:         DateRangePreset[]
  /** "default" slides error text below; "boxBelow" attaches a bordered box to the trigger bottom. */
  errorVariant?:    ErrorVariant
  className?:       string
  classNames?:      ElementRangeDatePickerClassNames
}

// --- Single Date Picker — core UI (no RHF dependency) ------------------------

interface DatePickerCoreProps {
  value?:           Date | string | null
  onChange?:        (date: Date | undefined) => void
  onBlur?:          () => void
  error?:           { message?: string }
  name?:            string
  label?:           string
  required?:        boolean
  placeholder?:     string
  disablePast?:     boolean
  disableFuture?:   boolean
  showClearButton?: boolean
  disabled?:        boolean
  hint?:            string
  errorVariant?:    ErrorVariant
  className?:       string
  classNames?:      ElementDatePickerClassNames
}

function DatePickerCore({
  value,
  onChange,
  onBlur,
  error,
  name,
  label,
  required = false,
  placeholder,
  disablePast = false,
  disableFuture = false,
  showClearButton = false,
  disabled = false,
  hint,
  errorVariant = 'default',
  className,
  classNames = {},
}: DatePickerCoreProps) {
  const [open, setOpen] = useState(false)
  const ph = placeholder ?? 'Pick a date'

  const selectedDate = useMemo(() => resolveDisplayDate(value), [value])

  const displayText = selectedDate ? format(selectedDate, 'MMM d, yyyy') : null

  const handleSelect = (day: Date | undefined) => {
    if (!day) return
    setOpen(false)
    onChange?.(day)
  }

  const handleClear = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    onChange?.(undefined)
  }

  const disabledFn = (date: Date): boolean => {
    if (disableFuture && date > new Date()) return true
    if (disablePast && date < new Date(new Date().setHours(0, 0, 0, 0))) return true
    return false
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className, classNames.root)}>
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={name}
            className={cn(
              'text-sm font-medium leading-none',
              error ? 'text-destructive' : 'text-foreground',
              disabled && 'opacity-50 cursor-not-allowed',
              classNames.label,
            )}
          >
            {label}
            {required && (
              <span className={cn('text-destructive ml-0.5', classNames.requiredMark)}>*</span>
            )}
          </label>
          {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
        </div>
      )}

      <div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              id={name}
              type="button"
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
              onBlur={onBlur}
              className={cn(
                'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2',
                'text-sm transition-colors shadow-xs',
                'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                'disabled:cursor-not-allowed disabled:opacity-50',
                error && 'border-destructive focus-visible:ring-destructive/20',
                errorVariant === 'boxBelow' && error && 'rounded-b-none border-b-0',
                !displayText && 'text-muted-foreground',
                classNames.trigger,
              )}
            >
              <span className={cn('truncate', classNames.triggerText)}>
                {displayText ?? ph}
              </span>
              <span className="flex items-center gap-1 ml-2 shrink-0">
                {showClearButton && selectedDate && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={handleClear}
                    onKeyDown={(e) => e.key === 'Enter' && handleClear(e)}
                    className={cn(
                      'rounded-full p-0.5 hover:bg-muted transition-colors cursor-pointer',
                      classNames.clearButton,
                    )}
                  >
                    <X className="h-3.5 w-3.5 opacity-50" />
                  </span>
                )}
                <CalendarIcon className={cn('h-4 w-4 opacity-40', classNames.icon)} />
              </span>
            </button>
          </PopoverTrigger>

          <PopoverContent className={cn('w-auto p-0', classNames.content)} align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              disabled={disabledFn}
              defaultMonth={selectedDate}
              initialFocus
              showOutsideDays
            />
          </PopoverContent>
        </Popover>

        <AnimatePresence initial={false}>
          {errorVariant === 'boxBelow' && error && (
            <motion.div
              id={`${name}-error`}
              role="alert"
              key="box-error"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  'text-sm text-destructive',
                  'border border-destructive rounded-b-lg px-2.5 py-2 bg-destructive/5',
                  classNames.error,
                )}
              >
                {error.message}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {errorVariant === 'default' && error && (
          <motion.p
            id={`${name}-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn('text-sm text-destructive', classNames.error)}
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>

    </div>
  )
}

// --- ElementDatePicker --------------------------------------------------------
/**
 * Single-date picker that works in two modes:
 *
 * **Form mode** — auto-enabled when `name` is provided and a <FormProvider> ancestor
 * exists (or when an explicit `control` prop is passed). The value is stored as a
 * 'yyyy-MM-dd' string in the form state.
 *
 * **Standalone mode** — when no form context is present, pass `value` / `onChange`
 * directly for fully controlled usage.
 */
export default function ElementDatePicker({
  name,
  control: controlProp,
  value: valueProp,
  onChange: onChangeProp,
  ...rest
}: ElementDatePickerProps) {
  // useFormContext() returns null at runtime when no FormProvider is present
  // (HookFormContext default value is null). We cast to handle this safely.
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  // Form mode: name + control (either from FormProvider or explicit prop)
  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        render={({ field, fieldState: { error } }) => (
          <DatePickerCore
            {...rest}
            name={name}
            value={field.value ?? ''}
            error={error}
            onBlur={field.onBlur}
            onChange={(date) => {
              field.onChange(date ? dateToYMD(date) : '')
              onChangeProp?.(date)
            }}
          />
        )}
      />
    )
  }

  // Standalone mode
  return (
    <DatePickerCore
      {...rest}
      name={name}
      value={valueProp}
      onChange={onChangeProp}
    />
  )
}

// --- Range Date Picker — core UI ---------------------------------------------

interface RangeDatePickerCoreProps {
  startDate?:       Date | string | null
  endDate?:         Date | string | null
  onChange?:        (range: { startDate: Date | null; endDate: Date | null }) => void
  placeholder?:     string
  disabled?:        boolean
  showClearButton?: boolean
  showPresets?:     boolean
  presets?:         DateRangePreset[]
  error?:           { message?: string }
  errorVariant?:    ErrorVariant
  name?:            string
  className?:       string
  classNames?:      ElementRangeDatePickerClassNames
}

function RangeDatePickerCore({
  startDate: propStart,
  endDate: propEnd,
  onChange,
  placeholder,
  disabled = false,
  showClearButton = true,
  showPresets = true,
  presets,
  error,
  errorVariant = 'default',
  name,
  className,
  classNames = {},
}: RangeDatePickerCoreProps) {
  const ph = placeholder ?? 'Select date range'

  const effectiveStart = useMemo(() => normalizeDate(propStart), [propStart])
  const effectiveEnd   = useMemo(() => normalizeDate(propEnd),   [propEnd])

  const resolvedPresets = presets ?? buildDefaultPresets()

  const [isOpen, setIsOpen]   = useState(false)
  const [range, setRange]     = useState<DateRange | undefined>(undefined)
  const [step, setStep]       = useState<'from' | 'to'>('from')
  const [hovered, setHovered] = useState<Date | null>(null)
  const [leftMonth, setLeftMonth]   = useState<Date>(() => effectiveStart ?? new Date())
  const [rightMonth, setRightMonth] = useState<Date>(() => addMonths(effectiveStart ?? new Date(), 1))

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open) {
      setRange(effectiveStart && effectiveEnd
        ? { from: effectiveStart, to: effectiveEnd }
        : undefined)
      setStep('from')
      setHovered(null)
      const base = effectiveStart ?? new Date()
      setLeftMonth(base)
      setRightMonth(addMonths(base, 1))
    }
  }, [effectiveStart, effectiveEnd])

  const handleDayClick: DayClickEventHandler = useCallback((day, modifiers: ActiveModifiers) => {
    if (modifiers.outside || modifiers.disabled) return
    if (step === 'from') {
      setRange({ from: day, to: undefined })
      setHovered(null)
      setStep('to')
    } else {
      const from = range?.from
      if (!from) { setRange({ from: day, to: undefined }); setStep('to'); return }
      const [start, end] = from <= day ? [from, day] : [day, from]
      setRange({ from: start, to: end })
      setHovered(null)
      setStep('from')
      setIsOpen(false)
      onChange?.({ startDate: start, endDate: end })
    }
  }, [step, range, onChange])

  const handleDayMouseEnter = useCallback((day: Date, modifiers: ActiveModifiers) => {
    if (modifiers.outside) return
    if (step === 'to' && range?.from) setHovered(day)
  }, [step, range])

  const calendarRange: DateRange | undefined = useMemo(() => {
    if (step === 'to' && range?.from && !range.to && hovered) {
      const [s, e] = range.from <= hovered ? [range.from, hovered] : [hovered, range.from]
      return { from: s, to: e }
    }
    if (range?.from) return range
    if (effectiveStart && effectiveEnd) return { from: effectiveStart, to: effectiveEnd }
    return undefined
  }, [range, effectiveStart, effectiveEnd, step, hovered])

  const leftNav = useMemo(() => ({
    onPrev: () => setLeftMonth(p => addMonths(p, -1)),
    onNext: () => setLeftMonth(currentLeft => {
      const n = addMonths(currentLeft, 1)
      setRightMonth(currentRight => isSameOrAfterMonth(n, currentRight) ? addMonths(currentRight, 1) : currentRight)
      return n
    }),
  }), [])

  const rightNav = useMemo(() => ({
    onPrev: () => setRightMonth(currentRight => {
      const n = addMonths(currentRight, -1)
      setLeftMonth(currentLeft => (isSameMonth(n, currentLeft) || !isSameOrAfterMonth(n, currentLeft)) ? addMonths(currentLeft, -1) : currentLeft)
      return n
    }),
    onNext: () => setRightMonth(p => addMonths(p, 1)),
  }), [])

  const displayValue = useMemo(() => {
    const r = (range?.from && range?.to)
      ? range
      : (effectiveStart && effectiveEnd ? { from: effectiveStart, to: effectiveEnd } : null)
    if (!r?.from || !r?.to) return ''
    return formatRange(r.from, r.to)
  }, [range, effectiveStart, effectiveEnd])

  const activePresetLabel = useMemo(() => {
    const from = range?.from ?? effectiveStart
    const to   = range?.to ?? effectiveEnd
    if (!from || !to) return null
    return resolvedPresets.find(p =>
      format(p.startDate, 'yyyy-MM-dd') === format(from, 'yyyy-MM-dd') &&
      format(p.endDate,   'yyyy-MM-dd') === format(to,   'yyyy-MM-dd')
    )?.label ?? null
  }, [range, effectiveStart, effectiveEnd, resolvedPresets])

  const handlePreset = useCallback((preset: DateRangePreset) => {
    setRange({ from: preset.startDate, to: preset.endDate })
    setIsOpen(false)
    onChange?.({ startDate: preset.startDate, endDate: preset.endDate })
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setRange(undefined)
    onChange?.({ startDate: null, endDate: null })
  }, [onChange])

  const dayClass = cn(buttonVariants({ variant: 'ghost' }), 'h-9 w-9 p-0 font-normal')
  return (
    <div className={cn('w-fit flex flex-col gap-1.5', className, classNames.root)}>
      {/* Inner relative wrapper: trigger button + absolute icons + boxBelow error */}
      <div className="relative">
        <Popover open={isOpen} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? `${name}-range-error` : undefined}
              className={cn(
                'relative h-9 flex items-center gap-2 text-sm rounded-lg min-w-[240px] cursor-pointer',
                'border border-input bg-background px-3 pr-10 text-left',
                'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                'disabled:cursor-not-allowed disabled:opacity-50',
                error && 'border-destructive focus-visible:ring-destructive/20',
                errorVariant === 'boxBelow' && error && 'rounded-b-none border-b-0',
                !displayValue && 'text-muted-foreground',
                classNames.trigger,
              )}
            >
              <span className={cn('truncate flex-1', classNames.triggerText)}>
                {displayValue || ph}
              </span>
            </button>
          </PopoverTrigger>

          {/* Icons outside the trigger button to prevent click event conflicts */}
          <div className="pointer-events-none absolute right-2 top-[18px] -translate-y-1/2 flex items-center gap-1">
            {showClearButton && displayValue && !disabled && (
              <button
                type="button"
                className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
                onMouseDown={e => e.preventDefault()}
                onClick={handleClear}
              >
                <X className={cn('h-4 w-4', classNames.clearButton)} />
              </button>
            )}
            {!displayValue && (
              <CalendarIcon className={cn('h-4 w-4 text-muted-foreground', classNames.icon)} />
            )}
          </div>

          <PopoverContent className={cn('w-auto p-0', classNames.content)} align="start" sideOffset={4}>
            <div className="flex flex-row">
              {showPresets && (
                <div className={cn('border-r border-border p-2 w-[128px] shrink-0', classNames.presetsPanel)}>
                  <div className="flex flex-col gap-0.5">
                    {resolvedPresets.map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handlePreset(p)}
                        className={cn(
                          'w-full text-left px-2 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap',
                          activePresetLabel === p.label
                            ? 'bg-primary/10 text-primary'
                            : 'text-primary hover:bg-muted',
                          classNames.presetButton,
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={cn('p-3 flex flex-row gap-4', classNames.calendarsPanel)}>
                <RangeCaptionNavCtx.Provider value={leftNav}>
                  <Calendar
                    mode="range"
                    selected={calendarRange}
                    onDayClick={handleDayClick}
                    onDayMouseEnter={handleDayMouseEnter}
                    month={leftMonth}
                    onMonthChange={setLeftMonth}
                    numberOfMonths={1}
                    showOutsideDays
                    fixedWeeks
                    className="p-0"
                    classNames={{ ...RANGE_CALENDAR_CLASSNAMES, day: dayClass }}
                    components={{ Caption: RangeCaption }}
                  />
                </RangeCaptionNavCtx.Provider>

                <RangeCaptionNavCtx.Provider value={rightNav}>
                  <Calendar
                    mode="range"
                    selected={calendarRange}
                    onDayClick={handleDayClick}
                    onDayMouseEnter={handleDayMouseEnter}
                    month={rightMonth}
                    onMonthChange={setRightMonth}
                    numberOfMonths={1}
                    showOutsideDays
                    fixedWeeks
                    className="p-0"
                    classNames={{ ...RANGE_CALENDAR_CLASSNAMES, day: dayClass }}
                    components={{ Caption: RangeCaption }}
                  />
                </RangeCaptionNavCtx.Provider>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* boxBelow: error box attached to the bottom of the trigger */}
        <AnimatePresence initial={false}>
          {errorVariant === 'boxBelow' && error && (
            <motion.div
              id={`${name}-range-error`}
              role="alert"
              key="box-error"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  'text-sm text-destructive',
                  'border border-destructive rounded-b-lg px-2.5 py-2 bg-destructive/5',
                  classNames.error,
                )}
              >
                {error.message}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* default: error text slides in below */}
      <AnimatePresence initial={false}>
        {errorVariant === 'default' && error && (
          <motion.p
            id={`${name}-range-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn('text-sm text-destructive', classNames.error)}
          >
            {error.message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- ElementRangeDatePicker ---------------------------------------------------
/**
 * Date range picker that works in two modes:
 *
 * **Form mode** — enabled when both `startName` + `endName` are provided and a
 * <FormProvider> ancestor exists (or an explicit `control` prop is passed). Each
 * date is stored as a 'yyyy-MM-dd' string in the form state.
 *
 * **Standalone mode** — pass `startDate` / `endDate` / `onChange` directly.
 */
export function ElementRangeDatePicker({
  startName,
  endName,
  control: controlProp,
  startDate: startDateProp,
  endDate: endDateProp,
  onChange: onChangeProp,
  ...rest
}: ElementRangeDatePickerProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control
  const isFormMode = !!(startName && endName && effectiveControl)

  if (isFormMode) {
    return (
      <Controller
        name={startName!}
        control={effectiveControl}
        render={({ field: startField, fieldState: { error: startError } }) => (
          <Controller
            name={endName!}
            control={effectiveControl}
            render={({ field: endField, fieldState: { error: endError } }) => (
              <RangeDatePickerCore
                {...rest}
                startDate={startField.value || null}
                endDate={endField.value || null}
                error={startError ?? endError}
                onChange={({ startDate, endDate }) => {
                  startField.onChange(startDate ? dateToYMD(startDate) : '')
                  endField.onChange(endDate ? dateToYMD(endDate) : '')
                  onChangeProp?.({ startDate, endDate })
                }}
              />
            )}
          />
        )}
      />
    )
  }

  return (
    <RangeDatePickerCore
      {...rest}
      startDate={startDateProp}
      endDate={endDateProp}
      onChange={onChangeProp}
    />
  )
}
