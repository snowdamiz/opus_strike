# syntax=docker/dockerfile:1.7

FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/physics/package.json packages/physics/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/* \
  && pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM deps AS build

COPY . .

ARG VITE_SERVER_URL="wss://api.slopheroes.xyz"
ENV VITE_SERVER_URL=$VITE_SERVER_URL

RUN pnpm build:server && pnpm build:client

FROM base AS runtime

ENV NODE_ENV="production"
ENV PORT="2567"
ENV PLAYWRIGHT_BROWSERS_PATH="/ms-playwright"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/server/prisma apps/server/prisma
COPY packages/shared/package.json packages/shared/package.json
COPY packages/physics/package.json packages/physics/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg g++ make python3 \
  && pnpm install --prod --frozen-lockfile --filter @voxel-strike/server... --store-dir /pnpm/store \
  && pnpm --filter @voxel-strike/server db:generate \
  && pnpm --filter @voxel-strike/server exec playwright install --with-deps chromium \
  && apt-get purge -y --auto-remove g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/client/dist apps/client/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/physics/dist packages/physics/dist

WORKDIR /app/apps/server

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "dist/index.js"]
