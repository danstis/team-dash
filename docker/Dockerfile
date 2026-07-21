# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Team Dash.
#
# Stage 1 (build): Node.js 24 produces the Vite 8.1 production bundle
#                  into /app/dist using the committed package-lock.json
#                  (npm ci) so the runtime artefact is reproducible.
# Stage 2 (runtime): nginxinc/nginx-unprivileged:1.30-alpine serves the
#                    static build output from /usr/share/nginx/html as a
#                    non-root user. nginx configuration (SPA fallback
#                    routing, Cache-Control: no-cache for the service
#                    worker, hashed-asset caching) is supplied
#                    separately at docker/nginx.conf and is deliberately
#                    not baked into this Dockerfile so the build/runtime
#                    split can evolve independently.
#
# Build:   docker build -f docker/Dockerfile -t team-dash .
# Run:     docker run --rm -p 8080:8080 team-dash

ARG NODE_IMAGE=node:24
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30-alpine

# ---------------------------------------------------------------------------
# Stage 1 — build the static production bundle with Vite 8.1.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app

# Copy only the manifest and lockfile first so `npm ci` is cached across
# builds that do not touch dependencies.
COPY package.json package-lock.json ./

# Reproducible install against the committed lockfile. --ignore-scripts
# prevents install-time lifecycle hooks from executing in the image
# build, and --no-audit / --no-fund keep the output free of
# network-noise.
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy only the files the Vite production build actually needs. This
# explicit, per-target list (rather than `COPY . .`) prevents the host's
# `node_modules/` — present whenever a developer has run `npm install`
# locally — from being dragged into the build context and silently
# overwriting the just-`npm ci`'d `/app/node_modules` with binaries built
# for the host OS/arch (esbuild/rollup/etc.), which can produce a
# subtly wrong or broken image without any CI gate to catch it (T014's
# docker-build gate is the first one). The list is intentionally narrow:
# the entry HTML, the Vite + TypeScript configs, and the src/ tree.
# Lint, test, fixture, spec-kit, CI, and docker files are not part of
# the production bundle and are excluded.
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src

# Standard Vite production build. The same `npm run build` that runs in
# CI (T014) produces /app/dist, which the runtime stage copies verbatim.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — serve the static bundle with unprivileged nginx 1.30-alpine.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

# Drop the Vite build output into nginx's default document root. The
# unprivileged nginx image listens on port 8080 by default and the
# inherited CMD (`nginx -g "daemon off;"`) starts the server in the
# foreground as the image's non-root `nginx` user.
COPY --from=build /app/dist /usr/share/nginx/html

# Layer in the Team Dash nginx config (SPA fallback routing, the
# `Cache-Control: no-cache` policy for the service-worker file and
# the PWA manifest, and the long-cache policy for Vite's hashed
# `/assets/*` output — see T012 / BSOD-140). The upstream image's
# main `nginx.conf` `include`s everything under `/etc/nginx/conf.d/`,
# so installing the file as `default.conf` both adds our rules and
# replaces the image's stock default site (which listens on the same
# port 8080 with a "Welcome to nginx!" stub that would otherwise
# shadow Team Dash).
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
