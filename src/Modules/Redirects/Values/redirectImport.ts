/**
 * CSV import/export for the redirect table — the pure half.
 *
 * Nothing here touches the database. The import route pairs this with
 * `findLiveConflict` (which needs one) and then writes every survivor through
 * `upsertRedirectWithFlattening`, so each row still gets the chain flattening,
 * loop deletion, and cache invalidation that every other redirect write gets.
 *
 * **This file does not reimplement chain flattening.** It cannot: flattening
 * is defined against the rows already in the table, and that is
 * `upsertRedirectWithFlattening`'s job. What it adds is the one thing that
 * function cannot see — a cycle contained entirely within a single CSV.
 *
 * Why that matters concretely. Import `A→B` then `B→A` row by row and the
 * writer does not loop or throw; it flattens `A→B` into `A→A` while writing
 * `B→A`, deletes it as a self-redirect, and leaves one row. The admin sees
 * "2 imported" and one of them is gone. Silent partial loss is worse than a
 * refusal, so the batch is validated as a graph before anything is written.
 */

export interface RedirectImportRow {
  /** 1-based row number in the uploaded file, for the report. */
  lineNumber: number
  fromPath: string
  toPath: string
  statusCode: number
  isAutomatic: boolean
}

export interface RedirectImportRejection {
  lineNumber: number
  fromPath: string
  toPath: string
  reason: string
}

export interface RedirectImportReport {
  /** Rows that passed every pure check, in file order. */
  valid: RedirectImportRow[]
  rejected: RedirectImportRejection[]
  /** Data rows seen, excluding the header and blank lines. */
  totalRows: number
}

export const REDIRECT_CSV_HEADER = "fromPath,toPath,statusCode,isAutomatic,createdAt"

/** Same shape the manual create form accepts — resolution only happens inside
 *  the blog routes' not-found branches, so a redirect for anything outside
 *  /blog/ would silently never fire. */
const FROM_PATH_PATTERN = /^\/blog\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/
const TO_PATH_PATTERN = /^(\/[a-z0-9-/]*|https?:\/\/.+)$/i

const ALLOWED_STATUS_CODES = new Set([301, 302])

/** A file big enough to be a mistake. 5 000 redirects is already an unusual
 *  site; 50 000 in one paste is someone pasting the wrong thing. */
const MAX_ROWS = 5000

/**
 * Minimal RFC 4180 reader — quoted fields, doubled quotes, CRLF or LF.
 *
 * Hand-rolled rather than adding a parser dependency: this is the entire
 * grammar the export side emits, and a dependency is forever.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let hasContent = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      hasContent = true
      continue
    }

    if (char === '"') {
      inQuotes = true
      hasContent = true
    } else if (char === ",") {
      row.push(field)
      field = ""
      hasContent = true
    } else if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      hasContent = false
    } else if (char !== "\r") {
      field += char
      hasContent = true
    }
  }

  if (hasContent || field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function looksLikeHeader(cells: string[]): boolean {
  return cells[0]?.trim().toLowerCase() === "frompath"
}

/**
 * Detects cycles among the rows themselves.
 *
 * Only edges whose target is also a source in this batch can close a cycle —
 * an edge pointing out of the batch terminates. Standard three-colour DFS;
 * every node on a back edge's cycle is marked, and the route rejects all of
 * them rather than guessing which one the admin meant to keep.
 */
function findCyclicPaths(edges: Map<string, string>): Set<string> {
  const cyclic = new Set<string>()
  const state = new Map<string, "visiting" | "done">()

  for (const start of edges.keys()) {
    if (state.get(start) === "done") continue

    // Iterative walk with an explicit stack — a deeply chained CSV should not
    // be able to blow the call stack.
    const trail: string[] = []
    const onTrail = new Set<string>()
    let node: string | undefined = start

    while (node !== undefined) {
      if (onTrail.has(node)) {
        // Back edge: everything from the first sighting onward is the cycle.
        const from = trail.indexOf(node)
        for (const member of trail.slice(from)) cyclic.add(member)
        break
      }
      if (state.get(node) === "done") break

      state.set(node, "visiting")
      trail.push(node)
      onTrail.add(node)

      node = edges.get(node)
    }

    for (const member of trail) state.set(member, "done")
  }

  return cyclic
}

