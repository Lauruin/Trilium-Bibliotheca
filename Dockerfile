# syntax=docker/dockerfile:1
# ============================================================
#  Bibliotheca — production image (multi-stage).
#
#  Stage 1 builds the static bundle with the exact pinned toolchain
#  (package-lock.json); stage 2 is a lean nginx serving it. The result is
#  dependency-free static output, so the runtime image carries no Node.
#
#  The app talks to Trilium directly FROM THE BROWSER (no proxy here), so
#  this container is stateless: no secrets, no env, no volumes. CORS must
#  be granted by the Trilium instance for this app's origin — see README.
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
COPY --from=build /build/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine ships busybox wget — no curl needed. "200 on /" is our
# health signal; anything else fails the check.
# GOTCHA: inside these containers `localhost` resolves to ::1 first, and
# nginx (our conf) listens IPv4 only — so target 127.0.0.1 explicitly or
# the check fails with "connection refused" while the app is actually fine.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1