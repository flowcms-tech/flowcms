import { describe, expect, it } from "vitest"
import {
  MigrationDestinationError,
  buildDestinationConfig,
  describeLocation,
  redactEndpoint,
  resolveLocalDestinationCandidate,
} from "@/Framework/Storage/Migration/migrationDestination"

/**
 * TURNING WHAT AN OPERATOR TYPED INTO A DESTINATION.
 *
 * Two rules run through everything here, and both are security properties
 * rather than conveniences:
 *
 *   A BROWSER MAY NOT NAME A FILESYSTEM PATH. An S3 destination is five fields
 *   an admin types; a Local destination is one value the DEPLOYMENT chose. If
 *   a request could carry a root, an admin session would be a file-write
 *   primitive anywhere the process can reach.
 *
 *   NOTHING THAT REACHES A SCREEN CARRIES A CREDENTIAL. An endpoint can carry
 *   `user:password@` in its userinfo, and every endpoint on this path ends up
 *   in a response, a log and probably a support ticket.
 */

describe("redacting an endpoint before it is displayed", () => {
  it("leaves an ordinary endpoint alone", () => {
    expect(redactEndpoint("https://s3.example.com")).toBe("https://s3.example.com")
  })

  it("strips a password from the userinfo", () => {
    expect(redactEndpoint("https://key:secret@s3.example.com")).toBe(
      "https://***@s3.example.com",
    )
  })

  it("strips a bare username too", () => {
    // A username is not a secret, but it is half of one and it is never needed
    // to identify the location.
    expect(redactEndpoint("https://admin@s3.example.com")).toBe("https://***@s3.example.com")
  })

  it("keeps the port, which does identify the location", () => {
    expect(redactEndpoint("http://garage:3900")).toBe("http://garage:3900")
  })

  it("refuses to echo something it could not parse", () => {
    // An unparseable endpoint might still contain a secret. Returning it
    // verbatim because the URL parser gave up is exactly the wrong default.
    expect(redactEndpoint("not a url at all")).toBe("(unreadable endpoint)")
  })

  it("passes through an empty endpoint as empty", () => {
    expect(redactEndpoint("")).toBe("")
    expect(redactEndpoint(undefined)).toBe("")
  })
})

describe("describing a location for the operator", () => {
  it("describes a local root, because it is deployment configuration", () => {
    expect(describeLocation({ driver: "local", root: "/data/uploads" })).toEqual({
      driver: "local",
      root: "/data/uploads",
      label: "Local filesystem — /data/uploads",
    })
  })

  it("describes an s3 location without its credentials", () => {
    const described = describeLocation({
      driver: "s3",
      endpoint: "https://key:secret@s3.example.com",
      region: "auto",
      bucket: "media",
      accessKeyId: "AKIA-VISIBLE",
      secretAccessKey: "super-secret",
    })

    expect(described).toEqual({
      driver: "s3",
      endpoint: "https://***@s3.example.com",
      region: "auto",
      bucket: "media",
      label: "S3-compatible — media at https://***@s3.example.com",
    })
  })

  it("never carries a secret in any field of the description", () => {
    const described = describeLocation({
      driver: "s3",
      endpoint: "https://s3.example.com",
      region: "auto",
      bucket: "media",
      accessKeyId: "AKIA-VISIBLE",
      secretAccessKey: "super-secret",
    })

    expect(JSON.stringify(described)).not.toContain("super-secret")
    expect(JSON.stringify(described)).not.toContain("AKIA-VISIBLE")
  })
})

/** Matches the convention in storageConfig.test.ts. */
function env(overrides: Record<string, string | undefined> = {}) {
  return { ...overrides } as NodeJS.ProcessEnv
}

