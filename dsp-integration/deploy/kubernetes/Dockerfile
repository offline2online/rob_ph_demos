# syntax=docker/dockerfile:1
# The DSP Integration API as a container, for the client's EKS cluster
# (deploy/kubernetes/README.md). Build from the POC root:
#
#   docker build -f deploy/kubernetes/Dockerfile -t dsp-exchange-api:<tag> .
#
# Two stages: install and bundle with the workspace's own toolchain, then a
# runtime image holding only Node and the bundle (no node_modules, no
# compiler, no source). The API runs as the unprivileged `node` user on a
# read-only filesystem; /data (the database and creatives) and /tmp are the
# only writable paths, mounted by the Deployment.

FROM node:22-bookworm-slim AS build
WORKDIR /src
# Workspace manifests first, so the dependency layer is cached across
# source changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/dsp-mocks/package.json apps/dsp-mocks/
COPY packages/types/package.json packages/types/
COPY packages/campaign-approval/package.json packages/campaign-approval/
RUN npm ci --no-audit --no-fund
COPY . .
RUN node deploy/kubernetes/build.mjs

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=4000 \
    PH_MIGRATIONS_DIRS=/app/migrations/api/:/app/migrations/approval/ \
    PH_DB_FILE=/data/poc.sqlite \
    PH_ASSETS_DIR=/data/assets
WORKDIR /app
COPY --from=build /src/deploy/kubernetes/dist/ /app/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
# The API. The scheduler tick (a CronJob once the database is shared) is
# `node tick.mjs` in the same image.
CMD ["node", "api.mjs"]
