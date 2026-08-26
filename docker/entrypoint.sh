#!/bin/sh
#
# Migrate, then hand the container over to Next.
#
# `set -e` so a failed migration aborts here rather than starting a server
# against a schema that does not match the code — that failure mode produces
# 500s whose cause is three layers away from the symptom.
#
# `exec` so the Node process REPLACES this shell and receives SIGTERM directly.
# Without it, signals stop at a shell that will not forward them, and every
# `docker compose down` waits out the full 10-second kill timeout before the
# container dies uncleanly.
set -e

echo "FlowCMS: applying database migrations..."
node scripts/migrate.mjs

echo "FlowCMS: starting server..."
exec node server.js
