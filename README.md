# CloudSage

CloudSage 是一个 Bun workspaces monorepo，包含 NestJS API、独立的 AI 聊天端与管理端、共享 contracts，以及 PostgreSQL/pgvector 基础设施。聊天端保持参考项目的窄版需求分析界面；管理端提供登录、工作台、用户、角色、权限和个人信息页面。

## 目录

```text
clients/chat-web       Next.js 15 AI 聊天端，端口 3002
clients/admin-web      Next.js 15 管理端，端口 3003
services/chat          NestJS API，端口 3001
packages/contracts     共享类型与 schema
infra/compose          Docker Compose 与开发覆盖配置
```

## 本地启动

### 1. 安装依赖

需要 Bun 1.3+、Docker Desktop 和可用的 PostgreSQL 17/pgvector 镜像。

```bash
bun install
```

### 2. 启动 PostgreSQL

推荐直接启动完整 Compose，数据库会自动持久化到 `postgres_data` volume：

```bash
docker compose -f infra/compose/compose.yaml up -d
```

访问：

- 登录与 AI 聊天工作区：[http://localhost:3002/login](http://localhost:3002/login)
- AI 聊天入口：[http://localhost:3002/chat](http://localhost:3002/chat)
- 管理端登录：[http://localhost:3003/login](http://localhost:3003/login)
- 管理端工作台：[http://localhost:3003/dashboard](http://localhost:3003/dashboard)
- API 健康检查：[http://localhost:3001/health](http://localhost:3001/health)

API 容器启动时会自动执行 `prisma migrate deploy` 和 `prisma db seed`。seed 会创建全部权限、`super_admin` 角色和初始管理员。

默认管理员：

```text
邮箱：admin@cloudsage.local
密码：Cloudsage@123
```

可以通过环境变量覆盖：

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-me' \
  docker compose -f infra/compose/compose.yaml up -d
```

### 3. 纯本地开发

先只启动 PostgreSQL：

```bash
docker compose -f infra/compose/compose.yaml up -d postgres
```

然后在 `services/chat/.env` 配置：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cloudsage
JWT_SECRET=replace-with-a-long-local-secret
PORT=3001
CORS_ORIGINS=http://localhost:3002,http://localhost:3003
ADMIN_EMAIL=admin@cloudsage.local
ADMIN_PASSWORD=Cloudsage@123
```

执行迁移、生成客户端和初始化数据：

```bash
bun run --cwd services/chat db:deploy
bun run --cwd services/chat db:generate
bun run --cwd services/chat db:seed
```

分别启动 API 和 Web：

```bash
bun run dev:chat
bun run dev:chat-web
bun run dev:admin-web
```

也可以使用开发覆盖文件挂载源码：

```bash
docker compose \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.dev.yaml up
```

## 前端功能

- 聊天端 `/login`、`/chat`：邮箱密码登录、刷新令牌处理、参考风格需求分析界面和当前 Nest 会话分析接口。
- 管理端 `/login`、`/dashboard`：独立的 CloudSage Admin 登录、工作台和权限驱动导航。
- 管理端 `/dashboard/users`：用户列表与搜索。
- 管理端 `/dashboard/roles`：角色列表与搜索。
- 管理端 `/dashboard/permissions`：按模块查看权限编码。
- 管理端 `/dashboard/profile`：更新显示名称。

两个前端的 API 请求都经过各自的 `lib/api.ts`：自动注入 Bearer Token，401 时轮换 refresh token，刷新失败跳转登录页，403 跳转无权限页。聊天端发送消息使用 `POST /api/conversations/:id/chat`，不会调用参考项目中不存在的 UI Chat API。

## API 认证示例

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@cloudsage.local","password":"Cloudsage@123"}'
```

将返回的 `accessToken` 放到请求头：

```bash
curl http://localhost:3001/api/users \
  -H "Authorization: Bearer <accessToken>"
```

## 验证

```bash
bun run typecheck
bun run --cwd services/chat db:generate
```

当前交付阶段不执行 `next build` 或其他构建命令；Compose 生产镜像构建时会执行对应的 Next/Nest 构建流程。

## 停止与清理

```bash
docker compose -f infra/compose/compose.yaml down
```

如需删除本地数据库数据，再明确执行：

```bash
docker compose -f infra/compose/compose.yaml down -v
```
