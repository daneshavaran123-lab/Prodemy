# syntax=docker/dockerfile:1.7
# Karban API + worker image (same image, different command). Build context: repository root.
#   docker build -f apps/api/Dockerfile -t karban-api .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @karban/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @karban/shared build \
 && pnpm --filter @karban/api build \
 && pnpm --filter @karban/api deploy --legacy --prod /out \
 && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 STORAGE_LOCAL_DIR=/data/storage
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# API: apply pending migrations, then serve. Worker overrides CMD with `node dist/worker.js`.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
