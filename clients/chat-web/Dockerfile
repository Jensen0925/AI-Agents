FROM node:22-bookworm-slim AS dependencies

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY clients/chat-web/package.json clients/chat-web/package.json
COPY services/chat/package.json services/chat/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate && pnpm install --frozen-lockfile

FROM dependencies AS builder

ARG NEXT_PUBLIC_API_BASE_URL=http://api:3001
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}

COPY turbo.json tsconfig.base.json ./
COPY clients/chat-web clients/chat-web
COPY packages/contracts packages/contracts

RUN pnpm run build --filter=@cloudsage/chat-web

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3002

COPY --from=builder /workspace/clients/chat-web/.next/standalone ./
COPY --from=builder /workspace/clients/chat-web/.next/static ./clients/chat-web/.next/static

EXPOSE 3002

CMD ["node", "clients/chat-web/server.js"]
