import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";
import { LOCAL_EMBEDDING_MODEL } from "../llm/embedding/model";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) =>
    String(value)
      .slice(1, -1)
      .split(",")
      .filter(Boolean)
      .map(Number),
});

export const messageRoleEnum = pgEnum("MessageRole", ["USER", "ASSISTANT"]);
export const taskStatusEnum = pgEnum("TaskStatus", [
  "pending",
  "processing",
  "done",
  "error",
]);
export const userStatusEnum = pgEnum("UserStatus", ["ACTIVE", "DISABLED"]);
export const artifactTypeEnum = pgEnum("ArtifactType", [
  "MARKDOWN",
  "CODE",
  "DOCUMENT",
  "TABLE",
  "CHART",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
  },
  (table) => [index("conversations_userId_updatedAt_idx").on(table.userId, table.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<JsonValue>(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("messages_conversationId_createdAt_idx").on(table.conversationId, table.createdAt)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversationId")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("userId").notNull(),
    title: text("title").notNull(),
    type: artifactTypeEnum("type").default("MARKDOWN").notNull(),
    language: text("language"),
    content: text("content").notNull(),
    currentVersion: integer("currentVersion").default(1).notNull(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("artifacts_conversationId_key").on(table.conversationId),
    index("artifacts_userId_updatedAt_idx").on(table.userId, table.updatedAt),
  ],
);

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifactId")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    changelog: text("changelog"),
    sourceTags: text("sourceTags").array().default([]).notNull(),
    sourceMessageId: text("sourceMessageId"),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("artifact_versions_artifactId_version_key").on(table.artifactId, table.version),
    index("artifact_versions_artifactId_createdAt_idx").on(table.artifactId, table.createdAt),
    index("artifact_versions_artifactId_sourceTags_idx").on(table.artifactId, table.sourceTags),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull(),
    filePath: text("filePath"),
    storageType: text("storageType").default("local").notNull(),
    category: text("category").default("product").notNull(),
    status: text("status").default("pending").notNull(),
    chunkCount: integer("chunkCount").default(0).notNull(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("documents_userId_createdAt_idx").on(table.userId, table.createdAt)],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("documentId")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    chunkIndex: integer("chunkIndex").notNull(),
    embedding: vector("embedding").notNull(),
    modelName: varchar("modelName", { length: 100 })
      .default(LOCAL_EMBEDDING_MODEL)
      .notNull(),
  },
  (table) => [uniqueIndex("document_chunks_documentId_chunkIndex_key").on(table.documentId, table.chunkIndex)],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    taskType: text("taskType").notNull(),
    taskId: text("taskId").notNull(),
    status: taskStatusEnum("status").notNull(),
    message: text("message"),
    metadata: jsonb("metadata").$type<JsonValue>(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
    readAt: timestamp("readAt", { precision: 3, mode: "date" }),
  },
  (table) => [
    index("task_events_userId_createdAt_idx").on(table.userId, table.createdAt),
    index("task_events_taskId_status_idx").on(table.taskId, table.status),
  ],
);

export const tokenUsages = pgTable(
  "token_usages",
  {
    id: text("id").primaryKey(),
    conversationId: varchar("conversationId", { length: 255 }),
    messageId: varchar("messageId", { length: 255 }),
    threadId: varchar("threadId", { length: 255 }),
    graphName: varchar("graphName", { length: 100 }).notNull(),
    nodeName: varchar("nodeName", { length: 100 }).notNull(),
    agentName: varchar("agentName", { length: 100 }).notNull(),
    modelConfigId: varchar("modelConfigId", { length: 255 }),
    modelName: varchar("modelName", { length: 100 }).notNull(),
    provider: varchar("provider", { length: 100 }).default("openai").notNull(),
    inputTokens: integer("inputTokens").default(0).notNull(),
    outputTokens: integer("outputTokens").default(0).notNull(),
    totalTokens: integer("totalTokens").default(0).notNull(),
    cachedInputTokens: integer("cachedInputTokens").default(0).notNull(),
    estimatedCostUsd: doublePrecision("estimatedCostUsd").default(0).notNull(),
    isEstimated: boolean("isEstimated").default(false).notNull(),
    latencyMs: integer("latencyMs").default(0).notNull(),
    overrideReason: text("overrideReason"),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("token_usages_conversationId_idx").on(table.conversationId),
    index("token_usages_graphName_nodeName_idx").on(table.graphName, table.nodeName),
    index("token_usages_agentName_idx").on(table.agentName),
    index("token_usages_modelConfigId_idx").on(table.modelConfigId),
    index("token_usages_createdAt_idx").on(table.createdAt),
  ],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    gitSha: varchar("gitSha", { length: 80 }),
    model: varchar("model", { length: 100 }).notNull(),
    startedAt: timestamp("startedAt", { precision: 3, mode: "date" }).notNull(),
    finishedAt: timestamp("finishedAt", { precision: 3, mode: "date" }),
    overallMetrics: jsonb("overallMetrics").$type<JsonValue>().notNull(),
    passed: boolean("passed").notNull(),
    reportPath: varchar("reportPath", { length: 500 }),
    reportJson: jsonb("reportJson").$type<JsonValue>(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("eval_runs_createdAt_idx").on(table.createdAt),
    index("eval_runs_passed_createdAt_idx").on(table.passed, table.createdAt),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("passwordHash").notNull(),
    status: userStatusEnum("status").default("ACTIVE").notNull(),
    lastLoginAt: timestamp("lastLoginAt", { precision: 3, mode: "date" }),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    index("users_status_createdAt_idx").on(table.status, table.createdAt),
  ],
);

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    builtIn: boolean("builtIn").default(false).notNull(),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("roles_code_key").on(table.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    module: text("module").notNull(),
    description: text("description"),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("permissions_code_key").on(table.code),
    index("permissions_module_code_idx").on(table.module, table.code),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: text("roleId")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assignedAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("roleId")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permissionId")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assignedAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("tokenHash").notNull(),
    expiresAt: timestamp("expiresAt", { precision: 3, mode: "date" }).notNull(),
    revokedAt: timestamp("revokedAt", { precision: 3, mode: "date" }),
    createdAt: timestamp("createdAt", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("refresh_tokens_tokenHash_key").on(table.tokenHash),
    index("refresh_tokens_userId_expiresAt_idx").on(table.userId, table.expiresAt),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type TaskEvent = typeof taskEvents.$inferSelect;
export const MessageRole = {
  USER: "USER",
  ASSISTANT: "ASSISTANT",
} as const;
export const TaskStatus = {
  pending: "pending",
  processing: "processing",
  done: "done",
  error: "error",
} as const;
export const UserStatus = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;
export const ArtifactType = {
  MARKDOWN: "MARKDOWN",
  CODE: "CODE",
  DOCUMENT: "DOCUMENT",
  TABLE: "TABLE",
  CHART: "CHART",
} as const;

export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];
