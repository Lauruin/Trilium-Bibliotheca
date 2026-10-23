#!/bin/sh
# 30-biblio-config.sh — renders the HOST's configuration (environment variables) into nginx config + /config.json.
#
# nginx's official entrypoint runs every executable /docker-entrypoint.d/*.sh before it starts nginx. The root filesystem is
# read-only (compose.yml), so everything is written under /tmp (a tmpfs):
#   /tmp/conf/http-biblio.conf    http{} level: the DNS resolver, the rate-limit zone for the AI proxy
#   /tmp/conf/server-biblio.conf  server{} level: the proxied locations (contains the SECRETS: mode 600, read by the nginx master only)
#   /tmp/config.json              what the app may know (NO secrets): server name, root note, read-only, AI provider + model
#
# Environment (all optional; with none of them the app is the plain static site and the user connects to a Trilium of their own):
#   TRILIUM_URL            where nginx reaches your Trilium, e.g. http://trilium:8080 (also https://host/prefix)
#   TRILIUM_TOKEN          the ETAPI token nginx puts on every request to it (the browser never sees it)
#   TRILIUM_READONLY       1 / true: only GET / HEAD / OPTIONS pass the proxy
#   TRILIUM_ROOT_NOTE_ID   the library root note (default: root)
#   TRILIUM_NAME           display name in the settings dialog (default: Trilium)
#   TRILIUM_PUBLIC_URL     Trilium's own web address, for "open in Trilium" links (optional; the proxy hides the real one)
#   AI_PROVIDER            anthropic (default) | openai-compatible (OpenRouter, Ollama, llama.cpp server, ...)
#   AI_BASE_URL            anthropic: https://api.anthropic.com (default); openai-compatible: e.g. http://ollama:11434/v1 (required)
#   AI_KEY                 API key put on every AI request (required for anthropic; optional for a local openai-compatible server)
#   AI_MODEL               model name shown to the app and sent by it (anthropic default: claude-haiku-5-5; otherwise required)
#
# Values go into nginx config, so they are validated against strict character sets; a bad value stops the container with a
# message instead of becoming config injection.
set -eu

CONF_DIR=/tmp/conf
HTTP_CONF="$CONF_DIR/http-biblio.conf"
SERVER_CONF="$CONF_DIR/server-biblio.conf"
JSON=/tmp/config.json

log() { echo "biblio-config: $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

valid_url() { printf '%s' "$1" | grep -Eq '^https?://[A-Za-z0-9._-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'; }
valid_secret() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._~+/=:-]{8,255}$'; }
valid_name() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9 ._()-]{1,60}$'; }
valid_model() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._:/-]{1,100}$'; }
valid_note() { printf '%s' "$1" | grep -Eq '^(root|[A-Za-z0-9_]{4,32})$'; }
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
truthy() { case "${1:-}" in 1|true|TRUE|True|yes|YES|on) return 0 ;; *) return 1 ;; esac; }
strip_slash() { v=$1; while [ "${v%/}" != "$v" ]; do v=${v%/}; done; printf '%s' "$v"; }

# split a validated URL: ORIGIN (scheme://host[:port]), HOSTPORT, PREFIX (path or empty)
split_url() {
  u=$(strip_slash "$1")
  scheme=${u%%://*}
  rest=${u#*://}
  hostport=${rest%%/*}
  case "$rest" in */*) prefix="/${rest#*/}" ;; *) prefix="" ;; esac
  ORIGIN="$scheme://$hostport"
  HOSTPORT=$hostport
  PREFIX=$prefix
  SCHEME=$scheme
}

mkdir -p "$CONF_DIR"
: > "$HTTP_CONF"
: > "$SERVER_CONF"
chmod 600 "$HTTP_CONF" "$SERVER_CONF"

SERVER_JSON=null
AI_JSON=null
SUMMARY=""

NS=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)
case "$NS" in "") NS=127.0.0.11 ;; *:*) NS="[$NS]" ;; esac
echo "resolver $NS valid=30s ipv6=off;" >> "$HTTP_CONF"

# --------------------------------------------------------------------------------------------------- Trilium (single origin)
if [ -n "${TRILIUM_URL:-}" ]; then
  valid_url "$TRILIUM_URL" || die "TRILIUM_URL must look like http://host:port or https://host/prefix (letters, digits, . _ - only)"
  valid_secret "${TRILIUM_TOKEN:-}" || die "TRILIUM_TOKEN is missing, too short, or has characters outside A-Za-z0-9 . _ ~ + / = : -"
  split_url "$TRILIUM_URL"
  ROOT=${TRILIUM_ROOT_NOTE_ID:-root}
  valid_note "$ROOT" || die "TRILIUM_ROOT_NOTE_ID must be 'root' or a Trilium note id (4-32 letters, digits, _)"
  NAME=${TRILIUM_NAME:-Trilium}
  valid_name "$NAME" || die "TRILIUM_NAME may only use letters, digits, spaces and . _ ( ) -"
  PUBLIC=${TRILIUM_PUBLIC_URL:-}
  if [ -n "$PUBLIC" ]; then valid_url "$PUBLIC" || die "TRILIUM_PUBLIC_URL must be an http(s) URL"; PUBLIC=$(strip_slash "$PUBLIC"); fi
  if truthy "${TRILIUM_READONLY:-}"; then
    RO=true
    LIMIT="limit_except GET HEAD OPTIONS { deny all; }"
  else
    RO=false
    LIMIT=""
  fi
  cat >> "$SERVER_CONF" <<'EOF'

    # ---- Trilium, single origin: the ETAPI token is added HERE; the browser never sees it (and anything it sends is replaced)
    # Logging in / out through the proxy is refused: nobody who passes the front door can mint tokens or kill the injected one.
    location ^~ /etapi/auth/ { return 403; }
    location ^~ /etapi/ {
      @@LIMIT@@
      set $trilium_origin "@@ORIGIN@@@@PREFIX@@";
      proxy_pass $trilium_origin$request_uri;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host "@@HOSTPORT@@";
      proxy_set_header Authorization "@@TOKEN@@";
      proxy_set_header Cookie "";
      proxy_ssl_server_name on;
      proxy_buffering off;
      proxy_hide_header Set-Cookie;
      client_max_body_size 32m;
      proxy_read_timeout 120s;
      proxy_send_timeout 120s;
    }
