import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRequirementAnalysisDataset } from "../eval/dataset-loader";

async function writeDataset(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "autix-eval-"));
  const path = join(directory, "dataset.jsonl");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("第十七章 Golden Dataset Loader", () => {
  it("加载 JSONL，并保留检索与生成评测所需字段", async () => {
    const path = await writeDataset(`
# 允许注释行
{"id":"req-1","input":"分析登录需求","tags":["analysis"],"expectedIntent":"analyze","relevantChunkIds":["chunk-1"],"groundTruth":"需要登录"}
`);

    await expect(loadRequirementAnalysisDataset(path)).resolves.toEqual([
      {
        id: "req-1",
        input: "分析登录需求",
        tags: ["analysis"],
        expectedIntent: "analyze",
        relevantChunkIds: ["chunk-1"],
        groundTruth: "需要登录",
      },
    ]);
  });

  it("用行号报告不合法的 golden case", async () => {
    const path = await writeDataset(`
{"id":"req-1","input":"有效","tags":[]}
{"id":"req-2","input":"无效","tags":[],"expectedIntent":"unknown"}
`);

    await expect(loadRequirementAnalysisDataset(path)).rejects.toThrow(
      "评测数据第 3 行的 expectedIntent 不合法",
    );
  });
});
