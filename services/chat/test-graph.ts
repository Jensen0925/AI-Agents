import {
  runAnalysisGraph,
  type RunAnalysisGraphOutput,
} from "./src/llm/graph/requirement-analysis-graph";

type GraphCase = {
  name: string;
  input: string;
  validate: (result: RunAnalysisGraphOutput, elapsedMs: number) => string[];
};

const cases: GraphCase[] = [
  {
    name: "Case 1 完整需求分析",
    input:
      "分析需求 REQ-20240315-001：开发在线问卷系统，支持多种题型和结果统计",
    validate: (result) => {
      const errors: string[] = [];
      if (result.intent !== "analyze") errors.push("intent 不是 analyze");
      if (!result.extracted) errors.push("extracted 为空");
      if (!result.clarified) errors.push("clarified 为空");
      if (!result.analysisResult) errors.push("analysisResult 为空");
      if (!result.riskResult) errors.push("riskResult 为空");
      if (!result.summary) errors.push("summary 为空");
      return errors;
    },
  },
  {
    name: "Case 2 需求状态查询",
    input: "查询 REQ-20240315-001 的当前状态",
    validate: (result) => {
      const errors: string[] = [];
      if (result.intent !== "query") errors.push("intent 不是 query");
      if (!result.queryResponse) errors.push("queryResponse 为空");
      if (result.extracted !== undefined) errors.push("不应执行 extracted");
      if (result.analysisResult !== undefined) {
        errors.push("不应执行 analysisResult");
      }
      if (result.riskResult !== undefined) errors.push("不应执行 riskResult");
      return errors;
    },
  },
  {
    name: "Case 3 普通闲聊",
    input: "你好，今天天气不错",
    validate: (result, elapsedMs) => {
      const errors: string[] = [];
      if (result.intent !== "chat") errors.push("intent 不是 chat");
      if (!result.chatResponse) errors.push("chatResponse 为空");
      if (elapsedMs >= 5_000) errors.push(`响应耗时 ${elapsedMs}ms，超过 5 秒`);
      if (result.steps.includes("extractStep")) {
        errors.push("闲聊不应触发需求分析节点");
      }
      return errors;
    },
  },
  {
    name: "Case 4 模糊意图",
    input: "看看 REQ-20240315-001 有没有什么问题",
    validate: (result) =>
      result.intent === "analyze" || result.intent === "query"
        ? []
        : ["intent 未能确定为 analyze 或 query"],
  },
  {
    name: "Case 5 带编号的查询",
    input: "REQ-20240415-002 的进度如何",
    validate: (result) =>
      result.intent === "query" ? [] : ["需求编号优先级未判为 query"],
  },
  {
    name: "Case 6 简短需求",
    input: "我需要一个用户登录功能",
    validate: (result) => {
      const errors: string[] = [];
      if (result.intent !== "analyze") errors.push("intent 不是 analyze");
      if (!result.extracted) errors.push("extracted 为空");
      if (!result.analysisResult) errors.push("analysisResult 为空");
      return errors;
    },
  },
  {
    name: "Case 7 多重含义",
    input: "查询 REQ-20240315-001 的风险分析报告",
    validate: (result) =>
      result.intent === "query"
        ? []
        : ["查询需求报告应优先判为 query"],
  },
];

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`执行超过 ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  let passed = 0;

  for (const testCase of cases) {
    const startedAt = performance.now();

    try {
      const result = await withTimeout(runAnalysisGraph(testCase.input), 60_000);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const errors = testCase.validate(result, elapsedMs);

      if (errors.length === 0) {
        passed += 1;
        console.log(
          `✅ ${testCase.name} | intent=${result.intent} | ${elapsedMs}ms | steps=${result.steps.join(" → ")}`,
        );
      } else {
        console.error(
          `❌ ${testCase.name} | intent=${result.intent} | ${elapsedMs}ms | ${errors.join("；")}`,
        );
      }
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ ${testCase.name} | ${elapsedMs}ms | ${message}`);
    }
  }

  console.log(`\n结果：${passed}/${cases.length} 通过`);
  if (passed < 6) {
    process.exitCode = 1;
  }
}

void main();
