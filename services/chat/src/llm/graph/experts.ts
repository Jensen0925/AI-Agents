import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import {
  Annotation,
  type CompiledStateGraph,
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import {
  checkConflictsTool,
  searchRequirementTool,
} from "./analysis-tools";

/** Supervisor 可以调度的专家名称。 */
export const EXPERT_NAMES = [
  "functional",
  "performance",
  "security",
  "compliance",
] as const;

export type ExpertName = (typeof EXPERT_NAMES)[number];

/** 四个专家在共享状态中的独立输出字段。 */
export type ExpertOutputField =
  | "functionalAnalysis"
  | "performanceAnalysis"
  | "securityAnalysis"
  | "complianceAnalysis";

export const EXPERT_NODE_BY_NAME = {
  functional: "functionalExpert",
  performance: "performanceExpert",
  security: "securityExpert",
  compliance: "complianceExpert",
} as const;

export type ExpertNodeName =
  (typeof EXPERT_NODE_BY_NAME)[keyof typeof EXPERT_NODE_BY_NAME];

/** 专家工具调用硬上限，避免模型在 ReAct 回边中无限消耗 token。 */
export const MAX_EXPERT_STEPS = 6;
/** 兼容旧调用方的别名。 */
export const MAX_EXPERT_TOOL_LOOPS = MAX_EXPERT_STEPS;
const DEFAULT_RETRIEVED_CONTEXT = "当前知识库没有检索到相关资料。";

/**
 * 性能专家的本地评估工具。
 *
 * 目前没有独立容量平台，因此工具先根据输入返回一套确定性的性能核对项；
 * 后续接入压测或监控系统时，可以保持工具协议不变，只替换函数体。
 */
export const estimatePerformanceTool = tool(
  async ({ description, expectedQps, peakUsers }) =>
    JSON.stringify({
      level:
        (expectedQps ?? 0) >= 1_000 || (peakUsers ?? 0) >= 10_000
          ? "high"
          : "medium",
      providedMetrics: {
        expectedQps: expectedQps ?? null,
        peakUsers: peakUsers ?? null,
      },
      description,
      checklist: [
        "确认峰值并发、吞吐量与响应时间目标",
        "确认数据规模、增长速度和热点访问模式",
        "确认缓存、限流、降级和容量扩展策略",
        "定义可观测性指标与性能验收基线",
      ],
    }),
  {
    name: "estimate_performance",
    description:
      "根据需求描述、预估 QPS 和峰值用户数生成性能复杂度与容量核对项。",
    schema: z.object({
      description: z.string().min(1).describe("待评估的需求描述"),
      expectedQps: z.number().nonnegative().optional().describe("预估峰值 QPS"),
      peakUsers: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("预估峰值在线用户数"),
    }),
  },
);

/** 安全专家的本地威胁核对工具。 */
export const assessSecurityTool = tool(
  async ({ description }) => {
    const checks = [
      {
        matched: /(登录|认证|鉴权|token|令牌|密码|权限)/i.test(description),
        category: "身份认证与权限边界",
      },
      {
        matched: /(上传|文件|附件|导入|导出)/i.test(description),
        category: "文件内容、类型与沙箱校验",
      },
      {
        matched: /(手机号|身份证|地址|隐私|个人信息)/i.test(description),
        category: "敏感数据保护与最小化采集",
      },
      {
        matched: /(支付|退款|金额|订单)/i.test(description),
        category: "资金与高风险操作审计",
      },
    ];

    return JSON.stringify({
      riskAreas: checks.filter((item) => item.matched).map((item) => item.category),
      baseline: [
        "服务端执行真实鉴权，不能依赖前端或模型自行判断",
        "输入、工具参数和输出都需要 Schema 与业务校验",
        "敏感数据加密、脱敏并记录高风险操作审计日志",
      ],
    });
  },
  {
    name: "assess_security",
    description:
      "扫描需求中的认证、权限、文件、隐私和资金风险，并给出安全基线。",
    schema: z.object({
      description: z.string().min(1).describe("待评估的完整需求描述"),
    }),
  },
);

/** 合规专家的本地合规域识别工具。 */
export const checkComplianceTool = tool(
  async ({ description, domain }) => {
    const matchedDomains = [
      /(个人信息|手机号|身份证|隐私|画像)/i.test(description)
        ? "personal_information"
        : undefined,
      /(支付|金融|退款|账单|交易)/i.test(description)
        ? "financial"
        : undefined,
      /(医疗|健康|病历)/i.test(description) ? "healthcare" : undefined,
      /(审计|日志|留痕|归档)/i.test(description) ? "audit" : undefined,
      domain,
    ].filter(Boolean);

    return JSON.stringify({
      domains: [...new Set(matchedDomains)],
      checklist: [
        "确认数据收集目的、最小必要范围和用户授权依据",
        "确认数据保存期限、删除机制和跨系统传输边界",
        "确认关键操作审计、证据留存和可追溯要求",
        "上线前由法务或合规责任人复核适用规则",
      ],
    });
  },
  {
    name: "check_compliance",
    description:
      "识别需求涉及的数据、金融、医疗和审计合规域，并返回必要核对项。",
    schema: z.object({
      description: z.string().min(1).describe("待评估的完整需求描述"),
      domain: z
        .string()
        .optional()
        .describe("已知业务领域，例如 ecommerce、finance、healthcare"),
    }),
  },
);

export const FUNCTIONAL_EXPERT_TOOLS = [
  searchRequirementTool,
  checkConflictsTool,
] satisfies StructuredToolInterface[];

export const PERFORMANCE_EXPERT_TOOLS = [
  searchRequirementTool,
  estimatePerformanceTool,
] satisfies StructuredToolInterface[];

export const SECURITY_EXPERT_TOOLS = [
  searchRequirementTool,
  checkConflictsTool,
  assessSecurityTool,
] satisfies StructuredToolInterface[];

export const COMPLIANCE_EXPERT_TOOLS = [
  searchRequirementTool,
  checkComplianceTool,
] satisfies StructuredToolInterface[];

export const FUNCTIONAL_EXPERT_SYSTEM_PROMPT = `你是需求分析团队中的功能需求专家，负责把业务描述转化为可开发、可测试、可追踪的功能方案。

工作目标：
1. 识别目标用户、业务目标、触发条件、前置条件和成功结果。
2. 按业务流程拆分功能模块、子功能、主流程、异常流程和边界条件。
3. 使用“作为……我希望……以便……”格式编写关键用户故事。
4. 为每项核心能力给出可验证的验收标准，优先使用 Given/When/Then。
5. 标明外部系统、数据、权限、接口和前后置需求依赖。
6. 发现需求编号时先调用 search_requirement；需要判断已有需求冲突时调用 check_conflicts。

输出要求：
- 使用 Markdown，至少包含“功能范围”“流程与边界”“用户故事”“验收标准”“依赖与待确认项”。
- 明确区分已知事实、合理假设和待澄清问题。
- 不讨论与功能设计无关的泛化内容，不虚构不存在的业务规则。
- 工具信息足够后直接给出结论，禁止使用相同参数重复调用同一工具。`;

export const PERFORMANCE_EXPERT_SYSTEM_PROMPT = `你是需求分析团队中的性能与可靠性专家，负责把非功能诉求转化为可量化、可压测、可监控的指标。

工作目标：
1. 分析响应时间、吞吐量、并发量、数据规模、批处理窗口和增长趋势。
2. 识别峰值流量、热点数据、慢依赖、长任务和资源竞争等瓶颈。
3. 给出缓存、异步化、限流、降级、重试、幂等、弹性扩缩容和容灾建议。
4. 定义 P95/P99 延迟、错误率、可用性、恢复目标和容量水位等验收指标。
5. 缺少容量数据时调用 estimate_performance 形成核对清单；有需求编号时可先调用 search_requirement 获取背景。

输出要求：
- 使用 Markdown，至少包含“负载假设”“性能指标”“瓶颈与容量风险”“可靠性策略”“性能验收方案”。
- 数值未知时给出建议区间并明确标记为待确认，不得把假设写成事实。
- 指标必须能通过压测、监控或故障演练验证。
- 工具信息足够后直接给出结论，禁止重复调用相同参数。`;

export const SECURITY_EXPERT_SYSTEM_PROMPT = `你是需求分析团队中的安全专家，负责从身份、数据、接口、文件、模型工具和审计角度识别威胁并给出可落地控制措施。

工作目标：
1. 明确身份认证、会话、角色、权限和租户/用户数据隔离边界。
2. 分析输入校验、越权、注入、Prompt Injection、敏感信息泄露和不安全工具调用风险。
3. 对文件上传、外部接口、支付或高风险写操作提出白名单、沙箱、审批与审计要求。
4. 明确传输/存储加密、密钥管理、脱敏、日志留存和异常告警策略。
5. 认证或权限类需求优先调用 check_conflicts；需要系统化威胁检查时调用 assess_security；有编号时先查询需求详情。

输出要求：
- 使用 Markdown，至少包含“资产与信任边界”“威胁与影响”“安全控制”“安全验收标准”“剩余风险”。
- 每个高/中风险都要给出对应缓解措施和验证方式。
- 坚持最小权限、默认拒绝、纵深防御，不把模型判断当作真实权限校验。
- 工具信息足够后直接输出结论，避免重复工具调用。`;

export const COMPLIANCE_EXPERT_SYSTEM_PROMPT = `你是需求分析团队中的合规与治理专家，负责识别业务规则、数据治理、审计留痕和监管约束。

工作目标：
1. 识别个人信息、敏感信息、金融交易、医疗数据、未成年人和跨境数据等适用场景。
2. 检查数据最小化、告知同意、用途限制、访问更正、删除、保存期限和传输边界。
3. 明确审批、审计日志、证据留存、操作可追溯和职责分离要求。
4. 区分强制性义务、组织内部规范和建议性控制，标记需要法务确认的内容。
5. 使用 check_compliance 识别合规域；有需求编号时调用 search_requirement 补齐现有背景。

输出要求：
- 使用 Markdown，至少包含“适用范围”“数据与授权”“留存与审计”“合规验收标准”“待法务确认项”。
- 不直接给出法律结论；规则不明确时明确说明需要法务或合规责任人复核。
- 每项约束尽可能映射到具体产品行为、数据字段或审计证据。
- 工具信息足够后直接给出结论，避免重复工具调用。`;

const SUPERVISOR_SYSTEM_PROMPT = `你是需求分析多专家团队的 Supervisor，只负责判断当前需求需要哪些专家参与，不直接执行需求分析。

可选专家及选择规则：
1. functional：业务流程、功能拆分、用户故事、验收标准、依赖或边界条件。新功能和默认需求通常需要选择。
2. performance：包含并发、吞吐、延迟、海量数据、批处理、实时性、可用性、扩展性、稳定性或容量目标。
3. security：包含登录、认证、鉴权、权限、租户隔离、敏感数据、文件上传、支付、外部工具调用或安全风险。
4. compliance：包含个人信息、隐私、金融、医疗、审计、留痕、数据保存/删除、跨境或明确法规与行业规范。

调度原则：
- 可以同时选择多个专家，并只选择确实需要的专家。
- 新需求至少选择 functional；纯非功能改造也应选择最相关的专项专家。
- 信息不足时不要选择全部专家，选择能处理已知风险的最小集合。
- 返回 activeExperts 和简短 reasoning，不要输出专家分析内容。`;

const supervisorDecisionSchema = z.object({
  activeExperts: z
    .array(z.enum(EXPERT_NAMES))
    .min(1)
    .max(4)
    .describe("本次需要并行执行的专家列表"),
  reasoning: z.string().describe("选择这些专家的简短依据"),
});

type SupervisorDecision = z.infer<typeof supervisorDecisionSchema>;

/** 专家 ReAct 子图的内部状态，output schema 会把 messages 隔离在子图内。 */
export const ExpertSubGraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  extracted: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  retrievedContext: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => DEFAULT_RETRIEVED_CONTEXT,
  }),
  expertToolLoopCount: Annotation<number>({
    reducer: (_current, next) => next,
    default: () => 0,
  }),
  functionalAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  performanceAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  securityAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  complianceAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
});

