const TOKEN_COOKIE = 'ca_token'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export function getTokenCookie(): string | null {
  if (typeof window === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function setTokenCookie(token: string): void {
  if (typeof window === 'undefined') return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${MAX_AGE}; SameSite=Strict${secure}`
}

export function clearTokenCookie(): void {
  if (typeof window === 'undefined') return
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Strict`
}

const THEME_COOKIE = 'theme_scheme'
const THEME_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export type ThemeScheme = 'light' | 'dark' | 'light-blue' | 'dark-blue'

const THEME_SCHEMES: ThemeScheme[] = ['light', 'dark', 'light-blue', 'dark-blue']

export function isThemeScheme(value: string | null): value is ThemeScheme {
  return value !== null && (THEME_SCHEMES as string[]).includes(value)
}

export function getThemeCookie(): ThemeScheme | null {
  if (typeof window === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )theme_scheme=([^;]*)/)
  const value = match ? decodeURIComponent(match[1]) : null
  return isThemeScheme(value) ? value : null
}

export function setThemeCookie(theme: ThemeScheme): void {
  if (typeof window === 'undefined') return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${THEME_MAX_AGE}; SameSite=Strict${secure}`
}

/** Toggles the `dark` / `theme-blue` classes on <html> to match a ThemeScheme. */
export function applyThemeClasses(theme: ThemeScheme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme.startsWith('dark'))
  document.documentElement.classList.toggle('theme-blue', theme.endsWith('blue'))
}

const SEARCH_CONSOLE_ROLE_COOKIE = 'search_console_role'
const SEARCH_CONSOLE_ROLE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export type SearchConsoleRole = 'all' | 'developer' | 'seo_manager' | 'marketer' | 'content_creator' | 'executive'

const SEARCH_CONSOLE_ROLES: SearchConsoleRole[] = ['all', 'developer', 'seo_manager', 'marketer', 'content_creator', 'executive']

export function isSearchConsoleRole(value: string | null): value is SearchConsoleRole {
  return value !== null && (SEARCH_CONSOLE_ROLES as string[]).includes(value)
}

/** Display preference only — no server round trip, mirrors the theme
 *  cookie's client-only get/set pattern. Not a permission: switching roles
 *  changes what's shown, not what's fetchable. */
export function getSearchConsoleRoleCookie(): SearchConsoleRole | null {
  if (typeof window === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${SEARCH_CONSOLE_ROLE_COOKIE}=([^;]*)`))
  const value = match ? decodeURIComponent(match[1]) : null
  return isSearchConsoleRole(value) ? value : null
}

export function setSearchConsoleRoleCookie(role: SearchConsoleRole): void {
  if (typeof window === 'undefined') return
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${SEARCH_CONSOLE_ROLE_COOKIE}=${role}; path=/; max-age=${SEARCH_CONSOLE_ROLE_MAX_AGE}; SameSite=Strict${secure}`
}
