import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ComponentRenderer } from "./ComponentRenderer";
import type { UIResponse } from "@/types/ui-types";

const noop = () => undefined;

const cases: Array<{ component: UIResponse; expected: string }> = [
  {
    component: { type: "text", content: "纯文本回复", markdown: true },
    expected: "纯文本回复",
  },
  {
    component: {
      type: "selection",
      title: "选择需求类型",
      options: [{ label: "功能需求", value: "functional" }],
    },
    expected: "选择需求类型",
  },
  {
    component: {
      type: "form",
      title: "填写需求详情",
      fields: [{ name: "title", label: "需求标题", type: "input" }],
    },
    expected: "填写需求详情",
  },
  {
    component: {
      type: "confirmation",
      title: "确认提交",
      summary: "将提交需求分析",
    },
    expected: "确认提交",
  },
  {
    component: {
      type: "card",
      title: "需求详情",
      fields: [{ label: "状态", value: "处理中" }],
    },
    expected: "需求详情",
  },
  {
    component: {
      type: "steps",
      title: "分析进度",
      current: 0,
      steps: [{ key: "extract", label: "抽取需求", status: "current" }],
    },
    expected: "分析进度",
  },
  {
    component: {
      type: "table",
      title: "验收标准",
      columns: [{ key: "name", label: "名称" }],
      rows: [{ name: "可导入 Excel" }],
    },
    expected: "验收标准",
  },
  {
    component: {
      type: "action_buttons",
      title: "后续操作",
      buttons: [{ label: "查看报告", action: "view_report" }],
    },
    expected: "后续操作",
  },
];

describe("ComponentRenderer", () => {
  it.each(cases)("renders the $component.type mapping", ({ component, expected }) => {
    const html = renderToStaticMarkup(
      <ComponentRenderer component={component} onAction={noop} />,
    );

    expect(html).toContain(expected);
  });
});