describe("the Local destination comes from the deployment, never the browser", () => {
  it("offers the configured path as the candidate", () => {
    expect(resolveLocalDestinationCandidate(env({ LOCAL_STORAGE_PATH: "/data/uploads" }))).toEqual({
      available: true,
      root: "/data/uploads",
    })
  })

  it("is available even when the deployment currently runs s3", () => {
    // Preparing LOCAL_STORAGE_PATH is precisely how an operator readies an
    // S3 -> Local move; requiring STORAGE_DRIVER=local first would mean
    // restarting into a backend with no files in it.
    const candidate = resolveLocalDestinationCandidate(env({
      STORAGE_DRIVER: "s3",
      LOCAL_STORAGE_PATH: "/data/uploads",
    }))

    expect(candidate.available).toBe(true)
  })

  it("is unavailable, with an explanation, when the deployment has no path", () => {
    const candidate = resolveLocalDestinationCandidate(env({}))

    expect(candidate.available).toBe(false)
    if (!candidate.available) {
      expect(candidate.reason).toMatch(/LOCAL_STORAGE_PATH/)
    }
  })

  it("treats a blank path as unset rather than as the root directory", () => {
    expect(resolveLocalDestinationCandidate(env({ LOCAL_STORAGE_PATH: "   " })).available).toBe(false)
  })
})

describe("building a destination from a request", () => {
  const deployment = env({ LOCAL_STORAGE_PATH: "/data/uploads" })

  it("builds an s3 destination from the submitted fields", () => {
    const config = buildDestinationConfig(
      {
        driver: "s3",
        endpoint: "https://s3.example.com",
        region: "auto",
        bucket: "media",
        accessKeyId: "AKIA",
        secretAccessKey: "shhh",
      },
      deployment,
    )

    expect(config).toEqual({
      driver: "s3",
      endpoint: "https://s3.example.com",
      region: "auto",
      bucket: "media",
      accessKeyId: "AKIA",
      secretAccessKey: "shhh",
    })
  })

  it("takes the local root from the deployment and IGNORES anything submitted", () => {
    // The whole point. A request that names a root does not get one.
    const config = buildDestinationConfig(
      { driver: "local", root: "/etc" } as never,
      deployment,
    )

    expect(config).toEqual({ driver: "local", root: "/data/uploads" })
  })

  it("refuses a local destination when the deployment configured none", () => {
    expect(() => buildDestinationConfig({ driver: "local" }, env())).toThrow(
      MigrationDestinationError,
    )
  })

  it("refuses an s3 destination with no bucket", () => {
    expect(() =>
      buildDestinationConfig(
        { driver: "s3", endpoint: "https://s3.example.com", bucket: "", accessKeyId: "A", secretAccessKey: "B" },
        deployment,
      ),
    ).toThrow(MigrationDestinationError)
  })

  it("refuses an s3 destination with no secret", () => {
    expect(() =>
      buildDestinationConfig(
        { driver: "s3", endpoint: "https://s3.example.com", bucket: "media", accessKeyId: "A", secretAccessKey: "" },
        deployment,
      ),
    ).toThrow(MigrationDestinationError)
  })

  it("refuses an endpoint that is not http or https", () => {
    // An SSRF-shaped input, and one a bucket name cannot express: `file://`
    // and `gopher://` have no business reaching an S3 client.
    expect(() =>
      buildDestinationConfig(
        {
          driver: "s3",
          endpoint: "file:///etc/passwd",
          bucket: "media",
          accessKeyId: "A",
          secretAccessKey: "B",
        },
        deployment,
      ),
    ).toThrow(MigrationDestinationError)
  })

  it("never puts a submitted value into the refusal message", () => {
    // A rejected endpoint echoed back is a credential in a log.
    try {
      buildDestinationConfig(
        {
          driver: "s3",
          endpoint: "https://user:hunter2@s3.example.com",
          bucket: "",
          accessKeyId: "A",
          secretAccessKey: "B",
        },
        deployment,
      )
      throw new Error("should have refused")
    } catch (error) {
      expect((error as Error).message).not.toContain("hunter2")
    }
  })
})
