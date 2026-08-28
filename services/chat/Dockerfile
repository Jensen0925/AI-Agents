FROM node:22-bookworm-slim AS dependencies

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY clients/chat-web/package.json clients/chat-web/package.json
COPY services/chat/package.json services/chat/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate && pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY turbo.json tsconfig.base.json ./
COPY services/chat services/chat
COPY packages/contracts packages/contracts

RUN pnpm run build --filter=@cloudsage/chat

FROM node:22-bookworm-slim AS runner

WORKDIR /workspace/services/chat

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /workspace /workspace

EXPOSE 3001

CMD ["sh", "-c", "pnpm db:deploy && pnpm db:seed && node dist/main.js"]
