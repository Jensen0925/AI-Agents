import { z } from "zod";

export const APP_NAME = "llm";

const RequirementFields = {
  action: z.string().describe("唯一核心动作，格式为动词加对象"),
  constraints: z.array(z.string()).describe("输入中明确出现的约束"),
  entities: z.array(z.string()).describe("输入中真实出现的实体名词"),
} as const;

export const RequirementSchema = z.object(RequirementFields);

export const RequirementResultSchema = RequirementSchema.strict();

export type RequirementResult = z.infer<typeof RequirementResultSchema>;
