"use client"

import * as React from "react"
import { useState, useCallback, useMemo, useRef, useEffect } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import type { ClassValue } from "clsx"
import { Check, ChevronDown, X, Loader2, ExternalLink, Plus } from "lucide-react"
import { Controller, useFormContext } from "react-hook-form"
import type {
  Control,
  UseFormReturn,
  FieldValues,
  RegisterOptions,
  FieldError,
} from "react-hook-form"
import { AnimatePresence, motion } from "framer-motion"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Dialog, DialogContent, DialogCloseButton, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import BAPI from "@/Framework/API_Layer"
import ElementLabelHint from "@/components/shared/ElementLabelHint/ElementLabelHint"

// --- Public Types -------------------------------------------------------------

export type SelectItem = {
  label: string
  value: string
  icon?: React.ReactNode
  /** Fully custom item renderer — replaces label + icon when set. */
  element?: React.ReactNode
  /** Auto-groups items by this key when present. */
  group?: string
  /** When set: click opens new tab, selection does NOT fire. */
  href?: string
  disabled?: boolean
  [key: string]: unknown
}

export type ServerFetchConfig = {
  url: string
  method?: "GET" | "POST"
  params?: Record<string, unknown>
  /** Query param name sent with the search string. Default: 'q' */
  searchParam?: string
  /** Debounce delay in ms. Default: 300 */
  debounceMs?: number
  keyMap: {
    label: string
    value: string
    group?: string
    /** When mapped: clicking that item opens the URL in a new tab. */
    href?: string
  }
  headers?: Record<string, string>
}

export type MultipleDisplayMode = "inside" | "below"
export type ErrorVariant = "default" | "boxBelow"
export type ElementSelectVariant = "default" | "outline" | "ghost" | "filled"

export interface ElementSelectClassNames {
  root?: ClassValue
  label?: ClassValue
  requiredMark?: ClassValue
  inputGroupWrapper?: ClassValue
  inputGroupPrefix?: ClassValue
  inputGroupSuffix?: ClassValue
  trigger?: ClassValue
  triggerIcon?: ClassValue
  content?: ClassValue
  search?: ClassValue
  list?: ClassValue
  empty?: ClassValue
  loadingSpinner?: ClassValue
  groupLabel?: ClassValue
  separator?: ClassValue
  item?: ClassValue
  itemIcon?: ClassValue
  itemCheck?: ClassValue
  chip?: ClassValue
  chipRemove?: ClassValue
  badgeWrapper?: ClassValue
  badge?: ClassValue
  badgeRemove?: ClassValue
  clearButton?: ClassValue
  error?: ClassValue
}

export interface ElementSelectProps {
  // -- Form ------------------------------------------------------------------
  name: string
  control?: Control<FieldValues>
  rules?: RegisterOptions
  defaultValue?: string | string[]

  // -- Data ------------------------------------------------------------------
  items?: SelectItem[] | string[]
  groups?: Record<string, SelectItem[]>
  /** When provided, ignores `items` and fetches from the server. */
  serverFetch?: ServerFetchConfig

  // -- Basic -----------------------------------------------------------------
  label?: string
  /** Short description revealed by an info icon next to the label. */
  hint?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean

  // -- Behaviour -------------------------------------------------------------
  multiple?: boolean
  /** How selected values are shown in multiple mode. Default: 'inside' */
  multipleDisplay?: MultipleDisplayMode
  /** Auto-enabled when serverFetch is set. */
  searchable?: boolean
  clearable?: boolean
  creatable?: boolean
  /** Max chips shown in trigger before "+N more". */
  maxDisplayed?: number

  // -- Display ---------------------------------------------------------------
  variant?: ElementSelectVariant
  size?: "sm" | "md" | "lg"
  /** Icon rendered left of the placeholder / value in the trigger. */
  icon?: React.ReactNode
  /** Input-group prefix element (rendered left of the trigger). */
  prefix?: React.ReactNode
  /** Input-group suffix element (rendered right of the trigger). */
  suffix?: React.ReactNode