type ExpertSubGraphStateValue = typeof ExpertSubGraphState.State;

/** Supervisor 子图状态；字段名称与主图保持一致，以便子图直接装配。 */
export const AnalysisSupervisorState = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  extracted: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  retrievedContext: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => DEFAULT_RETRIEVED_CONTEXT,
  }),
  activeExperts: Annotation<ExpertName[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),
  supervisorReasoning: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  functionalAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  performanceAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  securityAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  complianceAnalysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  analysisResult: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
  analysis: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => "",
  }),
});

export type AnalysisSupervisorStateValue =
  typeof AnalysisSupervisorState.State;

const AnalysisSupervisorOutput = Annotation.Root({
  activeExperts: Annotation<ExpertName[]>(),
  supervisorReasoning: Annotation<string>(),
  functionalAnalysis: Annotation<string>(),
  performanceAnalysis: Annotation<string>(),
  securityAnalysis: Annotation<string>(),
  complianceAnalysis: Annotation<string>(),
  analysisResult: Annotation<string>(),
  analysis: Annotation<string>(),
});

function getMessageText(message: BaseMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function getStateInput(state: {
  input?: string;
  messages: BaseMessage[];
}): string {
  if (state.input?.trim()) {
    return state.input.trim();
  }

  const lastHumanMessage = [...state.messages]
    .reverse()
    .find((message) => message.type === "human");
  return lastHumanMessage ? getMessageText(lastHumanMessage).trim() : "";
}

function hasToolCalls(message: BaseMessage | undefined): boolean {
  if (!message || message.type !== "ai") {
    return false;
  }

  return (
    Array.isArray((message as AIMessage).tool_calls) &&
    ((message as AIMessage).tool_calls?.length ?? 0) > 0
  );
}

function createExpertOutputSchema(outputField: ExpertOutputField) {
  return Annotation.Root({
    [outputField]: Annotation<string>(),
  });
}

function createExpertContext(state: ExpertSubGraphStateValue): string {
  return [
    `用户原始需求：${getStateInput(state)}`,
    state.extracted ? `已抽取的需求字段：${state.extracted}` : "",
    `知识库检索上下文：${state.retrievedContext || DEFAULT_RETRIEVED_CONTEXT}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 创建一个隔离消息状态的专家 ReAct 子图。
 *
 * 专家内部可以反复写入 messages 完成工具闭环，但图的 output schema 只暴露
 * outputField，因此四个专家并行时不会把各自消息合并回 Supervisor 或主图。
 */
export function createExpertSubGraph(
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  systemPrompt: string,
  outputField: ExpertOutputField,
  opts: { name: string } = { name: outputField },
): CompiledStateGraph<any, any, any> {
  const toolNode = new ToolNode(tools);

  const agentNode = async (
    state: ExpertSubGraphStateValue,
  ): Promise<Partial<ExpertSubGraphStateValue>> => {
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(createExpertContext(state)),
      ...state.messages,
    ];

    try {
      let response: BaseMessage;
      if (state.expertToolLoopCount >= MAX_EXPERT_STEPS || !model.bindTools) {
        response = (await model.invoke([
          new SystemMessage(
            `${systemPrompt}\n\n当前必须直接给出最终专家结论，不再调用任何工具。`,
          ),
          new HumanMessage(createExpertContext(state)),
          ...state.messages,
        ])) as BaseMessage;
      } else {
        response = (await model.bindTools(tools).invoke(messages)) as BaseMessage;
      }
      return { messages: [response] };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const fallback = `[${opts.name} 专家暂不可用：${reason}] 本项分析已跳过，建议人工补充。`;
      return { messages: [new AIMessage(fallback)], [outputField]: fallback } as Partial<ExpertSubGraphStateValue>;
    }
  };

  const toolsNode = async (
    state: ExpertSubGraphStateValue,
  ): Promise<Partial<ExpertSubGraphStateValue>> => {
    const result = (await toolNode.invoke(state)) as { messages: BaseMessage[] };
    return {
      messages: result.messages,
      expertToolLoopCount: state.expertToolLoopCount + 1,
    };
  };

  const routeAfterAgent = (
    state: ExpertSubGraphStateValue,
  ): "tools" | "finalize" => {
    const lastMessage = state.messages.at(-1);
    if (
      hasToolCalls(lastMessage) &&
      state.expertToolLoopCount < MAX_EXPERT_STEPS
    ) {
      return "tools";
    }
    return "finalize";
  };

  const finalizeNode = async (
    state: ExpertSubGraphStateValue,
  ): Promise<Partial<ExpertSubGraphStateValue>> => {
    const lastAiMessage = [...state.messages]
      .reverse()
      .find((message) => message.type === "ai");
    const content = lastAiMessage ? getMessageText(lastAiMessage).trim() : "";
    const existingOutput = state[outputField];

    return {
      [outputField]:
        existingOutput?.includes("专家暂不可用")
          ? existingOutput
          : content ||
        "专家暂未生成有效结论，请将该维度标记为待人工复核。",
    } as Partial<ExpertSubGraphStateValue>;
  };

  return new StateGraph(ExpertSubGraphState, {
    output: createExpertOutputSchema(outputField),
  })
    .addNode("agent", agentNode)
    .addNode("tools", toolsNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", routeAfterAgent, ["tools", "finalize"])
    .addEdge("tools", "agent")
    .addEdge("finalize", END)
    .compile() as unknown as CompiledStateGraph<any, any, any>;
}

export function createFunctionalExpert(model: BaseChatModel) {
  return createExpertSubGraph(
    model,
    FUNCTIONAL_EXPERT_TOOLS,
    FUNCTIONAL_EXPERT_SYSTEM_PROMPT,
    "functionalAnalysis",
    { name: "功能" },
  );
}

export function createPerformanceExpert(model: BaseChatModel) {
  return createExpertSubGraph(
    model,
    PERFORMANCE_EXPERT_TOOLS,
    PERFORMANCE_EXPERT_SYSTEM_PROMPT,
    "performanceAnalysis",
    { name: "性能与可靠性" },
  );
}

export function createSecurityExpert(model: BaseChatModel) {
  return createExpertSubGraph(
    model,
    SECURITY_EXPERT_TOOLS,
    SECURITY_EXPERT_SYSTEM_PROMPT,
    "securityAnalysis",
    { name: "安全" },
  );
}

export function createComplianceExpert(model: BaseChatModel) {
  return createExpertSubGraph(
    model,
    COMPLIANCE_EXPERT_TOOLS,
    COMPLIANCE_EXPERT_SYSTEM_PROMPT,
    "complianceAnalysis",
    { name: "合规与治理" },
  );
}

function selectExpertsByKeywords(input: string): ExpertName[] {
  const selected = new Set<ExpertName>();

  if (
    /(需求|功能|流程|用户|页面|接口|模块|验收|开发|实现|支持|新增|优化)/i.test(
      input,
    )
  ) {
    selected.add("functional");
  }
  if (
    /(性能|并发|qps|吞吐|响应时间|延迟|实时|大数据|海量|高可用|稳定性|扩容|容量)/i.test(
      input,
    )
  ) {
    selected.add("performance");
  }
  if (
    /(登录|认证|鉴权|密码|token|令牌|权限|安全|敏感|上传|支付|攻击|租户隔离)/i.test(
      input,
    )
  ) {
    selected.add("security");
  }
  if (
    /(合规|法规|隐私|个人信息|身份证|金融|医疗|审计|留痕|保存期限|删除权|跨境)/i.test(
      input,
    )
  ) {
    selected.add("compliance");
  }

  if (selected.size === 0) {
    selected.add("functional");
  }

  return [...selected];
}

/** 使用结构化输出选择需要并行执行的专家，并提供关键词降级策略。 */
export function supervisorNode(model: BaseChatModel) {
  return async (
    state: AnalysisSupervisorStateValue,
  ): Promise<Partial<AnalysisSupervisorStateValue>> => {
    const input = getStateInput(state);

    try {
      const structuredModel = model.withStructuredOutput(
        supervisorDecisionSchema,
      );
      const decision = (await structuredModel.invoke([
        new SystemMessage(SUPERVISOR_SYSTEM_PROMPT),
        new HumanMessage(
          [
            `用户原始需求：${input}`,
            state.extracted ? `已抽取字段：${state.extracted}` : "",
            `检索上下文：${state.retrievedContext || DEFAULT_RETRIEVED_CONTEXT}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        ),
      ])) as SupervisorDecision;

      const activeExperts = [...new Set(decision.activeExperts)].filter(
        (expert): expert is ExpertName => EXPERT_NAMES.includes(expert),
      );

      return {
        activeExperts:
          activeExperts.length > 0
            ? activeExperts
            : selectExpertsByKeywords(input),
        supervisorReasoning: decision.reasoning,
      };
    } catch (error) {
      const activeExperts = selectExpertsByKeywords(input);
      console.warn(
        "[AnalysisSupervisor] structured routing failed; using keyword fallback",
        error instanceof Error ? error.message : error,
      );
      return {
        activeExperts,
        supervisorReasoning: "结构化路由失败，已根据需求关键词选择专家。",
      };
    }
  };
}

