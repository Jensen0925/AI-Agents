-- 第十九章：会话报告工件与不可变版本历史。
-- 一个会话最多关联一个工件；删除会话或工件时，版本快照由外键级联删除。

CREATE TYPE "ArtifactType" AS ENUM ('MARKDOWN', 'CODE', 'DOCUMENT', 'TABLE', 'CHART');

CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL DEFAULT 'MARKDOWN',
    "language" TEXT,
    "content" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artifact_versions" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "changelog" TEXT,
    "sourceTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifacts_conversationId_key" ON "artifacts"("conversationId");
CREATE INDEX "artifacts_userId_updatedAt_idx" ON "artifacts"("userId", "updatedAt");
CREATE UNIQUE INDEX "artifact_versions_artifactId_version_key" ON "artifact_versions"("artifactId", "version");
CREATE INDEX "artifact_versions_artifactId_createdAt_idx" ON "artifact_versions"("artifactId", "createdAt");
CREATE INDEX "artifact_versions_artifactId_sourceTags_idx" ON "artifact_versions"("artifactId", "sourceTags");

ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artifact_versions"
  ADD CONSTRAINT "artifact_versions_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
