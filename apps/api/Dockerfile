# The garden's server, built from the repo root (it needs packages/sim):
#   docker build -f apps/api/Dockerfile .
# or with its database: `docker compose up` in apps/api.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/sim/package.json packages/sim/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @blob-land/api...
COPY packages/sim packages/sim
COPY apps/api apps/api
# One bundled file: the image carries no node_modules.
RUN pnpm --filter @blob-land/api build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/migrations migrations
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "dist/main.js"]
