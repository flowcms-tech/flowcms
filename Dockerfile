# syntax=docker/dockerfile:1

# Debian rather than Alpine, on evidence rather than preference: @napi-rs/canvas
# (which renders the login CAPTCHA) and libsql (the database driver) both ship
# glibc prebuilt binaries. Under musl they fall back to a source build or fail
# outright, and a CAPTCHA that cannot render is a login screen nobody can pass.
#
# Node rather than Bun because the product direction is Node-primary. Nothing in
# this image ever needed Bun — the migration script needed a TypeScript loader,
# which is a packaging problem, and it is now plain JavaScript.
FROM node:22-bookworm-slim AS base

# ---------------------------------------------------------------------------
# deps — dependencies only, so the layer caches until the lockfile changes
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
# flowcms:render:package-manager
# Dependencies, installed with npm.
#
# The manifests first, then the install, then (later) the sources — so a
# change to a component does not reinstall node_modules.
COPY package.json package-lock.json* ./
# The local packages' MANIFESTS, and only those: the lockfile carries a
# `file:` entry for `flowcms`, and an install refuses to run without the
# directory it points at.
COPY packages/flowcms/package.json ./packages/flowcms/
# flowcms:template-strip:start — the example theme is a repository fixture
COPY packages/flowcms-theme-aurora/package.json ./packages/flowcms-theme-aurora/
# flowcms:template-strip:end
RUN test -f package-lock.json || ( \
      echo "" && \
      echo "No package-lock.json in the build context." && \
      echo "Run 'npm install' in the project first — the image build" && \
      echo "installs exactly what the lockfile pins and cannot create one." && \
      exit 1 )
RUN npm ci --ignore-scripts
# flowcms:render:end

# ---------------------------------------------------------------------------
# builder — compile the application
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Self-hosts the TinyMCE editor assets into public/assets/tinymce. Without this
# the editor shows an "unregistered domain" banner and reaches for the TinyMCE
# cloud CDN — unacceptable in software people install on their own servers.
RUN node scripts/copy-tinymce.mjs

# Telemetry off at build and at run. This is software other people install; it
# should not phone home on their behalf.
ENV NEXT_TELEMETRY_DISABLED=1

# The local packages are SOURCE in this context: the deps stage's install linked
# their directories but nothing has compiled them. (Which install that was
# depends on the package manager, so this comment does not name one.)
# `flowcms/theme` resolves to packages/flowcms/dist, which every theme imports
# and Next therefore has to resolve during the build — so this runs first, and a
# failure here is a build failure rather than a missing module three minutes
# later.
RUN node scripts/build-package.mjs
# flowcms:template-strip:start
RUN node scripts/build-example-theme.mjs
# flowcms:template-strip:end

# THE FLAG ON THE `RUN` LINE BELOW DOES NOT REACH THE TYPESCRIPT WORKER.
#
# `node --max-old-space-size=4096` raises the heap for the process it starts,
# and that process is not the one that runs out of memory. Next forks a separate
# worker for the type-check phase, and a forked worker inherits ENVIRONMENT, not
# the parent's command-line flags — so it fell back to V8's default heap, which
# is derived from container memory and was ~2 GB here. The build then died with
# a JS heap OOM inside TypeScript while the parent still had 4 GB it never used.
#
# Setting it as an environment variable is what makes it inheritable. Both are
# kept: the RUN flag because the parent genuinely needs the headroom too, and
# because `tests/scaffolder/packageManagerPortability.test.ts` pins that line to
# the `build` script character for character.
#
# Builder stage ONLY. The runner must not carry it: the production server has no
# type-check phase, and a 4 GB ceiling on the long-lived process is a footgun on
# a small VPS — it lets a leak grow to 4 GB before Node does anything about it,
# rather than failing early and visibly.
#
# Found by Phase 8.7's bun image build, which is the first one that got far
# enough to reach the type-check phase — the earlier `@types/minimatch` failure
# had been masking it. The Dockerfile is identical for all four package
# managers, so this was never bun-specific.
ENV NODE_OPTIONS=--max-old-space-size=4096

# The production build, invoked through node rather than through a package
# manager. This stage has node_modules but not necessarily the manager that
# created them: a generated project may have been installed with pnpm or yarn,
# whose shims exist only after `corepack enable` in the deps stage, or with bun,
# which is not in this image at all outside it. Node is always here, and the
# line below is exactly what the `build` script runs — the two are pinned to
# each other by tests/scaffolder/packageManagerPortability.test.ts.
RUN node --max-old-space-size=4096 node_modules/next/dist/bin/next build