/** 条件边返回节点数组，LangGraph 会并行执行所有被选中的专家。 */
export function routeToExperts(
  state: AnalysisSupervisorStateValue,
): ExpertNodeName[] {
  const activeExperts: ExpertName[] =
    state.activeExperts.length > 0 ? state.activeExperts : ["functional"];
  return activeExperts.map((expert) => EXPERT_NODE_BY_NAME[expert]);
}

const EXPERT_OUTPUT_BY_NAME: Record<ExpertName, ExpertOutputField> = {
  functional: "functionalAnalysis",
  performance: "performanceAnalysis",
  security: "securityAnalysis",
  compliance: "complianceAnalysis",
};

const EXPERT_TITLE_BY_NAME: Record<ExpertName, string> = {
  functional: "功能需求专家",
  performance: "性能与可靠性专家",
  security: "安全专家",
  compliance: "合规与治理专家",
};

/** 只读取 activeExperts 对应的字段，避免未选专家的旧值混入本轮结果。 */
function collectSelectedExpertOutputs(state: AnalysisSupervisorStateValue) {
  return state.activeExperts
    .map((expert) => ({
      expert,
      title: EXPERT_TITLE_BY_NAME[expert],
      content: state[EXPERT_OUTPUT_BY_NAME[expert]],
    }))
    .filter((item) => item.content?.trim());
}

