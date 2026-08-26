import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Tailwind-aware class merge.
 *
 * On the contract for convenience rather than safety: it is here so a theme
 * gets the same conflict resolution as the rest of the app without adding its
 * own copy of clsx and tailwind-merge. Those two ARE dependencies of the
 * published `flowcms` package for this reason — they are the only runtime
 * dependencies it has.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type { ClassValue }
