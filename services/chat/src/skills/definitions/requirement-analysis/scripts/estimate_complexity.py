#!/usr/bin/env python3
import json
import sys


FACTOR_RULES = [
    ("集成对接", ["对接", "集成", "同步", "第三方", "接口"], 2),
    ("权限控制", ["权限", "角色", "鉴权", "租户"], 2),
    ("实时处理", ["实时", "异步", "消息", "队列", "通知"], 2),
    ("AI 能力", ["AI", "智能", "模型", "生成"], 3),
    ("安全要求", ["安全", "审计", "风控", "脱敏", "加密"], 3),
    ("批量处理", ["批量", "导入", "导出", "大文件", "Excel"], 2),
]


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    text = str(payload.get("requirementText", ""))
    tech_stack = str(payload.get("techStack", ""))
    corpus = f"{text}\n{tech_stack}"

    factors = []
    score = 0
    for name, keywords, weight in FACTOR_RULES:
        if any(keyword.lower() in corpus.lower() for keyword in keywords):
            factors.append({"name": name, "weight": weight})
            score += weight

    if score <= 2:
        size = "S"
        estimated_days = 2
    elif score <= 5:
        size = "M"
        estimated_days = 5
    elif score <= 8:
        size = "L"
        estimated_days = 10
    else:
        size = "XL"
        estimated_days = 15

    result = {
        "size": size,
        "estimatedDays": estimated_days,
        "complexityScore": score,
        "factors": factors,
    }
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
