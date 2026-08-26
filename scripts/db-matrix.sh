#!/usr/bin/env bash
#
# Cold-start, bootstrap and persistence verification for one database topology.
#
#   scripts/db-matrix.sh postgres
#   scripts/db-matrix.sh mysql
#   scripts/db-matrix.sh mariadb
#   scripts/db-matrix.sh sqlite
#
# One parameterised script rather than three copies: three copies drift, and the
# drift is invisible because each keeps passing against its own database while
# testing something slightly different.
#
# It never prints the bootstrap password, and it never runs `down -v` between
# persistence steps — that is the one command that would destroy the thing being
# measured. Volumes are removed only at the end, deliberately.
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  sqlite)   OVERLAY=""                      ; DB_SERVICE="" ;;
  postgres) OVERLAY="-f compose.postgres.yml"; DB_SERVICE="postgres" ;;
  mysql)    OVERLAY="-f compose.mysql.yml"   ; DB_SERVICE="mysql" ;;
  mariadb)  OVERLAY="-f compose.mariadb.yml" ; DB_SERVICE="mariadb" ;;
  *) echo "usage: $0 {sqlite|postgres|mysql|mariadb}" >&2; exit 2 ;;
esac

COMPOSE=(docker compose -f compose.yml)
[ -n "$OVERLAY" ] && COMPOSE+=($OVERLAY)

PORT="${FLOWCMS_PORT:-3000}"
BASE="http://localhost:${PORT}"
OWNER_EMAIL="matrix-${MODE}@example.com"
# Ephemeral, generated per run, never echoed.
OWNER_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
MARKER_SLUG="matrix-marker-${MODE}"

pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAILED=1; }
FAILED=0

check() { if [ "$2" = "$3" ]; then pass "$1 ($2)"; else fail "$1 (expected $3, got $2)"; fi; }

wait_ready() {
  local tries=${1:-90}
  for _ in $(seq 1 "$tries"); do
    if curl -fsS --max-time 3 "$BASE/api/ready" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

ready_body() { curl -fsS --max-time 5 "$BASE/api/ready" 2>/dev/null || echo '{"status":"unreachable"}'; }

echo "=============================================================="
echo " FlowCMS database matrix — $MODE"
echo "=============================================================="

echo "[1/9] cold start from empty volumes"
"${COMPOSE[@]}" down -v >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d >/dev/null 2>&1
if wait_ready; then pass "became ready"; else fail "never became ready"; "${COMPOSE[@]}" logs app | tail -20; exit 1; fi
echo "       ready: $(ready_body)"

echo "[2/9] migrations applied at startup"
if "${COMPOSE[@]}" logs app 2>&1 | grep -q "Migrations applied"; then pass "migrations ran"; else fail "no migration line in logs"; fi

echo "[3/9] bootstrap first owner"
if "${COMPOSE[@]}" run --rm \
      -e FLOWCMS_OWNER_EMAIL="$OWNER_EMAIL" \
      -e FLOWCMS_OWNER_PASSWORD="$OWNER_PASSWORD" \
      -e FLOWCMS_OWNER_NAME="Matrix Owner" \
      --entrypoint node app scripts/bootstrap-owner.mjs >/tmp/bootstrap.log 2>&1; then
  pass "owner created"
else
  fail "bootstrap failed"; cat /tmp/bootstrap.log
fi
grep -q "$OWNER_PASSWORD" /tmp/bootstrap.log && fail "password leaked into output" || pass "password not in output"

echo "[4/9] duplicate bootstrap refused"
if "${COMPOSE[@]}" run --rm \
      -e FLOWCMS_OWNER_EMAIL="$OWNER_EMAIL" \
      -e FLOWCMS_OWNER_PASSWORD="$OWNER_PASSWORD" \
      --entrypoint node app scripts/bootstrap-owner.mjs >/tmp/dup.log 2>&1; then
  fail "second bootstrap was allowed"
else
  pass "refused"
fi

echo "[5/9] write a marker through the application's database layer"
"${COMPOSE[@]}" run --rm --entrypoint node app scripts/matrix-marker.mjs write "$MARKER_SLUG" >/tmp/marker.log 2>&1 || { fail "marker write failed"; cat /tmp/marker.log; }
grep -q "marker written" /tmp/marker.log && pass "marker written" || fail "marker not confirmed"

verify_state() {
  local label="$1"
  # A real argv command, not `node -e`: `docker compose run` consumes -e as its
  # own environment flag, so an inline script silently ran the image's normal
  # entrypoint (migrations) and reported that as the marker result.
  "${COMPOSE[@]}" run --rm --entrypoint node app \
    scripts/matrix-marker.mjs verify "$MARKER_SLUG" "$OWNER_EMAIL" >/tmp/verify.log 2>&1 || true
  if grep -q "marker=1 owner=1" /tmp/verify.log; then pass "$label — marker and owner survived"; else fail "$label — $(tail -1 /tmp/verify.log)"; fi
}

echo "[6/9] restart the database container"
if [ -n "$DB_SERVICE" ]; then "${COMPOSE[@]}" restart "$DB_SERVICE" >/dev/null 2>&1; else "${COMPOSE[@]}" restart app >/dev/null 2>&1; fi
wait_ready 60 && pass "ready after restart" || fail "not ready after restart"
verify_state "after restart"

echo "[7/9] docker compose down (volumes preserved) then up"
"${COMPOSE[@]}" down >/dev/null 2>&1
"${COMPOSE[@]}" up -d >/dev/null 2>&1
wait_ready && pass "ready after down/up" || fail "not ready after down/up"
verify_state "after down/up"

echo "[8/9] readiness payload"
BODY="$(ready_body)"
echo "       $BODY"
echo "$BODY" | grep -q '"status":"ready"' && pass "status ready" || fail "not ready"
echo "$BODY" | grep -qE 'postgres|mysql|mariadb|@|password' && fail "readiness leaked connection detail" || pass "no connection detail leaked"

echo "[9/9] cleanup (deliberate volume removal)"
"${COMPOSE[@]}" down -v >/dev/null 2>&1
pass "volumes removed"

echo "--------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then echo " $MODE: ALL CHECKS PASSED"; else echo " $MODE: FAILURES ABOVE"; fi
echo "--------------------------------------------------------------"
exit "$FAILED"
