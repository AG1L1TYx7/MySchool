# SmartSchool API (NestJS + Prisma). Build: docker compose build api
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @smartschool/api...

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @smartschool/api prisma:generate && pnpm --filter @smartschool/api build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api /app/apps/api
WORKDIR /app/apps/api
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:5000/health || exit 1
# Applies pending migrations, then starts. Seeding is a separate one-off: docker compose run --rm api pnpm db:seed
CMD ["sh", "-c", "pnpm prisma:deploy && node dist/main.js"]
