/**
 * Mirrors CACHE_PREFIX in src/Framework/Redis/CacheService.ts. Duplicated,
 * not imported, on purpose: that file pulls in ioredis (a Node-only client),
 * and this one is used by 'use client' components — importing it directly
 * would drag ioredis into the browser bundle. Keep the literal in sync with
 * the server-side constant if it ever changes.
 */
export const CACHE_PREFIX = "flowcms:cache:"
