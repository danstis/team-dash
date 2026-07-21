# syntax=docker/dockerfile:1.7
#
# Multi-stage build for Team Dash.
#
# Stage 1 (build): Node.js 24 produces the Vite 8.1 production bundle
#                  into /app/dist using the committed package-lock.json
#                  (npm ci) so the runtime artefact is reproducible.
# Stage 2 (runtime): nginx 1.30-alpine serves the static build output
#                   from /usr/share/nginx/html. nginx configuration
#                   (SPA fallback routing, Cache-Control: no-cache for
#                   the service worker, hashed-asset caching) is
#                   supplied separately at docker/nginx.conf and is
#                   deliberately not baked into this Dockerfile so the
#                   build/runtime split can evolve independently.
#
# Build:   docker build -f docker/Dockerfile -t team-dash .
# Run:     docker run --rm -p 8080:80 team-dash

ARG NODE_IMAGE=node:24
ARG NGINX_IMAGE=nginx:1.30-alpine

# ---------------------------------------------------------------------------
# Stage 1 — build the static production bundle with Vite 8.1.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app

# Copy only the manifest and lockfile first so `npm ci` is cached across
# builds that do not touch dependencies.
COPY package.json package-lock.json ./

# Reproducible install against the committed lockfile. --no-audit and
# --no-fund keep the build output (and CI logs) free of network-noise.
RUN npm ci --no-audit --no-fund

# Copy the rest of the repository. The package.json/lockfile + npm ci
# pattern above means the host's node_modules (if any) does not need to
# be in the build context.
COPY . .

# Standard Vite production build. The same `npm run build` that runs in
# CI (T014) produces /app/dist, which the runtime stage copies verbatim.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — serve the static bundle with nginx 1.30-alpine.
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

# Drop the Vite build output into nginx's default document root. nginx
# listens on port 80 by default and the inherited CMD
# (`nginx -g "daemon off;"`) starts the server in the foreground.
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80