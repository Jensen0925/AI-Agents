import { tool } from "@langchain/core/tools";
import { z } from "zod";

const CONSTRAINT_MARKERS = ["必须", "至少", "不得", "不能"];

const ENTITY_DEFINITIONS: Record<string, string> = {
  手机号: "用于识别或联系用户的移动电话号码。",
  密码: "用户用于身份验证的保密字符组合。",
  用户注册: "创建新用户账号并收集必要身份信息的业务流程。",
};

export const checkConstraintValidityTool = tool(
  ({ constraint }) => {
    const marker = CONSTRAINT_MARKERS.find((item) =>
      constraint.includes(item),
    );

    return JSON.stringify({
      constraint,
      valid: Boolean(marker),
      reason: marker
        ? `包含明确约束词“${marker}”`
        : "未包含必须、至少、不得或不能等明确约束词",
    });
  },
  {
    name: "check_constraint_validity",
    description:
      "检查需求中的一句约束是否属于明确约束。每条包含必须、至少、不得或不能的约束都应调用一次。",
    schema: z.object({
      constraint: z.string().min(1).describe("需要校验的单条需求约束原文"),
    }),
  },
);

export const lookupEntityDefinitionTool = tool(
  ({ entity }) => {
    const definition = ENTITY_DEFINITIONS[entity];

    return JSON.stringify({
      entity,
      found: Boolean(definition),
      definition: definition ?? "本地实体词典中暂无该实体定义。",
    });
  },
  {
    name: "lookup_entity_definition",
    description:
      "查询需求中关键业务实体的定义。对手机号、密码或用户注册等实体进行结构化抽取前应调用。",
    schema: z.object({
      entity: z.string().min(1).describe("需要查询定义的实体名称"),
    }),
  },
);

export const basicTools = [
  checkConstraintValidityTool,
  lookupEntityDefinitionTool,
];

export async function executeBasicTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  // 按工具名分支后，TypeScript 能保留各工具独立的输入 schema 类型。
  if (name === checkConstraintValidityTool.name) {
    return checkConstraintValidityTool.invoke(
      args as { constraint: string },
    );
  }

  if (name === lookupEntityDefinitionTool.name) {
    return lookupEntityDefinitionTool.invoke(args as { entity: string });
  }

  throw new Error(`Unknown tool: ${name}`);
}
