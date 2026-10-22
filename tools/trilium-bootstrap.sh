#!/usr/bin/env bash
# ============================================================
#  trilium-bootstrap.sh — stand up the disposable Trilium mock.
#
#  There is NO shared Trilium on this machine (see AGENTS.md): this script
#  owns the project's throwaway instance inside the DinD daemon. Run it
#  before integration tests; tools/check.sh calls it with --recreate to
#  prove the whole setup is reproducible from a wiped volume.
#
#  The headless bootstrap order (derived from the v0.106.0 client bundle and
#  verified live — see AGENTS.md "Verified ETAPI contract"):
#    1. wait for the container to serve HTTP
#    2. POST /api/setup/new-document?skipDemoDb   {locale:"en"}  → 204
#       (only when the DB is not yet initialized; /api/setup/status tells us)
#    3. POST /set-password  (plain HTML form: password1 & password2) → 302
#    4. POST /etapi/auth/login {password} → 201 {authToken}
#
#  Usage:
#    tools/trilium-bootstrap.sh               # start if needed, ensure token
#    tools/trilium-bootstrap.sh --recreate    # wipe volume + full bootstrap
#    tools/trilium-bootstrap.sh --down        # stop and remove the container
#
#  Output: writes .bootstrap.env (gitignored) with TRILIUM_URL/TRILIUM_TOKEN
#  and prints both. The password lives in BIBLIOTHECA_TEST_PASSWORD or the
#  built-in default below — fine for a disposable mock, never for real data.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

export DOCKER_HOST="${DOCKER_HOST:-tcp://dind:2375}"
TRILIUM_URL="${TRILIUM_URL:-http://dind:8080}"
PASSWORD="${BIBLIOTHECA_TEST_PASSWORD:-biblio-test-pw}"
ENV_FILE=".bootstrap.env"

recreate=0; down=0
case "${1:-}" in
  --recreate) recreate=1 ;;
  --down) down=1 ;;
  "") ;;
  *) echo "unknown flag: $1"; exit 2 ;;
esac

if [ "$down" = 1 ]; then
  echo "[bootstrap] stopping trilium mock"
  docker compose down --remove-orphans
  exit 0
fi

if [ "$recreate" = 1 ]; then
  echo "[bootstrap] recreating from scratch (volume wiped)"
  docker compose down --remove-orphans --volumes
fi

echo "[bootstrap] starting trilium (image pinned in compose.yml)"
# BOOTSTRAP_SERVICES=trilium starts only the mock (skips the hosted-app image
# build). Optional; default: all services.
# shellcheck disable=SC2086
docker compose up -d ${BOOTSTRAP_SERVICES:-}

echo -n "[bootstrap] waiting for HTTP"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$TRILIUM_URL/" || true)
  [ "$code" = "200" ] && { echo " ok"; break; }
  echo -n "."; sleep 1
  if [ "$i" = 60 ]; then echo " TIMEOUT"; docker compose logs --tail 20 trilium; exit 1; fi
done

# A token from a previous run that still works? Then nothing to do.
if [ -f "$ENV_FILE" ] && grep -q TRILIUM_TOKEN "$ENV_FILE"; then
  # shellcheck disable=SC1090
  old_token=$(grep '^TRILIUM_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  code=$(curl -s -o /dev/null -w '%{http_code}' "$TRILIUM_URL/etapi/app-info" -H "Authorization: $old_token" || true)
  if [ "$code" = "200" ]; then
    echo "[bootstrap] existing token still valid — nothing to do"
    exit 0
  fi
fi

# Password already known (or just re-set)? Login alone is enough. Trying this
# first avoids re-running setup on an instance that only lost its token.
try_login() {
  curl -s -w '\n%{http_code}' -X POST "$TRILIUM_URL/etapi/auth/login" \
    -H 'Content-Type: application/json' -d "{\"password\":\"$PASSWORD\"}"
}
resp=$(try_login || true)
code=$(tail -n1 <<<"$resp")
if [ "$code" = "201" ]; then
  token=$(sed '$d' <<<"$resp" | sed -n 's/.*"authToken":"\([^"]*\)".*/\1/p')
  mkdir -p "$(dirname "$ENV_FILE")"
  printf 'TRILIUM_URL=%s\nTRILIUM_TOKEN=%s\n' "$TRILIUM_URL" "$token" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[bootstrap] password already set — token minted, done."
  echo "  TRILIUM_URL=$TRILIUM_URL"
  echo "  TRILIUM_TOKEN=$token"
  exit 0
fi

# Fresh instance? (/api/setup/status says isInitialized — the SPA's glob calls
# the same thing dbInitialized; the wire field name is isInitialized.)
db_status=$(curl -s "$TRILIUM_URL/api/setup/status" || true)
echo "[bootstrap] setup status: $db_status"

if ! grep -q '"isInitialized":true' <<<"$db_status"; then
  echo "[bootstrap] initializing a new (empty) document"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    "$TRILIUM_URL/api/setup/new-document?skipDemoDb" \
    -H 'Content-Type: application/json' -d '{"locale":"en"}')
  [ "$code" = "204" ] || { echo "new-document failed: $code"; exit 1; }
fi

echo "[bootstrap] setting password (form POST /set-password)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$TRILIUM_URL/set-password" \
  --data-urlencode "password1=$PASSWORD" \
  --data-urlencode "password2=$PASSWORD")
# 200 (form re-render) on success in some builds, 302 redirect in others —
# both mean "accepted". Anything >= 400 is a real failure.
if [ "$code" -ge 400 ]; then
  echo "set-password failed: $code"
  echo "(if the password was already set differently, wipe with --recreate)"
  exit 1
fi

echo "[bootstrap] minting ETAPI token via /etapi/auth/login"
resp=$(curl -s -w '\n%{http_code}' -X POST "$TRILIUM_URL/etapi/auth/login" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$PASSWORD\"}")
code=$(tail -n1 <<<"$resp"); body=$(sed '$d' <<<"$resp")
if [ "$code" != "201" ]; then
  echo "auth/login failed: $code $body"
  exit 1
fi
token=$(printf '%s' "$body" | sed -n 's/.*"authToken":"\([^"]*\)".*/\1/p')
[ -n "$token" ] || { echo "no authToken in response: $body"; exit 1; }

cat > "$ENV_FILE" <<EOF
# Generated by tools/trilium-bootstrap.sh — disposable mock credentials.
# Gitignored; never commit. Wipe with: tools/trilium-bootstrap.sh --recreate
TRILIUM_URL=$TRILIUM_URL
TRILIUM_TOKEN=$token
EOF
chmod 600 "$ENV_FILE"

echo "[bootstrap] done."
echo "  TRILIUM_URL=$TRILIUM_URL"
echo "  TRILIUM_TOKEN=$token"
echo "  (written to $ENV_FILE — source it in .env.local / your shell)"