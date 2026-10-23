# syntax=docker/dockerfile:1
# ============================================================
#  Bibliotheca — production image (multi-stage).
#
#  Stage 1 builds the static bundle with the exact pinned toolchain
#  (package-lock.json); stage 2 is a lean nginx serving it. The result is
#  dependency-free static output, so the runtime image carries no Node.
#
#  Two ways to use it:
#   - plain (no environment): the app talks to Trilium directly FROM THE BROWSER, so the
#     container is stateless: no secrets, no volumes; CORS must be granted by the Trilium
#     instance for this app's origin (see README).
#   - hosted (TRILIUM_URL + TRILIUM_TOKEN, optional AI_*; see docker/30-biblio-config.sh):
#     nginx proxies /etapi/ to your Trilium on the SAME origin and puts the token on the
#     request itself, so the browser never holds it and no CORS is needed. Put your SSO
#     (e.g. Pangolin) in front of this one container and nothing else needs to be public.
# ============================================================

# --- Stage 1: build --------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /build

# Dependencies first (this layer caches independently of source changes).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Source (paths kept tight so future top-level files don't leak into the image).
COPY index.html lizard3d.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src

# tsc strict check + vite build — the build FAILS on type errors, which is
# exactly what we want in an image build (same gate as tools/check.sh).
RUN npm run build

# --- Stage 2: serve ----------------------------------------------------------
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/nginx.conf
# nginx's entrypoint runs every executable /docker-entrypoint.d/*.sh before starting nginx.
COPY docker/30-biblio-config.sh /docker-entrypoint.d/30-biblio-config.sh
# (chmod in a RUN step, not COPY --chmod: the dind daemon here builds with the legacy builder, which has no --chmod)
RUN chmod 755 /docker-entrypoint.d/30-biblio-config.sh
COPY --from=build /build/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine ships busybox wget — no curl needed. "200 on /" is our
# health signal; anything else fails the check.
# GOTCHA: inside these containers `localhost` resolves to ::1 first, and
# nginx (our conf) listens IPv4 only — so target 127.0.0.1 explicitly or
# the check fails with "connection refused" while the app is actually fine.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1