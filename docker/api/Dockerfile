# Build context is the repository root (see docker-compose.yml) so the workspace lockfile is available.
FROM oven/bun:1

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so this layer is cached until package.json or bun.lock change.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
RUN bun install --frozen-lockfile --production

# Bun runs TypeScript directly, so there is no build step to copy from.
COPY apps/api apps/api

# Drop root: the image ships a non-root "bun" user.
USER bun

EXPOSE 3001
CMD ["bun", "apps/api/src/index.ts"]
