import { handle } from "./client"

/**
 * THE TABLE OBJECTS RUNTIME QUERIES MUST BE BUILT FROM.
 *
 * Every module that constructs a query imports its tables from HERE, never from
 * `@/db/schema/*`. `tests/architecture/runtimeSchemaBinding.test.ts` enforces
 * that, and the reason is a defect that reached production behaviour:
 *
 *   Drizzle takes a parameter's encoder from the COLUMN OBJECT the query was
 *   built with, not from the database instance executing it.
 *
 * So `db.insert(sqliteTable).values({ isIndexable: true })` against PostgreSQL
 * produces the right SQL text and the WRONG parameter — `SQLiteBoolean` encodes
 * `true` as `1`, and PostgreSQL stores `1` in a boolean column as **false**.
 * The statement succeeds, nothing warns, and the row is silently wrong. The
 * same applies to WHERE predicates, projections, joins and ordering, because
 * those embed column objects too.
 *
 * CANONICAL AUTHORING SCHEMA vs RUNTIME TABLE OBJECTS
 *
 * `src/db/schema/*.ts` remains the single place a table is DEFINED — one
 * definition, in SQLite, from which `deriveDialects.ts` produces the
 * PostgreSQL and MySQL equivalents. That is the authoring source, and it is
 * also what migrations, the derivation itself, and the parity tests read.
 *
 * This module is the RUNTIME source: the same tables, belonging to whichever
 * dialect is actually connected. The two are deliberately different objects
 * with the same shape, and conflating them is what caused the defect.
 *
 * TYPES ARE UNCHANGED. `handle.schema` is typed `AppSchema` — the canonical
 * SQLite schema's type — so every export below carries exactly the type it
 * carried when it was imported from `@/db/schema`. Inference, `$inferSelect`,
 * `$inferInsert` and column types are identical; only the runtime identity
 * moves. There is no cast here: the single boundary cast already lives in
 * `createDatabase.ts`, where it is documented.
 *
 * NON-TABLE EXPORTS STAY WHERE THEY ARE. `SETTINGS_SINGLETON_ID`,
 * `ACTIVITY_RETENTION_DAYS`, `REVISION_RETENTION` and `MENU_ITEM_TYPES` are
 * plain constants with no dialect, they are not part of the derived schema, and
 * reading them from here would return `undefined` on PostgreSQL. Import those
 * from `@/db/schema/*` as before.
 */
const t = handle.schema

export const users = t.users
export const accounts = t.accounts
export const sessions = t.sessions
export const verificationTokens = t.verificationTokens
export const authors = t.authors
export const blogCategories = t.blogCategories
export const blogTags = t.blogTags
export const blogPosts = t.blogPosts
export const blogPostCategories = t.blogPostCategories
export const blogPostTags = t.blogPostTags
export const blogPostFaqs = t.blogPostFaqs
export const blogPostRevisions = t.blogPostRevisions
export const blogPostLocks = t.blogPostLocks
export const blogSeries = t.blogSeries
export const blogPostRelated = t.blogPostRelated
export const blogPostQuestions = t.blogPostQuestions
export const businessReviews = t.businessReviews
export const notFoundLog = t.notFoundLog
export const linkCheckResults = t.linkCheckResults
export const redirects = t.redirects
export const settings = t.settings
export const activityLog = t.activityLog
export const searchConsoleIssues = t.searchConsoleIssues
export const customPages = t.customPages
export const menus = t.menus
export const menuItems = t.menuItems
export const themeSettings = t.themeSettings
