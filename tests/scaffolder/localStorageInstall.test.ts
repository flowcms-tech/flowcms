import { describe, expect, it } from "vitest"
import {
  DEFAULTS,
  STORAGE_MODES,
  defaultsFor,
} from "../../packages/create-flowcms/src/config/model.mjs"
import {
  DOCKER_LOCAL_STORAGE_PATH,
  LOCAL_NODE_STORAGE_PATH,
  buildGarageServiceEnv,
  buildStorageEnv,
  describeStorage,
  localStoragePathFor,
  storageDriverFor,
  usesGarage,
} from "../../packages/create-flowcms/src/config/storage.mjs"
import {
  ConfigError,
  applyDefaults,
  buildSafeSummary,
  validateConfig,
} from "../../packages/create-flowcms/src/config/validate.mjs"
import {
  composeFilesFor,
  overlaysToRemove,
} from "../../packages/create-flowcms/src/render/compose.mjs"
import { buildEnvFile } from "../../packages/create-flowcms/src/render/envFile.mjs"
import { generateSecrets } from "../../packages/create-flowcms/src/config/secrets.mjs"

/**
 * INSTALLING WITH LOCAL FILESYSTEM STORAGE.
 *
 * The distinction this file exists to protect: `config.storage` is an
 * INFRASTRUCTURE choice — what the installer sets up — while `STORAGE_DRIVER`
 * is a RUNTIME choice: which code path the application takes. They are not the
 * same enum and must not be collapsed into one, because Garage and an external
 * S3 provider are different infrastructure that runs the SAME driver.
 *
 *     garage  (a Compose service)      -> STORAGE_DRIVER=s3
 *     s3      (someone else's server)  -> STORAGE_DRIVER=s3
 *     local   (a directory)            -> STORAGE_DRIVER=local
 *
 * Collapsing them would either lose the ability to bundle Garage or reintroduce
 * a Garage-shaped branch in the application, which is the thing every previous
 * phase went out of its way to avoid.
 */

const EXTERNAL = {
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "my-bucket",
  accessKeyId: "keyid",
  secretAccessKey: "secret",
}

function baseConfig(overrides = {}) {
  const partial = applyDefaults({
    deploymentMode: "docker",
    packageManager: "npm",
    database: "sqlite",
    storage: "garage",
    redis: "none",
    adminPath: "/admin",
    baseUrl: "http://localhost:3000",
    projectName: "example-site",
    ...overrides,
  })
  return validateConfig({ ...partial, secrets: generateSecrets(partial) })
}

describe("the storage choices an operator is offered", () => {
  it("has exactly three, and local is one of them", () => {
    expect([...STORAGE_MODES].sort()).toEqual(["garage", "local", "s3"])
  })
})

describe("infrastructure maps onto a runtime driver", () => {
  it.each([
    ["garage", "s3"],
    ["s3", "s3"],
    ["local", "local"],
  ] as const)("%s runs the %s driver", (storage, driver) => {
    expect(storageDriverFor({ storage })).toBe(driver)
  })

  it("keeps Garage on the s3 driver, permanently", () => {
    // If this ever returns "garage", the application has gained a vendor-
    // specific code path and an operator can no longer move from the bundled
    // Garage to R2 by editing environment variables.
    expect(storageDriverFor({ storage: "garage" })).toBe("s3")
    expect(usesGarage({ storage: "garage" })).toBe(true)
    expect(usesGarage({ storage: "local" })).toBe(false)
  })
})

describe("generated environment", () => {
  it("writes STORAGE_DRIVER=local and a path, and no S3 credentials", () => {
    const env = buildStorageEnv(baseConfig({ storage: "local" }))

    expect(env).toEqual({
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_PATH: DOCKER_LOCAL_STORAGE_PATH,
    })
    // A Local install must not carry five blank S3 variables that look like
    // something an operator forgot to fill in.
    expect(Object.keys(env).some((key) => key.startsWith("S3_"))).toBe(false)
  })

  it("puts the Docker path under the volume that is already persistent", () => {
    const env = buildStorageEnv(baseConfig({ storage: "local" }))

    // `compose.yml` already mounts `flowcms-data:/data` and the Dockerfile
    // creates and chowns `/data` for the unprivileged runtime user. Anywhere
    // else in the container is destroyed on the next `docker compose up`.
    expect(env.LOCAL_STORAGE_PATH).toBe("/data/uploads")
    expect(env.LOCAL_STORAGE_PATH.startsWith("/data/")).toBe(true)
  })

  it("uses a project-relative path for a Local Node install", () => {
    const env = buildStorageEnv(
      baseConfig({ deploymentMode: "local", storage: "local", database: "sqlite" }),
    )

    expect(env.LOCAL_STORAGE_PATH).toBe(LOCAL_NODE_STORAGE_PATH)
    expect(env.LOCAL_STORAGE_PATH).toBe("./data/uploads")
  })

  it("never writes a host filesystem path into container configuration", () => {
    const env = buildStorageEnv(baseConfig({ storage: "local" }))

    // A generated `/home/someone/...` or `C:\...` inside a container's env is
    // a path that does not exist where it will be read.
    expect(env.LOCAL_STORAGE_PATH).not.toMatch(/^[A-Za-z]:/)
    expect(env.LOCAL_STORAGE_PATH).not.toContain("\\")
  })

  it("writes STORAGE_DRIVER=s3 explicitly for Garage", () => {
    const env = buildStorageEnv(baseConfig({ storage: "garage" }))

    // Explicit rather than relying on the "absent means s3" default: the
    // default exists for upgrades, and a freshly generated project should say
    // what it is.
    expect(env.STORAGE_DRIVER).toBe("s3")
    expect(env.S3_ENDPOINT).toBe("http://garage:3900")
    expect(env.LOCAL_STORAGE_PATH).toBeUndefined()
  })

  it("writes STORAGE_DRIVER=s3 explicitly for an external provider", () => {
    const env = buildStorageEnv(
      baseConfig({ deploymentMode: "local", storage: "s3", externalStorage: EXTERNAL }),
    )

    expect(env.STORAGE_DRIVER).toBe("s3")
    expect(env.S3_BUCKET).toBe("my-bucket")
    expect(env.LOCAL_STORAGE_PATH).toBeUndefined()
  })

  it("writes no Garage service credentials for a Local install", () => {
    expect(buildGarageServiceEnv(baseConfig({ storage: "local" }))).toEqual({})
  })

  it("produces a .env that names the driver and the path", () => {
    const file = buildEnvFile(baseConfig({ storage: "local" }))

    expect(file).toContain("STORAGE_DRIVER=local")
    expect(file).toContain("LOCAL_STORAGE_PATH=/data/uploads")
    expect(file).not.toContain("S3_SECRET_ACCESS_KEY")
  })
})