# Stage the database drivers for the runtime image. Next's tracer cannot see
# them: createDatabase.ts require()s them inside a dialect switch, and
# scripts/migrate.mjs is not part of the Next build at all.
RUN node scripts/collect-db-drivers.mjs /drivers

# ---------------------------------------------------------------------------
# runner — only what is needed to run
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

# A system font, because this image had NONE.
#
# `node:22-bookworm-slim` ships without `/usr/share/fonts` and without
# fontconfig. The login CAPTCHA asked for `sans-serif`, @napi-rs/canvas matched
# nothing, and `fillText` drew zero pixels — while the background and noise
# lines, being geometry rather than glyphs, rendered perfectly. The result was a
# captcha box containing a squiggle and no code: a 200, a valid PNG, a correctly
# signed cookie, and an admin panel nobody could sign in to.
#
# The application now carries its own font (see Framework/Captcha/captchaFont.ts
# and the COPY below), which is what actually fixes the CAPTCHA. This package is
# the second half of the belt-and-braces: it gives the generic families a real
# answer, so anything else in the image that renders text — now or later — is
# not one `sans-serif` away from silently drawing nothing.
#
# `fonts-dejavu-core` rather than a full font set: ~1.5 MB, and it is the
# conventional minimal choice for exactly this.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_DIALECT=sqlite \
    DATABASE_URL=file:/data/app.db

# A dedicated unprivileged user. /data is created and chowned at build time so
# Docker propagates that ownership into an empty named volume on first mount,
# which is what lets a non-root process write SQLite without resorting to
# chmod 777 on a directory holding the entire site's content.
RUN groupadd --system --gid 1001 flowcms \
 && useradd --system --uid 1001 --gid flowcms --home /app flowcms \
 && mkdir -p /data \
 && chown -R flowcms:flowcms /data

# Next's standalone bundle: server.js plus a pruned node_modules.
COPY --from=builder --chown=flowcms:flowcms /app/.next/standalone ./
# standalone omits these two on the assumption a CDN serves them; FlowCMS does
# not assume a CDN.
COPY --from=builder --chown=flowcms:flowcms /app/.next/static ./.next/static
COPY --from=builder --chown=flowcms:flowcms /app/public ./public

# Neither of the next two is reachable from a traced import, so Next's file
# tracer cannot see them: the migration SQL is read from disk at runtime, and
# the migrator is used only by the entrypoint. drizzle-orm has zero runtime
# dependencies, so copying the single directory is complete.
COPY --from=builder --chown=flowcms:flowcms /app/src/db/migrations ./src/db/migrations
# The CAPTCHA's font, for the same reason as the migration SQL above: it is read
# from disk at runtime by path, so no traced import points at it and Next's file
# tracer leaves it out of the standalone bundle. `captchaFont.ts` resolves it
# from the working directory, which is this WORKDIR — so the layout on the left
# and the path in that module have to stay in step.
COPY --from=builder --chown=flowcms:flowcms /app/src/Framework/Captcha/fonts ./src/Framework/Captcha/fonts
COPY --from=builder --chown=flowcms:flowcms /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
# PostgreSQL and MySQL/MariaDB drivers plus their dependency closure, computed
# from the lockfile at build time rather than hardcoded.
COPY --from=builder --chown=flowcms:flowcms /drivers/ ./node_modules/
COPY --from=builder --chown=flowcms:flowcms /app/scripts/migrate.mjs ./scripts/migrate.mjs
# First-owner bootstrap, invoked explicitly by an operator or the future
# installer. It is NEVER run automatically: `docker compose up -d` must not
# create an account, because software that ships with a default owner ships
# with a default way in.
COPY --from=builder --chown=flowcms:flowcms /app/scripts/bootstrap-owner.mjs ./scripts/bootstrap-owner.mjs
# Persistence-verification helper used by scripts/db-matrix.sh.
COPY --from=builder --chown=flowcms:flowcms /app/scripts/matrix-marker.mjs ./scripts/matrix-marker.mjs

COPY --chown=flowcms:flowcms docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

USER flowcms
VOLUME ["/data"]
EXPOSE 3000

# An HTTP probe, not a port check. Phase 3 established that this application can
# bind its port while serving nothing but 500s (an invalid FLOWCMS_ADMIN_PATH
# fails the instrumentation hook without stopping the process), so "the socket
# accepts connections" is not a health signal. Node's global fetch avoids adding
# curl to the runtime image for one request.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
