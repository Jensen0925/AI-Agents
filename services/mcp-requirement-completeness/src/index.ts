import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DIMENSIONS = [
  {
    name: "用户角色",
    pattern: /(用户角色|用户|客户|管理员|运营(?:人员|同学)?|分析师|访客|员工|消费者|商家)/i,
  },
  {
    name: "功能描述",
    pattern: /(功能|支持|实现|开发|提供|能够|可以|用于|新增|创建|查询|管理)/i,
  },
  {
    name: "验收标准",
    pattern: /(验收标准|验收|Given|When|Then|测试通过|完成条件|成功标准)/i,
  },
  {
    name: "优先级",
    pattern: /(优先级|P[0-3]|高优先级|中优先级|低优先级|紧急|重要)/i,
  },
  {
    name: "非功能需求",
    pattern: /(性能|并发|响应时间|安全|可用性|稳定性|扩展性|延迟|吞吐量|可靠性)/i,
  },
  {
    name: "边界条件",
    pattern: /(边界条件|边界|异常|限制|不支持|不包括|前提|权限|失败场景|极端情况)/i,
  },
] as const;

export interface CompletenessAnalysis {
  completenessScore: number;
  coveredDimensions: string[];
  missingDimensions: string[];
  suggestion: string;
}

/** 可单测的纯函数：根据六个维度关键词计算需求完整度。 */
export function analyzeCompleteness(requirementText: string): CompletenessAnalysis {
  const normalizedText = requirementText.trim();
  const coveredDimensions = DIMENSIONS.filter(({ pattern }) =>
    pattern.test(normalizedText),
  ).map(({ name }) => name);
  const missingDimensions = DIMENSIONS.filter(
    ({ name }) => !coveredDimensions.includes(name),
  ).map(({ name }) => name);
  const completenessScore = Math.round(
    (coveredDimensions.length / DIMENSIONS.length) * 100,
  );

  const suggestion = missingDimensions.length
    ? `建议补充以下维度：${missingDimensions.join("、")}。`
    : "需求已覆盖六个基础维度，可进入进一步评审。";

  return {
    completenessScore,
    coveredDimensions,
    missingDimensions,
    suggestion,
  };
}

const COMPLEXITY_FACTORS = [
  {
    name: "外部系统集成",
    weight: 3,
    pattern: /(集成|对接|第三方|API|接口|Webhook|ERP|CRM|支付|短信|邮件)/i,
  },
  {
    name: "权限与角色",
    weight: 2,
    pattern: /(权限|角色|鉴权|认证|登录|单点登录|RBAC|多租户)/i,
  },
  {
    name: "实时与异步处理",
    weight: 3,
    pattern: /(实时|即时|推送|WebSocket|消息队列|异步|流式|订阅)/i,
  },
  {
    name: "AI 能力",
    weight: 4,
    pattern: /(AI|人工智能|大模型|LLM|模型推理|向量|RAG|智能体|Agent)/i,
  },
  {
    name: "安全与合规",
    weight: 3,
    pattern: /(安全|加密|脱敏|审计|合规|隐私|风控|数据保护)/i,
  },
  {
    name: "高性能与大规模数据",
    weight: 3,
    pattern: /(高并发|高可用|性能|百万|千万|大规模|海量|低延迟|秒杀)/i,
  },
  {
    name: "复杂业务流程",
    weight: 2,
    pattern: /(工作流|审批|状态机|多步骤|批量|导入|导出|报表|复杂规则)/i,
  },
] as const;

export interface ComplexityEstimate {
  size: "S" | "M" | "L" | "XL";
  estimatedDays: number;
  complexityScore: number;
  factors: Array<{ name: string; weight: number }>;
}

/** 根据需求中的复杂因子给出确定性规模估算，结果仅供需求评审阶段参考。 */
export function estimateComplexity(
  requirementText: string,
  techStack?: string,
): ComplexityEstimate {
  const source = `${requirementText}\n${techStack ?? ""}`;
  const factors = COMPLEXITY_FACTORS.filter(({ pattern }) => pattern.test(source)).map(
    ({ name, weight }) => ({ name, weight }),
  );
  const complexityScore = factors.reduce((total, factor) => total + factor.weight, 0);

  if (complexityScore <= 2) {
    return { size: "S", estimatedDays: 2, complexityScore, factors };
  }
  if (complexityScore <= 5) {
    return { size: "M", estimatedDays: 5, complexityScore, factors };
  }
  if (complexityScore <= 9) {
    return { size: "L", estimatedDays: 10, complexityScore, factors };
  }
  return { size: "XL", estimatedDays: 20, complexityScore, factors };
}