EOF
  sed -i "s|@@LIMIT@@|$LIMIT|; s|@@ORIGIN@@|$ORIGIN|; s|@@PREFIX@@|$PREFIX|; s|@@HOSTPORT@@|$HOSTPORT|; s|@@TOKEN@@|$TRILIUM_TOKEN|" "$SERVER_CONF"
  SERVER_JSON="{\"name\":\"$(json_str "$NAME")\",\"rootNoteId\":\"$ROOT\",\"readOnly\":$RO,\"publicUrl\":\"$(json_str "$PUBLIC")\"}"
  SUMMARY="Trilium proxy -> $ORIGIN$PREFIX (read-only: $RO, root: $ROOT)"
fi

# ----------------------------------------------------------------------------------------------------------------------- AI
PROVIDER=${AI_PROVIDER:-anthropic}
case "$PROVIDER" in anthropic | openai-compatible) ;; *) die "AI_PROVIDER must be anthropic or openai-compatible" ;; esac
AI_ON=no
if [ "$PROVIDER" = anthropic ] && [ -n "${AI_KEY:-}" ]; then AI_ON=yes; fi
if [ "$PROVIDER" = openai-compatible ] && { [ -n "${AI_BASE_URL:-}" ] || [ -n "${AI_KEY:-}" ]; }; then AI_ON=yes; fi
if [ "$AI_ON" = yes ]; then
  if [ "$PROVIDER" = anthropic ]; then
    BASE=${AI_BASE_URL:-https://api.anthropic.com}
    MODEL=${AI_MODEL:-claude-haiku-5-5}
    valid_secret "${AI_KEY:-}" || die "AI_KEY is missing, too short, or has unusual characters"
  else
    [ -n "${AI_BASE_URL:-}" ] || die "AI_BASE_URL is required for AI_PROVIDER=openai-compatible (e.g. http://ollama:11434/v1)"
    BASE=$AI_BASE_URL
    MODEL=${AI_MODEL:-}
    [ -n "$MODEL" ] || die "AI_MODEL is required for AI_PROVIDER=openai-compatible"
    if [ -n "${AI_KEY:-}" ]; then valid_secret "$AI_KEY" || die "AI_KEY has unusual characters"; fi
  fi
  valid_url "$BASE" || die "AI_BASE_URL must be an http(s) URL"
  valid_model "$MODEL" || die "AI_MODEL may only use letters, digits and . _ : / -"
  split_url "$BASE"
  echo "limit_req_zone \$binary_remote_addr zone=biblio_ai:1m rate=30r/m;" >> "$HTTP_CONF"
  if [ "$PROVIDER" = anthropic ]; then
    AUTH_LINES="proxy_set_header x-api-key \"$AI_KEY\"; proxy_set_header anthropic-version \"2023-06-01\";"
  elif [ -n "${AI_KEY:-}" ]; then
    AUTH_LINES="proxy_set_header Authorization \"Bearer $AI_KEY\"; proxy_set_header x-api-key \"\";"
  else
    AUTH_LINES="proxy_set_header Authorization \"\"; proxy_set_header x-api-key \"\";"
  fi
  cat >> "$SERVER_CONF" <<'EOF'

    # ---- AI provider: the key is added HERE; only two endpoints, POST only, rate limited, small bodies
    location ~ ^/ai/(?<airest>v1/messages|chat/completions)$ {
      limit_except POST { deny all; }
      limit_req zone=biblio_ai burst=8 nodelay;
      client_max_body_size 1m;
      set $ai_origin "@@AI_ORIGIN@@@@AI_PREFIX@@";
      proxy_pass $ai_origin/$airest;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host "@@AI_HOSTPORT@@";
      @@AI_AUTH@@
      proxy_set_header Cookie "";
      proxy_ssl_server_name on;
      proxy_buffering off;
      proxy_hide_header Set-Cookie;
      proxy_read_timeout 180s;
      proxy_send_timeout 60s;
    }
EOF
  # (the key is a validated secret: no | or & in it, so it is safe in a sed replacement)
  sed -i "s|@@AI_ORIGIN@@|$ORIGIN|; s|@@AI_PREFIX@@|$PREFIX|; s|@@AI_HOSTPORT@@|$HOSTPORT|; s|@@AI_AUTH@@|$AUTH_LINES|" "$SERVER_CONF"
  AI_JSON="{\"provider\":\"$PROVIDER\",\"model\":\"$(json_str "$MODEL")\"}"
  SUMMARY="$SUMMARY${SUMMARY:+; }AI: $PROVIDER $MODEL via $ORIGIN$PREFIX"
fi

printf '{"server":%s,"ai":%s}\n' "$SERVER_JSON" "$AI_JSON" > "$JSON"
chmod 644 "$JSON"
log "${SUMMARY:-no host configuration: plain static app, the user connects to a Trilium of their own}"
