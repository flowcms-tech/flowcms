/**
 * Redis, which is optional and stays optional.
 *
 * FlowCMS degrades correctly without it: the login rate limiter falls back to a
 * per-process in-memory implementation that still limits, just not across
 * replicas. That is the right default for a single instance, and it is why
 * "none" is a first-class answer rather than a compromise.
 *
 * Three modes:
 *   none      nothing written; the application uses its in-process limiter
 *   bundled   the `redis` Compose profile, reachable at `redis:6379`
 *   external  an operator-supplied URL
 */

/** @returns {Record<string, string>} */
export function buildRedisEnv(config) {
  if (config.redis === "none") {
    // Deliberately nothing, not `REDIS_URL=`. The application treats empty and
    // absent identically, and an empty assignment reads like a setting somebody
    // cleared rather than a choice nobody made.
    return {}
  }

  if (config.redis === "bundled") {
    // The Compose service name, on the Docker network. It publishes no port —
    // an unauthenticated Redis on a published port is among the most reliably
    // exploited misconfigurations there is.
    return { REDIS_URL: "redis://redis:6379" }
  }

  return config.redisUrl ? { REDIS_URL: config.redisUrl } : {}
}

/** The Compose profile that turns the bundled service on, or null. */
export function redisProfileFor(config) {
  return config.deploymentMode === "docker" && config.redis === "bundled" ? "redis" : null
}

/**
 * Shape only. No connection is attempted, here or anywhere in the installer —
 * readiness owns that question and a second implementation would be a second
 * answer.
 */
export function validateRedisUrl(url) {
  if (typeof url !== "string" || url.trim() === "") return ["a Redis URL is required"]
  if (new RegExp("[\\u0000-\\u001f\\u007f]").test(url)) {
    return ["the Redis URL contains a newline or control character"]
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
      return ["the Redis URL must start with redis:// or rediss://"]
    }
  } catch {
    // Never quotes the input: a Redis URL can carry a password.
    return ["the Redis URL is not valid"]
  }
  return []
}

export function describeRedis(config) {
  if (config.redis === "none") return "Disabled (in-process rate limiting)"
  if (config.redis === "bundled") return "Bundled (Compose profile)"
  const host = safeHost(config.redisUrl)
  return host ? `External (${host})` : "External"
}

function safeHost(url) {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