export interface ExistingRequirement {
  id: string;
  title: string;
  description: string;
}

export interface RequirementConflict {
  id: string;
  title: string;
  overlapKeywords: string[];
  overlapCount: number;
}

export interface ConflictCheckResult {
  hasConflicts: boolean;
  conflictCount: number;
  conflicts: RequirementConflict[];
  suggestion: string;
}

const KEYWORD_STOP_WORDS = new Set([
  "需要",
  "支持",
  "实现",
  "开发",
  "功能",
  "用户",
  "系统",
  "进行",
  "一个",
  "可以",
  "能够",
  "以及",
  "相关",
  "需求",
]);

/** 需求域常见的中文业务词；与英文 token 一起组成可解释的冲突比对关键词。 */
const DOMAIN_KEYWORDS = [
  "用户管理",
  "角色权限",
  "登录认证",
  "用户",
  "角色",
  "权限",
  "登录",
  "认证",
  "订单",
  "支付",
  "退款",
  "商品",
  "库存",
  "报表",
  "审批",
  "工作流",
  "消息通知",
  "实时推送",
  "文件上传",
  "批量导入",
  "数据导出",
  "搜索",
  "知识库",
  "AI分析",
  "安全审计",
  "数据权限",
  "多租户",
  "接口对接",
] as const;

/** 将文本切成可解释的候选关键词；中英文、编号和连续中文词均被保留。 */
export function extractKeywords(text: string): string[] {
  const normalizedText = text.toLowerCase();
  const latinCandidates = normalizedText
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
  const domainCandidates = DOMAIN_KEYWORDS.filter((keyword) =>
    normalizedText.includes(keyword.toLowerCase()),
  );
  return [
    ...new Set(
      [...latinCandidates, ...domainCandidates].filter(
        (keyword) => !KEYWORD_STOP_WORDS.has(keyword),
      ),
    ),
  ];
}

/**
 * 检查新需求与存量需求的关键词交集。交集达到 3 个关键词时视为可能冲突，
 * 结果只用于提示人工确认，不能自动拒绝需求。
 */
export function checkConflicts(
  newRequirement: string,
  existingRequirements: ExistingRequirement[],
): ConflictCheckResult {
  const newKeywords = new Set(extractKeywords(newRequirement));
  const conflicts = existingRequirements.flatMap((requirement) => {
    const existingKeywords = extractKeywords(
      `${requirement.title}\n${requirement.description}`,
    );
    const overlapKeywords = existingKeywords.filter((keyword) => newKeywords.has(keyword));
    return overlapKeywords.length >= 3
      ? [
          {
            id: requirement.id,
            title: requirement.title,
            overlapKeywords,
            overlapCount: overlapKeywords.length,
          },
        ]
      : [];
  });

  return {
    hasConflicts: conflicts.length > 0,
    conflictCount: conflicts.length,
    conflicts,
    suggestion: conflicts.length
      ? "发现潜在重复或重叠需求，请与对应需求负责人确认范围、优先级和合并方案。"
      : "未发现达到阈值的关键词重叠，可继续进入需求分析。",
  };
}

export interface UserStory {
  id: string;
  story: string;
  acceptanceCriteria: string[];
  priority: "P0" | "P1" | "P2" | "P3";
}

export interface UserStoryGenerationResult {
  stories: UserStory[];
}

function inferPriority(requirementText: string): UserStory["priority"] {
  const matched = requirementText.match(/\b(P[0-3])\b/i)?.[1]?.toUpperCase();
  if (matched === "P0" || matched === "P1" || matched === "P2" || matched === "P3") {
    return matched;
  }
  if (/(紧急|必须|核心)/.test(requirementText)) return "P0";
  if (/(重要|优先)/.test(requirementText)) return "P1";
  return "P2";
}

