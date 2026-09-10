FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate
RUN pnpm --filter @agentshield/api... build
RUN pnpm --filter @agentshield/api deploy --prod /runtime
RUN rm -rf /runtime/src /runtime/test /runtime/tests /runtime/coverage

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app

COPY --from=build --chown=node:node /runtime/ ./

USER node

EXPOSE 3001
CMD ["node", "dist/index.js"]
