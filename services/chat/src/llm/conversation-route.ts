export type ConversationRoute =
  | "direct"
  | "knowledge"
  | "requirement_query"
  | "requirement_analysis";

const REQUIREMENT_ID_PATTERN = /\bREQ-\d{4,8}-\d{3,}\b/iu;
const EXPLANATION_QUESTION_PATTERN =
  /[?？]|是什么|什么意思|怎么(?:做|用|实现)?|如何|为什么|为何|区别|对比|介绍|解释|原理|教程|示例|用法/iu;

/**
 * 会话入口的确定性边界：默认直接问模型，只有明确来源或需求语义才进入专用链路。
 */
export function classifyConversationRoute(input: string): ConversationRoute {
  const normalized = input.trim();
  if (!normalized) return "direct";

  const asksConceptQuestion = EXPLANATION_QUESTION_PATTERN.test(normalized);
  const requestsRequirementAnalysis =
    /(?:分析|拆解|评估|生成|输出|产出|整理|完善).{0,20}(?:这个|该|本|以下|上述)?(?:需求|功能分解|用户故事|验收标准|产品方案|开发排期|需求分析报告)|(?:完整分析|综合分析|功能分解|用户故事|验收标准|开发排期)/iu.test(
      normalized,
    );
  const proposesNewFeature =
    /(?:我想|我要|我们要|需要|希望|计划|帮我|请).{0,16}(?:做|开发|实现|新增|创建|设计|建设|改造|优化).{0,80}(?:功能|系统|模块|页面|接口|流程|能力|平台|应用|登录|注册|支付|订单|报表)/iu.test(
      normalized,
    ) ||
    /(?:我|我们)(?:需要|希望|想要).{0,12}(?:一个|一套|新增的?).{0,60}(?:功能|系统|模块|页面|接口|流程|能力|平台|应用)/iu.test(
      normalized,
    ) ||
    /^(?:请)?(?:开发|实现|新增|创建|建设|设计).{0,80}(?:功能|系统|模块|页面|接口|流程|能力|平台|应用)/iu.test(
      normalized,
    );
  const requestsKnowledgeBase =
    /(?:知识库|文档库|资料库|内部文档|上传的?文档|项目文档|项目资料|公司制度|公司规范|公司政策|业务规范|操作手册|产品手册|需求规范|需求标准|根据.{0,8}(?:文档|资料|知识库)|退换货政策|售后政策)/iu.test(
      normalized,
    );

  const queriesExistingRequirement =
    REQUIREMENT_ID_PATTERN.test(normalized) ||
    /(?:查询|查看|打开|获取|看看).{0,12}(?:已有|现有|历史)?(?:需求|需求单|工单|分析报告)|(?:需求|需求单|工单).{0,16}(?:状态|进度|详情|历史|报告|结果)/iu.test(
      normalized,
    );
  const containsNewRequirementBody =
    proposesNewFeature ||
    /(?:开发|实现|新增|创建|建设|设计).{0,80}(?:功能|系统|模块|页面|接口|流程|能力|平台|应用)/iu.test(
      normalized,
    );
  const explicitlyGeneratesAnalysis =
    /(?:生成|输出|产出|编写|整理).{0,16}(?:需求分析|分析报告|功能分解|用户故事|验收标准|开发排期)/iu.test(
      normalized,
    );

  if (
    requestsKnowledgeBase &&
    !REQUIREMENT_ID_PATTERN.test(normalized) &&
    !requestsRequirementAnalysis &&
    !proposesNewFeature
  ) {
    return "knowledge";
  }

  // “什么是需求分析/如何做需求分析”是通用概念问题，不应开启需求采集。
  if (
    asksConceptQuestion &&
    !REQUIREMENT_ID_PATTERN.test(normalized) &&
    !requestsRequirementAnalysis &&
    !proposesNewFeature
  ) {
    return "direct";
  }

  // 读取已有需求的动作优先于“需求分析”名词，除非输入同时提供了新需求正文
  // 或明确要求重新生成分析制品。
  if (
    queriesExistingRequirement &&
    !containsNewRequirementBody &&
    !explicitlyGeneratesAnalysis
  ) {
    return "requirement_query";
  }

  if (requestsRequirementAnalysis || proposesNewFeature) {
    return "requirement_analysis";
  }

  if (requestsKnowledgeBase) {
    return "knowledge";
  }

  // “什么是需求分析/如何做需求分析”是通用概念问题，不应开启需求采集。
  if (asksConceptQuestion) {
    return "direct";
  }

  return "direct";
}

/** 短句且不是解释性问题时，可以继承上一轮正在进行的需求澄清流程。 */
export function isRequirementFollowupAnswer(input: string): boolean {
  const normalized = input.trim();
  return (
    normalized.length > 0 &&
    normalized.length <= 100 &&
    !EXPLANATION_QUESTION_PATTERN.test(normalized)
  );
}

/** 只有明确的“创建新需求”命令才启动交互式 UI，概念问答不会误触发。 */
export function isUiRequirementFlowStart(input: string): boolean {
  return /^(?:(?:我|我们)?(?:要|想要|需要)?|请)?(?:提|新建|创建|提交)(?:一个|一条)?新需求(?:\s*[:：].*)?$/u.test(
    input.trim(),
  );
}
