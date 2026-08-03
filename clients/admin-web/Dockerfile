FROM oven/bun:1.3.12 AS dependencies

WORKDIR /workspace

COPY package.json bun.lock bunfig.toml ./
COPY clients/admin-web/package.json clients/admin-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN bun install --frozen-lockfile

FROM dependencies AS builder

ARG NEXT_PUBLIC_API_BASE_URL=http://api:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY turbo.json tsconfig.base.json ./
COPY clients/admin-web clients/admin-web
COPY packages/contracts packages/contracts

RUN bun run build --filter=@cloudsage/admin-web

FROM oven/bun:1.3.12 AS runner

WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3003

COPY --from=builder /workspace/clients/admin-web/.next/standalone ./
COPY --from=builder /workspace/clients/admin-web/.next/static ./clients/admin-web/.next/static

EXPOSE 3003

CMD ["bun", "clients/admin-web/server.js"]
