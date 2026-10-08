#!/usr/bin/env bash
# ============================================================
#  etapi-probe.sh — integration test against the disposable mock.
#
#  Asserts every endpoint this app actually relies on, with the response
#  shapes observed on v0.106.0 (full list recorded in AGENTS.md). Never point
#  this at a real instance: it creates and deletes notes under root.
#
#  Credentials: env TRILIUM_URL + TRILIUM_TOKEN, or source .bootstrap.env
#  (written by tools/trilium-bootstrap.sh).
#
#  Usage: tools/etapi-probe.sh
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f .bootstrap.env ] && [ -z "${TRILIUM_TOKEN:-}" ]; then
  # shellcheck disable=SC1091
  . ./.bootstrap.env
fi
: "${TRILIUM_URL:?TRILIUM_URL not set (run tools/trilium-bootstrap.sh)}"
: "${TRILIUM_TOKEN:?TRILIUM_TOKEN not set (run tools/trilium-bootstrap.sh)}"

fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '  \033[32mok\033[0m    %s\n' "$1"
  else
    printf '  \033[31mFAIL\033[0m  %s (expected %s, got %s)\n' "$1" "$2" "$3"
    fail=1
  fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

H="Authorization: $TRILIUM_TOKEN"
STAMP="biblio-probe-$(date +%s)"

echo "== auth & meta =="
# 401 + NOT_AUTHENTICATED is the EXPECTED unauthenticated response: endpoint
# alive, token required. With a valid token: 200 + app metadata.
c=$(code "$TRILIUM_URL/etapi/app-info")
check "app-info without token → 401 (alive, auth required)" 401 "$c"
c=$(curl -s -o /dev/null -w '%{http_code}' "$TRILIUM_URL/etapi/app-info" -H "$H")
check "app-info with token → 200" 200 "$c"
ver=$(curl -s "$TRILIUM_URL/etapi/app-info" -H "$H" | grep -oE '"appVersion":"[^"]+"' | head -1)
[ -n "$ver" ] && printf '  \033[32mok\033[0m    appVersion present (%s)\n' "$ver" || { echo "  FAIL  appVersion missing"; fail=1; }

echo "== tree & content =="
# create-note → 201 with {note:{noteId,...,attributes},branch:{branchId,...}}
created=$(curl -s -w '\n%{http_code}' -X POST "$TRILIUM_URL/etapi/create-note" -H "$H" \
  -H 'Content-Type: application/json' \
  -d "{\"parentNoteId\":\"root\",\"title\":\"$STAMP\",\"type\":\"text\",\"content\":\"<p>probe content</p>\"}")
c=$(tail -n1 <<<"$created"); body=$(sed '$d' <<<"$created")
check "create-note → 201" 201 "$c"
note_id=$(printf '%s' "$body" | grep -oE '"noteId":"[A-Za-z0-9_]+"' | head -1 | cut -d'"' -f4)
[ -n "$note_id" ] || { echo "  FAIL  no noteId in create response"; exit 1; }

# GET /notes/{id} returns childNoteIds + attributes (the tree-walk contract)
c=$(curl -s "$TRILIUM_URL/etapi/notes/$note_id" -H "$H" | grep -c '"childNoteIds"')
check "get note exposes childNoteIds (tree walk)" 1 "$c"

# content read: text notes are HTML
content=$(curl -s "$TRILIUM_URL/etapi/notes/$note_id/content" -H "$H")
check "note content round-trips" 1 "$(grep -c 'probe content' <<<"$content")"

echo "== attributes (the layout write path) =="
# POST /attributes → label; NOTE: Trilium normalises names — dots become
# underscores ("biblio.x" is stored as "biblio_x"), verified on v0.106.0.
attr=$(curl -s -X POST "$TRILIUM_URL/etapi/attributes" -H "$H" \
  -H 'Content-Type: application/json' \
  -d "{\"noteId\":\"$note_id\",\"type\":\"label\",\"name\":\"biblio.x\",\"value\":\"7\"}")
attr_id=$(printf '%s' "$attr" | grep -oE '"attributeId":"[A-Za-z0-9_]+"' | cut -d'"' -f4)
name_norm=$(printf '%s' "$attr" | grep -oE '"name":"[^"]*"' | cut -d'"' -f4)
check "create label → attributeId returned" 1 "$([ -n "$attr_id" ] && echo 1 || echo 0)"
check "label name biblio.x normalised to biblio_x" "biblio_x" "$name_norm"

c=$(code -X PATCH "$TRILIUM_URL/etapi/attributes/$attr_id" -H "$H" \
  -H 'Content-Type: application/json' -d '{"value":"9"}')
check "patch attribute value → 200" 200 "$c"
val=$(curl -s "$TRILIUM_URL/etapi/notes/$note_id" -H "$H" | grep -oE '"name":"biblio_x","value":"9"')
check "patched value visible on note" 1 "$([ -n "$val" ] && echo 1 || echo 0)"

c=$(code -X DELETE "$TRILIUM_URL/etapi/attributes/$attr_id" -H "$H")
check "delete attribute → 204" 204 "$c"

echo "== search =="
res=$(curl -s "$TRILIUM_URL/etapi/notes?search=$STAMP" -H "$H" | grep -c '"noteId"')
check "full-text search finds created note" 1 "$([ "$res" -ge 1 ] && echo 1 || echo 0)"

echo "== cleanup =="
c=$(code -X DELETE "$TRILIUM_URL/etapi/notes/$note_id" -H "$H")
check "delete note → 204" 204 "$c"

echo
[ "$fail" = 0 ] && printf '\033[32metapi probe: all green\033[0m\n' || printf '\033[31metapi probe: FAILURES\033[0m\n'
exit "$fail"