function normalizeAction(action: string): string {
  return action.replace(/[。；，,.\n]+$/g, "").trim();
}

/**
 * 优先解析“作为 XX，我想/希望/需要能够 XX”句式；没有该句式时用功能动词生成
 * 一个“用户”视角的兜底故事，保证工具始终给出可进入评审的最小结构。
 */
export function generateUserStories(
  requirementText: string,
  maxStories = 3,
): UserStoryGenerationResult {
  const limit = Math.min(Math.max(Math.floor(maxStories), 1), 10);
  const priority = inferPriority(requirementText);
  const pattern =
    /作为\s*([^，。；,;\n]{1,20}?)\s*(?:，|,)\s*(?:我)?(?:想|希望|需要)?\s*(?:能够|可以|要|需)?\s*([^。；\n]{2,80})/g;
  const pairs = [...requirementText.matchAll(pattern)]
    .map((match) => ({ role: match[1].trim(), action: normalizeAction(match[2]) }))
    .filter(({ role, action }) => role && action);

  if (pairs.length === 0) {
    const actions = requirementText.match(
      /(?:支持|实现|开发|创建|查询|管理|导入|导出|提交|查看)[^。；\n]{1,60}/g,
    );
    pairs.push({
      role: "用户",
      action: normalizeAction(actions?.[0] ?? requirementText.slice(0, 60)),
    });
  }

  return {
    stories: pairs.slice(0, limit).map(({ role, action }, index) => ({
      id: `US-${String(index + 1).padStart(3, "0")}`,
      story: `作为${role}，我希望能够${action}，以便完成相关业务目标。`,
      acceptanceCriteria: [
        `Given ${role}具备相应权限，When 执行“${action}”，Then 系统完成操作并反馈结果。`,
        `Given 输入不符合规则，When 提交“${action}”，Then 系统提示明确的错误原因且不产生错误数据。`,
      ],
      priority,
    })),
  };
}

const server = new McpServer({
  name: "requirement-completeness",
  version: "0.1.0",
});

server.registerTool(
  "analyze_completeness",
  {
    title: "分析需求完整度",
    description:
      "检查需求文本是否涵盖用户角色、功能描述、验收标准、优先级、非功能需求和边界条件六个维度。",
    inputSchema: {
      requirementText: z.string().min(1).describe("需要评估的需求文本"),
    },
  },
  async ({ requirementText }) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(analyzeCompleteness(requirementText)),
      },
    ],
  }),
);

server.registerTool(
  "estimate_complexity",
  {
    title: "估算需求复杂度",
    description: "根据集成、权限、实时、AI、安全等复杂因子估算需求规模和人天。",
    inputSchema: {
      requirementText: z.string().min(1).describe("需要估算的需求文本"),
      techStack: z.string().optional().describe("可选的技术栈或既有架构说明"),
    },
  },
  async ({ requirementText, techStack }) => ({
    content: [{ type: "text", text: JSON.stringify(estimateComplexity(requirementText, techStack)) }],
  }),
);

server.registerTool(
  "check_conflicts",
  {
    title: "检查需求冲突",
    description: "比较新需求与既有需求的关键词重叠，识别可能重复或范围冲突的需求。",
    inputSchema: {
      newRequirement: z.string().min(1).describe("待检查的新需求描述"),
      existingRequirements: z
        .array(
          z.object({
            id: z.string().min(1),
            title: z.string().min(1),
            description: z.string().min(1),
          }),
        )
        .describe("用于对比的既有需求列表"),
    },
  },
  async ({ newRequirement, existingRequirements }) => ({
    content: [{ type: "text", text: JSON.stringify(checkConflicts(newRequirement, existingRequirements)) }],
  }),
);

server.registerTool(
  "generate_user_stories",
  {
    title: "生成用户故事",
    description: "从需求文本中提取角色和动作，生成带验收标准、优先级的用户故事。",
    inputSchema: {
      requirementText: z.string().min(1).describe("需要转化为用户故事的需求文本"),
      maxStories: z.number().int().min(1).max(10).optional().default(3).describe("最多生成的用户故事数量，默认 3"),
    },
  },
  async ({ requirementText, maxStories }) => ({
    content: [{ type: "text", text: JSON.stringify(generateUserStories(requirementText, maxStories)) }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
