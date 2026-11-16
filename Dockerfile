FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/site-builder/package.json packages/site-builder/package.json
COPY packages/sync/package.json packages/sync/package.json
COPY services/api/package.json services/api/package.json
COPY services/remote/package.json services/remote/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci
COPY packages packages
COPY services services
COPY apps apps
RUN npm run build

FROM node:22-bookworm-slim AS runtime-base
WORKDIR /app
COPY docker/debian.sources /etc/apt/sources.list.d/debian.sources
COPY docker/apt-https.conf /etc/apt/apt.conf.d/99olps-bootstrap
COPY docker/write-bootstrap-ca.mjs /opt/write-bootstrap-ca.mjs
RUN node /opt/write-bootstrap-ca.mjs \
    && apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl aria2 \
    && rm /etc/apt/apt.conf.d/99olps-bootstrap /opt/olps-bootstrap-ca.pem /opt/write-bootstrap-ca.mjs \
    && rm -rf /var/lib/apt/lists/*
ARG CURSOR_AGENT_VERSION=2026.10.22-27dcf5f
COPY docker/install-cursor-agent.sh /opt/install-cursor-agent.sh
RUN bash /opt/install-cursor-agent.sh

FROM runtime-base AS runtime
COPY --from=build /app /app
ENV NODE_ENV=production
ENV GIT_AUTHOR_NAME="OLPS" GIT_AUTHOR_EMAIL="olps@localhost"
ENV GIT_COMMITTER_NAME="OLPS" GIT_COMMITTER_EMAIL="olps@localhost"
CMD ["node", "services/api/dist/server.js"]

FROM nginx:stable-alpine AS admin
COPY docker/admin.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
