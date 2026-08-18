-- 第十章/第十七章评测与成本观测数据。
-- 这些表属于旁路数据，写入失败不应阻断聊天主流程。

CREATE TABLE "token_usages" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "gitSha" VARCHAR(80),
    "model" VARCHAR(100) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "overallMetrics" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reportPath" VARCHAR(500),
    "reportJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "token_usages_conversationId_idx" ON "token_usages"("conversationId");
CREATE INDEX "token_usages_graphName_nodeName_idx" ON "token_usages"("graphName", "nodeName");
CREATE INDEX "token_usages_agentName_idx" ON "token_usages"("agentName");
CREATE INDEX "token_usages_modelConfigId_idx" ON "token_usages"("modelConfigId");
CREATE INDEX "token_usages_createdAt_idx" ON "token_usages"("createdAt");
CREATE INDEX "eval_runs_createdAt_idx" ON "eval_runs"("createdAt");
CREATE INDEX "eval_runs_passed_createdAt_idx" ON "eval_runs"("passed", "createdAt");
