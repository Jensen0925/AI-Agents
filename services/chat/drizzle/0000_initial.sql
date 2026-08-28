CREATE EXTENSION IF NOT EXISTS "vector";

DO $$ BEGIN
  CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('pending', 'processing', 'done', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "ArtifactType" AS ENUM ('MARKDOWN', 'CODE', 'DOCUMENT', 'TABLE', 'CHART');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "messages" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "role" "MessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "documents" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "filePath" TEXT,
  "storageType" TEXT NOT NULL DEFAULT 'local',
  "category" TEXT NOT NULL DEFAULT 'product',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "content" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "embedding" vector NOT NULL,
  "modelName" VARCHAR(100) NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
);
CREATE TABLE IF NOT EXISTS "task_events" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "status" "TaskStatus" NOT NULL,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS "artifacts" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "ArtifactType" NOT NULL DEFAULT 'MARKDOWN',
  "language" TEXT,
  "content" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "artifact_versions" (
  "id" TEXT PRIMARY KEY,
  "artifactId" TEXT NOT NULL REFERENCES "artifacts"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "changelog" TEXT,
  "sourceTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "token_usages" (
  "id" TEXT PRIMARY KEY,
  "conversationId" VARCHAR(255),
  "messageId" VARCHAR(255),
  "threadId" VARCHAR(255),
  "graphName" VARCHAR(100) NOT NULL,
  "nodeName" VARCHAR(100) NOT NULL,
  "agentName" VARCHAR(100) NOT NULL,
  "modelConfigId" VARCHAR(255),
  "modelName" VARCHAR(100) NOT NULL,
  "provider" VARCHAR(100) NOT NULL DEFAULT 'openai',
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isEstimated" BOOLEAN NOT NULL DEFAULT false,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "overrideReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" TEXT PRIMARY KEY,
  "gitSha" VARCHAR(80),
  "model" VARCHAR(100) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "overallMetrics" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "reportPath" VARCHAR(500),
  "reportJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "roles" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "builtIn" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "permissions" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "user_roles" (
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "roleId" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "roleId")
);
CREATE TABLE IF NOT EXISTS "role_permissions" (
  "roleId" TEXT NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permissionId" TEXT NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("roleId", "permissionId")
);
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'product';
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "modelName" VARCHAR(100) NOT NULL DEFAULT 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

CREATE INDEX IF NOT EXISTS "conversations_userId_updatedAt_idx" ON "conversations"("userId", "updatedAt");
CREATE INDEX IF NOT EXISTS "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "documents_userId_createdAt_idx" ON "documents"("userId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_documentId_chunkIndex_key" ON "document_chunks"("documentId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "task_events_userId_createdAt_idx" ON "task_events"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "task_events_taskId_status_idx" ON "task_events"("taskId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "artifacts_conversationId_key" ON "artifacts"("conversationId");
CREATE INDEX IF NOT EXISTS "artifacts_userId_updatedAt_idx" ON "artifacts"("userId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "artifact_versions_artifactId_version_key" ON "artifact_versions"("artifactId", "version");
CREATE INDEX IF NOT EXISTS "artifact_versions_artifactId_createdAt_idx" ON "artifact_versions"("artifactId", "createdAt");
CREATE INDEX IF NOT EXISTS "artifact_versions_artifactId_sourceTags_idx" ON "artifact_versions"("artifactId", "sourceTags");
CREATE INDEX IF NOT EXISTS "token_usages_conversationId_idx" ON "token_usages"("conversationId");
CREATE INDEX IF NOT EXISTS "token_usages_graphName_nodeName_idx" ON "token_usages"("graphName", "nodeName");
CREATE INDEX IF NOT EXISTS "token_usages_agentName_idx" ON "token_usages"("agentName");
CREATE INDEX IF NOT EXISTS "token_usages_modelConfigId_idx" ON "token_usages"("modelConfigId");
CREATE INDEX IF NOT EXISTS "token_usages_createdAt_idx" ON "token_usages"("createdAt");
CREATE INDEX IF NOT EXISTS "eval_runs_createdAt_idx" ON "eval_runs"("createdAt");
CREATE INDEX IF NOT EXISTS "eval_runs_passed_createdAt_idx" ON "eval_runs"("passed", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_status_createdAt_idx" ON "users"("status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_key" ON "roles"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_key" ON "permissions"("code");
CREATE INDEX IF NOT EXISTS "permissions_module_code_idx" ON "permissions"("module", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_expiresAt_idx" ON "refresh_tokens"("userId", "expiresAt");
