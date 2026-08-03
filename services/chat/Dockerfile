FROM oven/bun:1.3.12 AS dependencies

WORKDIR /workspace

COPY package.json bun.lock bunfig.toml ./
COPY clients/chat-web/package.json clients/chat-web/package.json
COPY services/chat/package.json services/chat/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN bun install --frozen-lockfile

FROM dependencies AS builder

COPY turbo.json tsconfig.base.json ./
COPY services/chat services/chat
COPY packages/contracts packages/contracts

RUN bun run build --filter=@cloudsage/chat

FROM oven/bun:1.3.12 AS runner

WORKDIR /workspace/services/chat

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /workspace /workspace

EXPOSE 3001

CMD ["sh", "-c", "bun run db:deploy && bun run db:seed && bun dist/main.js"]
