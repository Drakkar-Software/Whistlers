# Stage 1 — compile TypeScript
FROM node:22-alpine AS builder

RUN corepack enable pnpm

WORKDIR /app

# Restore dependencies before copying source for layer-cache efficiency
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ts/whistlers/package.json packages/ts/whistlers/tsconfig.json ./packages/ts/whistlers/
RUN pnpm install --frozen-lockfile

COPY packages/ts/whistlers/src ./packages/ts/whistlers/src
RUN pnpm -r build

# Stage 2 — lean runtime image
FROM node:22-alpine

ARG VERSION=""
ENV VERSION=$VERSION

LABEL maintainer="Drakkar-Software" \
      version="${VERSION}" \
      description="Whistlers — message-queue-to-destination bridge"

WORKDIR /app

# Copy the full pnpm virtual store and compiled output from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ts/whistlers/dist ./dist
COPY --from=builder /app/packages/ts/whistlers/package.json ./

VOLUME /etc/whistlers

ENTRYPOINT ["node", "dist/bin/server.js"]
CMD ["/etc/whistlers/config.json"]
