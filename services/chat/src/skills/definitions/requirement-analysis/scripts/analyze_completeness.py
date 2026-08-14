#!/usr/bin/env python3
import json
import sys


KEYWORDS = {
    "用户角色": ["用户", "管理员", "运营", "客服", "角色", "租户"],
    "功能描述": ["支持", "实现", "导入", "导出", "创建", "编辑", "删除", "查看"],
    "验收标准": ["验收", "成功", "失败", "校验", "提示", "结果"],
    "优先级": ["优先级", "紧急", "P0", "P1", "高优先级", "低优先级"],
    "非功能需求": ["性能", "并发", "安全", "权限", "审计", "可用性", "稳定性"],
    "边界条件": ["异常", "重复", "为空", "上限", "失败", "边界", "回滚"],
}


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    text = str(payload.get("requirementText", ""))
    covered = []
    missing = []

    for dimension, keywords in KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            covered.append(dimension)
        else:
            missing.append(dimension)

    score = round(len(covered) / len(KEYWORDS) * 100)
    suggestion = (
        "建议优先补充：" + "、".join(missing)
        if missing
        else "需求六个维度覆盖较完整，可以进入详细方案设计。"
    )

    result = {
        "completenessScore": score,
        "coveredDimensions": covered,
        "missingDimensions": missing,
        "suggestion": suggestion,
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