describe("Compose topology", () => {
  it("does not start Garage for a Local install", () => {
    const files = composeFilesFor(baseConfig({ storage: "local" }))

    // Garage is excluded the same way an external-S3 install excludes it — by
    // an overlay that assigns it a profile nothing activates. Running an object
    // store nobody talks to would waste memory and a volume.
    expect(files).toContain("compose.local-storage.yml")
    expect(files).not.toContain("compose.external-s3.yml")
  })

  it("still starts Garage for a Garage install", () => {
    const files = composeFilesFor(baseConfig({ storage: "garage" }))

    expect(files).toEqual(["compose.yml"])
  })

  it("uses the external-S3 overlay for an external provider", () => {
    const files = composeFilesFor(
      baseConfig({ storage: "s3", externalStorage: EXTERNAL }),
    )

    expect(files).toContain("compose.external-s3.yml")
    expect(files).not.toContain("compose.local-storage.yml")
  })

  it("removes the overlay a project did not choose", () => {
    const removed = overlaysToRemove(baseConfig({ storage: "local" }))

    expect(removed).toContain("compose.external-s3.yml")
    expect(removed).not.toContain("compose.local-storage.yml")
  })

  it("creates no second volume for media", () => {
    // `/data` is already a named volume. A separate `flowcms-uploads` volume
    // would be a second thing to back up and a second thing to forget.
    const files = composeFilesFor(baseConfig({ storage: "local" }))
    expect(files).not.toContain("compose.local-volume.yml")
  })
})

describe("validation", () => {
  it("accepts local storage for a Docker install", () => {
    expect(() => baseConfig({ storage: "local" })).not.toThrow()
  })

  it("accepts local storage for a Local Node install", () => {
    expect(() =>
      baseConfig({ deploymentMode: "local", storage: "local" }),
    ).not.toThrow()
  })

  it("still refuses Garage outside Docker", () => {
    // Garage is a Compose service. Nothing changed about that.
    expect(() => baseConfig({ deploymentMode: "local", storage: "garage" })).toThrow(ConfigError)
  })

  it("does not demand S3 credentials for a local install", () => {
    // The whole point: no bucket, no endpoint, no keys.
    expect(() =>
      baseConfig({ deploymentMode: "local", storage: "local", externalStorage: null }),
    ).not.toThrow()
  })

  it("still demands S3 credentials for an external S3 install", () => {
    expect(() =>
      baseConfig({ deploymentMode: "local", storage: "s3", externalStorage: null }),
    ).toThrow(ConfigError)
  })
})

describe("defaults", () => {
  it("still defaults Docker to the bundled Garage", () => {
    // Unchanged: a Docker install that answers nothing gets a working object
    // store with no external account.
    expect(DEFAULTS.storage).toBe("garage")
    expect(defaultsFor("docker").storage).toBe("garage")
  })

  it("defaults Local Node to local storage", () => {
    // CHANGED IN PHASE 3. It used to default to external S3, because there was
    // no filesystem backend and Garage is Docker-only — so the default was the
    // only option that existed, not a preference. Now the sensible default for
    // someone running `node server.js` is a directory, which needs no account
    // anywhere.
    expect(defaultsFor("local").storage).toBe("local")
  })
})

describe("summary and messaging", () => {
  it("describes local storage with its path", () => {
    expect(describeStorage(baseConfig({ storage: "local" }))).toContain("/data/uploads")
  })

  it("says local storage is single-node", () => {
    // The operator has to learn this BEFORE they rely on it, not when their
    // second replica cannot see the first one's uploads.
    expect(describeStorage(baseConfig({ storage: "local" })).toLowerCase()).toContain("single")
  })

  it("still leaks no secret into the summary", () => {
    const summary = buildSafeSummary(
      baseConfig({ deploymentMode: "local", storage: "s3", externalStorage: EXTERNAL }),
    )
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain(EXTERNAL.secretAccessKey)
    expect(serialized).not.toContain(EXTERNAL.accessKeyId)
  })
})

describe("path helpers", () => {
  it("picks the path from the deployment mode, not from an operator answer", () => {
    // There is deliberately no prompt for this. A path typed into an installer
    // is a path that can point outside the container's persistent volume, and
    // the failure mode — uploads that vanish on the next restart — is silent.
    expect(localStoragePathFor("docker")).toBe(DOCKER_LOCAL_STORAGE_PATH)
    expect(localStoragePathFor("local")).toBe(LOCAL_NODE_STORAGE_PATH)
  })
})
