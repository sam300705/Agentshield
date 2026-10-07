# Refresh the patch pin after dependency/container review; release using the resulting image digest.
FROM node:22.23.3-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@9.15.4
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm --filter @agentshield/api build
RUN pnpm --filter @agentshield/api deploy --prod /prod/api
# pnpm deploy copies dependencies but Prisma's generated client is a build artifact.
RUN mkdir -p /prod/api/node_modules/.prisma && \
    cp -R node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client /prod/api/node_modules/.prisma/ && \
    find /prod/api/dist -type f \( -name '*.test.*' -o -name '*.map' \) -delete && \
    rm -rf /prod/api/dist/testing

# A controlled, one-off release step, never the API/worker startup command.
FROM build AS migrations
CMD ["pnpm", "db:deploy"]

FROM node:22.23.3-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/api /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
