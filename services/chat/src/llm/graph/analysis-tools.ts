import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * ReAct 分析子图使用的需求查询工具。
 *
 * 当前仓库还没有把需求实体查询接到独立的需求服务，因此先提供一个
 * 确定性的 Mock 实现。后续接入数据库时只需要替换函数体，工具名称和
 * 输入协议保持不变，模型侧无需改动。
 */
export const searchRequirementTool = tool(
  async ({ reqId }) => {
    return JSON.stringify({
      reqId,
      title: `需求 ${reqId}`,
      status: "in_review",
      summary: "这是一个供需求分析 Agent 使用的模拟需求详情。",
      acceptanceCriteria: [
        "核心功能边界明确",
        "用户故事可以被验收标准覆盖",
      ],
    });
  },
  {
    name: "search_requirement",
    description:
      "根据需求编号查询已有需求详情、状态和验收标准。需求编号通常形如 REQ-20240315-001。",
    schema: z.object({
      reqId: z
        .string()
        .regex(/^REQ-[A-Z0-9-]+$/i)
        .describe("需求编号，例如 REQ-20240315-001"),
    }),
  },
);

/**
 * ReAct 分析子图使用的冲突检测工具。
 *
 * Mock 版本根据描述中的常见登录/认证关键词给出可解释的冲突结果，
 * 让本地测试可以验证工具闭环，而不依赖外部数据库或服务。
 */
export const checkConflictsTool = tool(
  async ({ reqId, description }) => {
    const hasAuthKeyword = /(登录|认证|鉴权|密码|token|令牌|权限)/i.test(
      description,
    );
    const conflicts = hasAuthKeyword
      ? [
          {
            type: "security",
            severity: "medium",
            message: "认证类需求需要进一步确认身份源、会话策略和权限边界。",
          },
        ]
      : [];

    return JSON.stringify({
      reqId,
      conflicts,
      hasConflict: conflicts.length > 0,
    });
  },
  {
    name: "check_conflicts",
    description:
      "根据需求编号和需求描述检测已知冲突，重点关注登录、认证、权限和安全边界。",
    schema: z.object({
      reqId: z
        .string()
        .regex(/^REQ-[A-Z0-9-]+$/i)
        .describe("需求编号，例如 REQ-20240315-001"),
      description: z.string().min(1).describe("需要检测冲突的需求描述"),
    }),
  },
);

/** ReAct Agent 可用的全部分析工具。 */
export const analysisTools = [searchRequirementTool, checkConflictsTool];