/**
 * Validates a CSV as a batch. Pure — the caller still has to check each
 * survivor against live content and write it through
 * `upsertRedirectWithFlattening`.
 */
export function parseRedirectCsv(csv: string): RedirectImportReport {
  const rejected: RedirectImportRejection[] = []
  const candidates: RedirectImportRow[] = []

  const rows = parseCsv(csv ?? "")
  const dataRows = rows.length > 0 && looksLikeHeader(rows[0]) ? rows.slice(1) : rows
  const headerOffset = dataRows.length === rows.length ? 1 : 2

  let totalRows = 0
  const seenFromPaths = new Map<string, number>()

  dataRows.forEach((cells, index) => {
    const lineNumber = index + headerOffset
    if (cells.every((cell) => cell.trim() === "")) return
    totalRows += 1

    const fromPath = (cells[0] ?? "").trim()
    const toPath = (cells[1] ?? "").trim()
    const rawStatus = (cells[2] ?? "").trim()
    const rawAutomatic = (cells[3] ?? "").trim().toLowerCase()

    const reject = (reason: string) => rejected.push({ lineNumber, fromPath, toPath, reason })

    if (totalRows > MAX_ROWS) {
      reject(`File exceeds the ${MAX_ROWS}-row import limit.`)
      return
    }
    if (!fromPath || !toPath) {
      reject("Both fromPath and toPath are required.")
      return
    }
    if (!fromPath.startsWith("/")) {
      reject("fromPath must start with /.")
      return
    }
    if (!FROM_PATH_PATTERN.test(fromPath)) {
      reject("fromPath must be a /blog/... path (lowercase letters, numbers, hyphens).")
      return
    }
    if (!TO_PATH_PATTERN.test(toPath)) {
      reject("toPath must be a path starting with / or a full https:// URL.")
      return
    }
    if (fromPath === toPath) {
      reject("A path can't redirect to itself.")
      return
    }

    const statusCode = rawStatus === "" ? 301 : Number(rawStatus)
    if (!ALLOWED_STATUS_CODES.has(statusCode)) {
      reject("statusCode must be 301 or 302.")
      return
    }

    const firstSeen = seenFromPaths.get(fromPath)
    if (firstSeen !== undefined) {
      reject(`Duplicate fromPath — already defined on line ${firstSeen}.`)
      return
    }
    seenFromPaths.set(fromPath, lineNumber)

    candidates.push({
      lineNumber,
      fromPath,
      toPath,
      statusCode,
      isAutomatic: rawAutomatic === "true" || rawAutomatic === "1",
    })
  })

  // Graph pass, after per-row validation so a cycle report never includes a
  // row that was already rejected for a simpler reason.
  const edges = new Map(candidates.map((row) => [row.fromPath, row.toPath]))
  const cyclic = findCyclicPaths(edges)

  const valid: RedirectImportRow[] = []
  for (const row of candidates) {
    if (cyclic.has(row.fromPath)) {
      rejected.push({
        lineNumber: row.lineNumber,
        fromPath: row.fromPath,
        toPath: row.toPath,
        reason: "Part of a redirect loop inside this file.",
      })
      continue
    }
    valid.push(row)
  }

  rejected.sort((a, b) => a.lineNumber - b.lineNumber)

  return { valid, rejected, totalRows }
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The export side. Same column order the importer reads, so a file exported
 *  from one install imports into another with no editing. */
export function buildRedirectCsv(
  rows: {
    fromPath: string
    toPath: string
    statusCode: number
    isAutomatic: boolean
    createdAt: Date | string | null
  }[]
): string {
  const lines = [REDIRECT_CSV_HEADER]

  for (const row of rows) {
    const createdAt =
      row.createdAt instanceof Date ? row.createdAt.toISOString() : (row.createdAt ?? "")
    lines.push(
      [
        escapeCsvCell(row.fromPath),
        escapeCsvCell(row.toPath),
        String(row.statusCode),
        String(row.isAutomatic),
        escapeCsvCell(createdAt),
      ].join(",")
    )
  }

  // Trailing newline: without one, some spreadsheet tools drop the last row.
  return `${lines.join("\n")}\n`
}
