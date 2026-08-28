FROM node:22-bookworm-slim AS dependencies

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY clients/admin-web/package.json clients/admin-web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate && pnpm install --frozen-lockfile

FROM dependencies AS builder

ARG NEXT_PUBLIC_API_BASE_URL=http://api:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY turbo.json tsconfig.base.json ./
COPY clients/admin-web clients/admin-web
COPY packages/contracts packages/contracts

RUN pnpm run build --filter=@cloudsage/admin-web

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3003

COPY --from=builder /workspace/clients/admin-web/.next/standalone ./
COPY --from=builder /workspace/clients/admin-web/.next/static ./clients/admin-web/.next/static

EXPOSE 3003

CMD ["node", "clients/admin-web/server.js"]