  // -- Display ---------------------------------------------------------------
  /**
   * When true, the selected item's icon (from items array) is shown in the
   * trigger instead of the static `icon` prop. Falls back to `icon` when
   * nothing is selected or the selected item has no icon.
   */
  showSelectedIcon?: boolean

  // -- Popup mode ------------------------------------------------------------
  popupMode?: boolean
  popupTitle?: string
  /** Allow closing the dialog by clicking outside. Default: true */
  closeOnOutsideClick?: boolean

  // -- Error -----------------------------------------------------------------
  /** 'default' = text animates below | 'boxBelow' = bordered box attached to trigger. */
  errorVariant?: ErrorVariant

  // -- Styling ---------------------------------------------------------------
  className?: string
  classNames?: ElementSelectClassNames

  // -- Standalone controlled value -------------------------------------------
  /** Current value for standalone (uncontrolled-by-form) usage. */
  value?: string | string[]

  // -- Text overrides --------------------------------------------------------
  emptyMessage?: string
  loadingMessage?: string
  searchPlaceholder?: string

  // -- Events ----------------------------------------------------------------
  onValueChange?: (value: string | string[]) => void
  onSearchChange?: (query: string) => void
  onOpen?: () => void
  onClose?: () => void
}

// --- CVA ----------------------------------------------------------------------

const triggerVariants = cva(
  [
    "flex w-full items-center justify-between gap-2 rounded-lg border bg-background",
    "text-sm transition-colors shadow-xs",
    "focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-input",
        outline: "border-2 border-input",
        ghost: "border-transparent hover:bg-muted",
        filled: "border-transparent bg-muted hover:bg-muted/80",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-3",
        lg: "h-11 px-4 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

// --- Helpers ------------------------------------------------------------------

function normalizeStringItems(items: SelectItem[] | string[]): SelectItem[] {
  if (!items.length) return []
  if (typeof items[0] === "string") {
    return (items as string[]).map((s) => ({ label: s, value: s }))
  }
  return items as SelectItem[]
}

type GroupedSection = { group?: string; items: SelectItem[] }

function buildGroupedSections(
  items?: SelectItem[] | string[],
  groupsProp?: Record<string, SelectItem[]>
): GroupedSection[] {
  if (groupsProp) {
    return Object.entries(groupsProp).map(([group, grpItems]) => ({ group, items: grpItems }))
  }
  if (!items?.length) return [{ items: [] }]

  const normalized = normalizeStringItems(items)

  if (normalized.some((i) => i.group)) {
    const map: Record<string, SelectItem[]> = {}
    const ungrouped: SelectItem[] = []
    for (const item of normalized) {
      if (item.group) {
        if (!map[item.group]) map[item.group] = []
        map[item.group].push(item)
      } else {
        ungrouped.push(item)
      }
    }
    const result: GroupedSection[] = []
    if (ungrouped.length) result.push({ items: ungrouped })
    Object.entries(map).forEach(([group, grpItems]) => result.push({ group, items: grpItems }))
    return result
  }

  return [{ items: normalized }]
}

/**
 * Auto-detects a results array anywhere in an API response object.
 * Recurses a few levels deep so paginated wrappers work too — e.g. this app's own
 * APIs return `{ data: { data: [...], current_page, per_page, total }, message }`,
 * where the array is two levels down, not directly under the top-level `data` key.
 */
function extractArrayDeep(data: unknown, depth: number): unknown[] | null {
  if (Array.isArray(data)) return data
  if (depth <= 0 || !data || typeof data !== "object") return null
  const obj = data as Record<string, unknown>
  for (const key of ["data", "items", "results", "list", "records"]) {
    if (key in obj) {
      const nested = extractArrayDeep(obj[key], depth - 1)
      if (nested !== null) return nested
    }
  }
  for (const val of Object.values(obj)) {
    const nested = extractArrayDeep(val, depth - 1)
    if (nested !== null) return nested
  }
  return null
}

function extractArray(data: unknown): unknown[] {
  return extractArrayDeep(data, 3) ?? []
}

function filterSections(
  sections: GroupedSection[],
  search: string
): GroupedSection[] {
  if (!search.trim()) return sections
  const q = search.toLowerCase()
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => i.label.toLowerCase().includes(q)),
    }))
    .filter((s) => s.items.length > 0)
}