function createAggregatorNode(model: BaseChatModel) {
  return async (
    state: AnalysisSupervisorStateValue,
  ): Promise<Partial<AnalysisSupervisorStateValue>> => {
    const selectedOutputs = collectSelectedExpertOutputs(state);
    const fallback = selectedOutputs
      .map((item) => `## ${item.title}\n\n${item.content}`)
      .join("\n\n");

    if (selectedOutputs.length === 0) {
      const analysisResult =
        "未获得有效的专家分析结论，请转入人工评审并补充需求上下文。";
      return { analysisResult, analysis: analysisResult };
    }

    try {
      const response = await model.invoke([
        new SystemMessage(`你是需求分析团队的汇总负责人。请仅汇总本轮 Supervisor 已选择专家的结论，不得补入未执行专家的虚构结论。

汇总要求：
1. 消除重复内容，但保留不同专家之间的重要分歧和约束。
2. 输出功能分解、用户故事、验收标准、技术复杂度，以及被选专项专家提出的关键指标、风险和待确认项。
3. 区分确定结论、假设和待澄清信息。
4. 使用结构清晰的 Markdown；不得声称未选中的专家已经完成评估。`),
        new HumanMessage(
          [
            `用户原始需求：${getStateInput(state)}`,
            `Supervisor 选择：${state.activeExperts.join(", ")}`,
            `选择依据：${state.supervisorReasoning}`,
            "专家结论：",
            fallback,
          ].join("\n\n"),
        ),
      ]);
      const content = getMessageText(response as BaseMessage).trim();
      const analysisResult = content || fallback;
      return { analysisResult, analysis: analysisResult };
    } catch (error) {
      console.warn(
        "[AnalysisSupervisor] aggregator invoke failed; using expert output fallback",
        error instanceof Error ? error.message : error,
      );
      return { analysisResult: fallback, analysis: fallback };
    }
  };
}

/**
 * 创建 Supervisor + 四专家的分析子图：
 * START → supervisor → 被选专家（并行）→ aggregator → END。
 */
export function createAnalysisSupervisorSubGraph(
  model: BaseChatModel,
): CompiledStateGraph<any, any, any> {
  return new StateGraph(AnalysisSupervisorState, {
    output: AnalysisSupervisorOutput,
  })
    .addNode("supervisor", supervisorNode(model))
    .addNode("functionalExpert", createFunctionalExpert(model))
    .addNode("performanceExpert", createPerformanceExpert(model))
    .addNode("securityExpert", createSecurityExpert(model))
    .addNode("complianceExpert", createComplianceExpert(model))
    .addNode("aggregator", createAggregatorNode(model))
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", routeToExperts, [
      "functionalExpert",
      "performanceExpert",
      "securityExpert",
      "complianceExpert",
    ])
    .addEdge("functionalExpert", "aggregator")
    .addEdge("performanceExpert", "aggregator")
    .addEdge("securityExpert", "aggregator")
    .addEdge("complianceExpert", "aggregator")
    .addEdge("aggregator", END)
    .compile() as unknown as CompiledStateGraph<any, any, any>;
}
