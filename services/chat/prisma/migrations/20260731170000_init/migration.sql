-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'processing', 'done', 'error');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filePath" TEXT,
    "storageType" TEXT NOT NULL DEFAULT 'local',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "embedding" vector NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_userId_updatedAt_idx" ON "conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_userId_createdAt_idx" ON "documents"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_documentId_chunkIndex_key" ON "document_chunks"("documentId", "chunkIndex");

-- CreateIndex
CREATE INDEX "task_events_userId_createdAt_idx" ON "task_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "task_events_taskId_status_idx" ON "task_events"("taskId", "status");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
