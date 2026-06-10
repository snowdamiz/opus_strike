FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g corepack@latest \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/physics/package.json packages/physics/package.json
COPY packages/game-logic/package.json packages/game-logic/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY . .

RUN pnpm build:server

FROM base AS runtime

ENV NODE_ENV="production"
ENV PORT="2567"

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/server/prisma apps/server/prisma
COPY packages/shared/package.json packages/shared/package.json
COPY packages/physics/package.json packages/physics/package.json
COPY packages/game-logic/package.json packages/game-logic/package.json

RUN pnpm install --prod --frozen-lockfile --filter @voxel-strike/server... \
  && pnpm --filter @voxel-strike/server db:generate

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/physics/dist packages/physics/dist
COPY --from=build /app/packages/game-logic/dist packages/game-logic/dist

WORKDIR /app/apps/server

EXPOSE 2567

CMD ["node", "dist/index.js"]
