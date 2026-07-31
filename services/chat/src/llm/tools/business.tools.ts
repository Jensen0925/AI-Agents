import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const WORKSPACE_ROOT = resolve(process.cwd(), "workspace");

function isPathInsideWorkspace(targetPath: string): boolean {
  const relativePath = relative(WORKSPACE_ROOT, targetPath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

/**
 * 将用户提供的相对路径限制在 services/chat/workspace 目录内。
 */
export function safePath(relativePath: string): string {
  const normalizedPath = relativePath.trim();

  if (!normalizedPath || isAbsolute(normalizedPath)) {
    throw new Error("Path must be a non-empty workspace-relative path");
  }

  const targetPath = resolve(WORKSPACE_ROOT, normalizedPath);
  if (!isPathInsideWorkspace(targetPath)) {
    throw new Error("Path escapes the workspace sandbox");
  }

  return targetPath;
}

async function assertNoSymbolicLink(targetPath: string): Promise<void> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const relativePath = relative(WORKSPACE_ROOT, targetPath);
  const segments = relativePath ? relativePath.split(sep) : [];
  let currentPath = WORKSPACE_ROOT;

  for (const segment of segments) {
    currentPath = join(currentPath, segment);

    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error("Symbolic links are not allowed in workspace paths");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        break;
      }

      throw error;
    }
  }
}

async function readWorkspaceFile(relativePath: string): Promise<string> {
  const targetPath = safePath(relativePath);
  await assertNoSymbolicLink(targetPath);
  return readFile(targetPath, "utf8");
}

async function writeWorkspaceFile(
  relativePath: string,
  content: string,
): Promise<string> {
  const targetPath = safePath(relativePath);
  await assertNoSymbolicLink(targetPath);
  await mkdir(dirname(targetPath), { recursive: true });
  // 创建目录后再次校验，避免新目录层级中出现符号链接。
  await assertNoSymbolicLink(targetPath);
  await writeFile(targetPath, content, "utf8");

  return JSON.stringify({
    path: relativePath,
    bytes: Buffer.byteLength(content, "utf8"),
    written: true,
  });
}

export const queryRequirementTool = tool(
  ({ requirementId }) =>
    readWorkspaceFile(`requirements/${requirementId}.json`),
  {
    name: "query_requirement",
    description:
      "根据需求单号读取需求详情。用户询问某个需求单时优先调用此工具。",
    schema: z.object({
      requirementId: z
        .string()
        .regex(/^[A-Za-z0-9_-]+$/)
        .describe("需求单号，例如 REQ-2026-001"),
    }),
  },
);

export const readFileTool = tool(
  ({ path }) => readWorkspaceFile(path),
  {
    name: "read_file",
    description:
      "读取 workspace 内的规范、标准或其他业务文件。路径必须相对 workspace，且不能带 workspace/ 前缀。",
    schema: z.object({
      path: z.string().min(1).describe("workspace 内的相对文件路径"),
    }),
  },
);

export const writeFileTool = tool(
  ({ path, content }) => writeWorkspaceFile(path, content),
  {
    name: "write_file",
    description:
      "将分析报告或其他制品写入 workspace。仅在用户明确要求写入文件时调用。",
    schema: z.object({
      path: z.string().min(1).describe("workspace 内的相对文件路径"),
      content: z.string().describe("要写入文件的完整 UTF-8 内容"),
    }),
  },
);

export const businessTools = [
  queryRequirementTool,
  readFileTool,
  writeFileTool,
];

export async function executeBusinessTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (name === queryRequirementTool.name) {
    return queryRequirementTool.invoke(args as { requirementId: string });
  }

  if (name === readFileTool.name) {
    return readFileTool.invoke(args as { path: string });
  }

  if (name === writeFileTool.name) {
    return writeFileTool.invoke(args as { path: string; content: string });
  }

  throw new Error(`Unknown tool: ${name}`);
}
