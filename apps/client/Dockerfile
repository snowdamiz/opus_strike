FROM node:22-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm install -g corepack@latest \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/physics/package.json packages/physics/package.json

RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_SERVER_URL
ARG VITE_DISCORD_AUTH_ENABLED=false

ENV VITE_SERVER_URL=$VITE_SERVER_URL
ENV VITE_DISCORD_AUTH_ENABLED=$VITE_DISCORD_AUTH_ENABLED

RUN pnpm build:client

FROM nginx:1.27-alpine AS runtime

COPY apps/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html

EXPOSE 8080