// --- Core internal props (resolved from form or standalone) --------------------

interface SelectCoreProps
  extends Omit<ElementSelectProps, "control" | "rules" | "defaultValue" | "name"> {
  name?: string
  value: string | string[]
  onChange: (value: string | string[]) => void
  onBlur?: () => void
  error?: FieldError
}

// --- SelectCore — all rendering lives here ------------------------------------

function SelectCore({
  name,
  value,
  onChange,
  onBlur,
  error,

  items,
  groups,
  serverFetch,

  label,
  hint,
  placeholder,
  disabled = false,
  required = false,

  multiple = false,
  multipleDisplay = "inside",
  searchable,
  clearable = false,
  creatable = false,
  maxDisplayed,

  variant = "default",
  size = "md",
  icon,
  showSelectedIcon = false,
  prefix,
  suffix,

  popupMode = false,
  popupTitle,
  closeOnOutsideClick = true,

  errorVariant = "default",

  className,
  classNames = {},

  emptyMessage = "No results found.",
  loadingMessage = "Loading...",
  searchPlaceholder = "Search...",

  onValueChange,
  onSearchChange,
  onOpen,
  onClose,
}: SelectCoreProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [serverItems, setServerItems] = useState<SelectItem[]>([])
  const [loading, setLoading] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const isSearchable = searchable ?? !!serverFetch
  const hasServerFetch = !!serverFetch

  // -- Derive local section data --------------------------------------------
  const localSections = useMemo(
    () => buildGroupedSections(hasServerFetch ? undefined : items, hasServerFetch ? undefined : groups),
    [items, groups, hasServerFetch]
  )

  const serverSections = useMemo<GroupedSection[]>(
    () => (serverItems.length ? [{ items: serverItems }] : []),
    [serverItems]
  )

  const baseSections = hasServerFetch ? serverSections : localSections

  const displayedSections = useMemo(
    () => (isSearchable && !hasServerFetch ? filterSections(baseSections, search) : baseSections),
    [baseSections, isSearchable, hasServerFetch, search]
  )

  /** Flat list of all selectable items, for keyboard navigation. */
  const flatItems = useMemo(
    () => displayedSections.flatMap((s) => s.items),
    [displayedSections]
  )

  const totalVisible = flatItems.length

  // -- Value helpers --------------------------------------------------------
  const selectedValues: string[] = useMemo(
    () =>
      multiple
        ? Array.isArray(value)
          ? value
          : []
        : value
          ? [value as string]
          : [],
    [multiple, value]
  )

  const hasValue = selectedValues.length > 0

  /** All items from local + server (for label lookup). */
  const allItems = useMemo(
    () => [...localSections, ...serverSections].flatMap((s) => s.items),
    [localSections, serverSections]
  )

  function getLabelForValue(v: string): string {
    return allItems.find((i) => i.value === v)?.label ?? v
  }

  function isSelected(v: string): boolean {
    return selectedValues.includes(v)
  }

  // -- Server fetch ---------------------------------------------------------
  const fetchFromServer = useCallback(
    async (query: string) => {
      if (!serverFetch) return
      setLoading(true)
      try {
        const param = serverFetch.searchParam ?? "q"
        const reqParams = { ...serverFetch.params, [param]: query }

        const result =
          serverFetch.method === "POST"
            ? await BAPI.post(serverFetch.url, reqParams)
            : await BAPI.get(serverFetch.url, { params: reqParams })

        const arr = extractArray(result)
        const { keyMap } = serverFetch
        setServerItems(
          arr.map((raw) => {
            const r = raw as Record<string, unknown>
            return {
              label: String(r[keyMap.label] ?? ""),
              value: String(r[keyMap.value] ?? ""),
              group: keyMap.group ? String(r[keyMap.group] ?? "") : undefined,
              href: keyMap.href ? String(r[keyMap.href] ?? "") : undefined,
            }
          })
        )
      } catch {
        // errors are silent here
      } finally {
        setLoading(false)
      }
    },
    [serverFetch]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // -- Open / close ---------------------------------------------------------
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next)
      setFocusedIndex(-1)
      if (next) {
        setSearch("")
        onOpen?.()
        if (hasServerFetch) fetchFromServer("")
        setTimeout(() => searchRef.current?.focus(), 50)
      } else {
        onClose?.()
        onBlur?.()
      }
    },
    [onOpen, onClose, onBlur, hasServerFetch, fetchFromServer]
  )

  // -- Search ---------------------------------------------------------------
  const handleSearchChange = useCallback(
    (query: string) => {
      setSearch(query)
      setFocusedIndex(-1)
      onSearchChange?.(query)

      if (!hasServerFetch) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(
        () => fetchFromServer(query),
        serverFetch?.debounceMs ?? 300
      )
    },
    [hasServerFetch, serverFetch?.debounceMs, fetchFromServer, onSearchChange]
  )

  // -- Select an item -------------------------------------------------------
  const handleSelectItem = useCallback(
    (item: SelectItem) => {
      if (item.href) {
        window.open(item.href, "_blank", "noopener,noreferrer")
        return
      }
      if (item.disabled) return

      let next: string | string[]
      if (multiple) {
        const current = Array.isArray(value) ? value : []
        next = isSelected(item.value)
          ? current.filter((v) => v !== item.value)
          : [...current, item.value]
      } else {
        next = item.value
        setOpen(false)
      }

      onChange(next)
      onValueChange?.(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [multiple, value, onChange, onValueChange]
  )

  // -- Clear all ------------------------------------------------------------
  const handleClear = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
      const next: string | string[] = multiple ? [] : ""
      onChange(next)
      onValueChange?.(next)
    },
    [multiple, onChange, onValueChange]
  )

  // -- Remove one chip (multiple mode) --------------------------------------
  const handleRemoveValue = useCallback(
    (v: string, e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
      const next = selectedValues.filter((sv) => sv !== v)
      onChange(next)
      onValueChange?.(next)
    },
    [selectedValues, onChange, onValueChange]
  )

  // -- Keyboard navigation ---------------------------------------------------
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          handleOpenChange(true)
        }
        return
      }

      if (e.key === "Escape") {
        e.preventDefault()
        handleOpenChange(false)
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setFocusedIndex((i) => {
          const next = i < totalVisible - 1 ? i + 1 : 0
          scrollItemIntoView(next)
          return next
        })
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setFocusedIndex((i) => {
          const next = i > 0 ? i - 1 : totalVisible - 1
          scrollItemIntoView(next)
          return next
        })
        return
      }

      if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < flatItems.length) {
        e.preventDefault()
        handleSelectItem(flatItems[focusedIndex])
      }
    },
    [open, handleOpenChange, totalVisible, flatItems, focusedIndex, handleSelectItem]
  )

  function scrollItemIntoView(index: number) {
    const el = listRef.current?.querySelector(`[data-option-index="${index}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }

  // -- Creatable -------------------------------------------------------------
  const showCreateOption =
    creatable &&
    search.trim() &&
    !flatItems.some((i) => i.label.toLowerCase() === search.trim().toLowerCase())

  // -- Trigger content -------------------------------------------------------
  const showInsideChips = multiple && multipleDisplay === "inside"
  const displayedChips = showInsideChips
    ? maxDisplayed
      ? selectedValues.slice(0, maxDisplayed)
      : selectedValues
    : []
  const extraChipCount =
    showInsideChips && maxDisplayed ? Math.max(0, selectedValues.length - maxDisplayed) : 0

  const singleLabel = !multiple && value ? getLabelForValue(value as string) : null
  const hasError = !!error

  // When showSelectedIcon is true, swap to the selected item's icon
  const effectiveIcon = useMemo(() => {
    if (!showSelectedIcon || multiple) return icon
    const selectedVal = !multiple ? (value as string) : null
    if (!selectedVal) return icon
    return allItems.find((i) => i.value === selectedVal)?.icon ?? icon
  }, [showSelectedIcon, multiple, value, allItems, icon])

  const triggerCls = cn(
    triggerVariants({ variant, size }),
    hasError && "border-destructive focus-visible:ring-destructive/20",
    hasError && errorVariant === "boxBelow" && "rounded-b-none border-b-0",
    showInsideChips && selectedValues.length > 0 && "h-auto min-h-9 flex-wrap py-1.5",
    classNames.trigger
  )

  // --- List content (shared between Popover and Dialog) ---------------------
  const listContent = (
    <div className="flex flex-col">
      {isSearchable && (
        <div className="px-2 pt-2 pb-1">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className={cn(
              "h-8 w-full rounded-md border border-input bg-background px-3 text-sm",
              "outline-none focus:border-ring transition-colors",
              classNames.search
            )}
          />
        </div>
      )}

      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable={multiple}
        onWheel={(e) => e.stopPropagation()}
        className={cn("max-h-60 overflow-y-auto py-1", classNames.list)}
      >
        {loading && (
          <div className={cn("flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground", classNames.loadingSpinner)}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingMessage}
          </div>
        )}

        {!loading && displayedSections.length === 0 && !showCreateOption && (
          <p className={cn("py-4 text-center text-sm text-muted-foreground", classNames.empty)}>
            {emptyMessage}
          </p>
        )}

        {!loading &&
          displayedSections.map((section, sIdx) => (
            <React.Fragment key={section.group ?? `section-${sIdx}`}>
              {section.group && (
                <>
                  {sIdx > 0 && (
                    <div className={cn("mx-2 my-1 h-px bg-border", classNames.separator)} />
                  )}
                  <p
                    className={cn(
                      "px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide",
                      classNames.groupLabel
                    )}
                  >
                    {section.group}
                  </p>
                </>
              )}

              {section.items.map((item) => {
                const flatIdx = flatItems.indexOf(item)
                const selected = isSelected(item.value)
                const focused = focusedIndex === flatIdx

                return item.href ? (
                  <a
                    key={item.value}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-option-index={flatIdx}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      focused && "bg-accent text-accent-foreground",
                      item.disabled && "pointer-events-none opacity-50",
                      classNames.item
                    )}
                  >
                    <span className="w-4 shrink-0" />
                    {item.icon && (
                      <span className={cn("shrink-0", classNames.itemIcon)}>{item.icon}</span>
                    )}
                    {item.element ?? <span className="flex-1 truncate">{item.label}</span>}
                    <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
                  </a>
                ) : (
                  <div
                    key={item.value}
                    role="option"
                    aria-selected={selected}
                    data-option-index={flatIdx}
                    onClick={() => handleSelectItem(item)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-sm rounded-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      selected && "bg-accent/50",
                      focused && "bg-accent text-accent-foreground",
                      item.disabled && "pointer-events-none opacity-50 cursor-not-allowed",
                      classNames.item
                    )}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0 transition-opacity",
                        selected ? "opacity-100" : "opacity-0",
                        classNames.itemCheck
                      )}
                    />
                    {item.icon && (
                      <span className={cn("shrink-0", classNames.itemIcon)}>{item.icon}</span>
                    )}
                    {item.element ?? <span className="flex-1 truncate">{item.label}</span>}
                  </div>
                )
              })}
            </React.Fragment>
          ))}

        {!loading && showCreateOption && (
          <div
            role="option"
            onClick={() => {
              handleSelectItem({ label: search.trim(), value: search.trim() })
              setSearch("")
            }}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-sm rounded-sm",
              "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
              classNames.item
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>
              Create <strong className="text-foreground">&quot;{search.trim()}&quot;</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  )

  // --- Trigger button -------------------------------------------------------
  const triggerButton = (
    <button
      type="button"
      id={name}
      disabled={disabled}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-invalid={hasError}
      aria-describedby={hasError ? `${name}-error` : undefined}
      onKeyDown={!isSearchable ? handleKeyDown : undefined}
      onClick={popupMode ? () => handleOpenChange(true) : undefined}
      className={triggerCls}
    >
      {effectiveIcon && (
        <span className={cn("shrink-0 text-muted-foreground", classNames.triggerIcon)}>{effectiveIcon}</span>
      )}

      {/* Inside chips (multiple + inside mode) */}
      {showInsideChips && selectedValues.length > 0 ? (
        <span className="flex flex-1 flex-wrap gap-1">
          {displayedChips.map((v) => (
            <span
              key={v}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-xs font-medium",
                classNames.chip
              )}
            >
              {getLabelForValue(v)}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleRemoveValue(v, e)}
                onKeyDown={(e) => e.key === "Enter" && handleRemoveValue(v, e)}
                className={cn(
                  "rounded-full p-0.5 hover:bg-muted-foreground/20 cursor-pointer transition-colors",
                  classNames.chipRemove
                )}
              >
                <X className="h-2.5 w-2.5" />
              </span>
            </span>
          ))}
          {extraChipCount > 0 && (
            <span className={cn("inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs", classNames.chip)}>
              +{extraChipCount} more
            </span>
          )}
        </span>
      ) : (
        <span
          className={cn(
            "flex-1 truncate text-start",
            !singleLabel && !(multiple && multipleDisplay === "below" && hasValue) && "text-muted-foreground"
          )}
        >
          {singleLabel ??
            (multiple && multipleDisplay === "below" && selectedValues.length > 0
              ? `${selectedValues.length} selected`
              : placeholder ?? "Select...")}
        </span>
      )}

      <span className="ms-auto flex shrink-0 items-center gap-1">
        {clearable && hasValue && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => e.key === "Enter" && handleClear(e)}
            className={cn(
              "rounded-full p-0.5 hover:bg-muted transition-colors cursor-pointer",
              classNames.clearButton
            )}
          >
            <X className="h-3.5 w-3.5 opacity-50" />
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 opacity-50 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </span>
    </button>
  )

  // --- boxBelow error (inside the trigger wrapper) --------------------------
  const boxBelowError = (
    <AnimatePresence initial={false}>
      {errorVariant === "boxBelow" && hasError && (
        <motion.div
          id={`${name}-error`}
          role="alert"
          key="box-error"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "text-sm text-destructive",
              "border border-destructive rounded-b-lg px-2.5 py-2 bg-destructive/5",
              classNames.error
            )}
          >
            {error?.message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  // --- Render ----------------------------------------------------------------
  return (
    <div className={cn("flex flex-col gap-1.5", className, classNames.root)}>
      {/* Label */}
      {label && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={name}
            className={cn(
              "text-sm font-medium leading-none",
              hasError ? "text-destructive" : "text-foreground",
              disabled && "opacity-50 cursor-not-allowed",
              classNames.label
            )}
          >
            {label}
            {required && (
              <span className={cn("text-destructive mx-0.5", classNames.requiredMark)}>*</span>
            )}
          </label>
          {hint && <ElementLabelHint id={`${name}-hint`} text={hint} />}
        </div>
      )}

      {/* Input-group wrapper with prefix / trigger / suffix */}
      <div className={cn("flex", classNames.inputGroupWrapper)}>
        {prefix && (
          <div
            className={cn(
              "flex items-center rounded-l-lg border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground",
              size === "sm" && "h-7 text-xs",
              size === "md" && "h-9",
              size === "lg" && "h-11 text-base",
              classNames.inputGroupPrefix
            )}
          >
            {prefix}
          </div>
        )}

        {/* Trigger area */}
        <div className={cn("relative flex-1", prefix && "[&>*]:rounded-l-none", suffix && "[&>*]:rounded-r-none")}>
          {popupMode ? (
            <>
              {/* Dialog mode: trigger button opens Dialog */}
              {triggerButton}
              {boxBelowError}
              <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent
                  className={cn("max-w-md p-0 gap-0", classNames.content)}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onInteractOutside={(e) => {
                    if (!closeOnOutsideClick) e.preventDefault()
                  }}
                >
                  <DialogCloseButton />
                  {popupTitle && (
                    <DialogHeader className={cn("px-4 pt-4", !popupTitle && "sr-only")}>
                      <DialogTitle>{popupTitle}</DialogTitle>
                    </DialogHeader>
                  )}
                  {listContent}
                </DialogContent>
              </Dialog>
            </>
          ) : (
            /* Popover mode (default) */
            <>
              <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
                <PopoverContent
                  className={cn("p-0", classNames.content)}
                  align="start"
                  sideOffset={4}
                  style={{ width: "var(--radix-popover-trigger-width)" }}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  {listContent}
                </PopoverContent>
              </Popover>
              {boxBelowError}
            </>
          )}
        </div>

        {suffix && (
          <div
            className={cn(
              "flex items-center rounded-r-lg border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground",
              size === "sm" && "h-7 text-xs",
              size === "md" && "h-9",
              size === "lg" && "h-11 text-base",
              classNames.inputGroupSuffix
            )}
          >
            {suffix}
          </div>
        )}
      </div>

      {/* Multiple below: removable badges rendered under the trigger */}
      <AnimatePresence initial={false}>
        {multiple && multipleDisplay === "below" && selectedValues.length > 0 && (
          <motion.div
            key="below-badges"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className={cn("flex flex-wrap gap-1.5", classNames.badgeWrapper)}
          >
            {selectedValues.map((v) => (
              <span
                key={v}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium",
                  classNames.badge
                )}
              >
                {getLabelForValue(v)}
                <button
                  type="button"
                  onClick={(e) => handleRemoveValue(v, e)}
                  className={cn(
                    "rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors",
                    classNames.badgeRemove
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* default error: text slides below */}
      <AnimatePresence initial={false}>
        {errorVariant === "default" && hasError && (
          <motion.p
            id={`${name}-error`}
            role="alert"
            key="default-error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn("text-sm text-destructive", classNames.error)}
          >
            {error?.message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// --- ElementSelect — public API with dual-mode form detection ------------------

/**
 * Unified select / combobox component.
 *
 * **Form mode** (auto-detected): wrap in `<FormProvider>` and pass `name`.
 * **Standalone mode**: pass `value` + `onValueChange` without a FormProvider.
 *
 * @example — form mode (no control prop needed)
 * ```tsx
 * <FormProvider {...methods}>
 *   <ElementSelect name="status" label="Status" items={STATUS_ITEMS} />
 * </FormProvider>
 * ```
 *
 * @example — standalone
 * ```tsx
 * <ElementSelect name="demo" items={ITEMS} onValueChange={(v) => console.log(v)} />
 * ```
 */
export default function ElementSelect({
  name,
  control: controlProp,
  rules,
  defaultValue,
  onValueChange,
  multiple,
  ...rest
}: ElementSelectProps) {
  const formCtx = useFormContext() as UseFormReturn | null
  const effectiveControl = controlProp ?? formCtx?.control

  if (name && effectiveControl) {
    return (
      <Controller
        name={name}
        control={effectiveControl}
        rules={rules}
        defaultValue={defaultValue ?? (multiple ? [] : "")}
        render={({ field, fieldState: { error } }) => (
          <SelectCore
            {...rest}
            name={name}
            multiple={multiple}
            value={field.value ?? (multiple ? [] : "")}
            onChange={(val) => {
              field.onChange(val)
              onValueChange?.(val)
            }}
            onBlur={field.onBlur}
            error={error}
          />
        )}
      />
    )
  }

  // Standalone mode
  return (
    <SelectCore
      {...rest}
      name={name}
      multiple={multiple}
      value={rest.value ?? (multiple ? [] : "") }
      onChange={(val) => {
        onValueChange?.(val)
      }}
    />
  )
}

export type { VariantProps }
export { triggerVariants }
