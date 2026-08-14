#!/usr/bin/env python3
import json
import sys


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    topic = str(payload.get("topic", ""))
    industry = str(payload.get("industry", "通用"))
    practices = [
        f"{topic} 在 {industry} 场景中通常采用模板库 + 知识库检索的组合模式。",
        f"{topic} 通常需要保留人工复核环节，避免 AI 内容直接发布。",
        f"{topic} 的优秀方案通常支持版本管理、协作批注和效果反馈闭环。",
    ]
    sys.stdout.write(json.dumps({"results": practices}, ensure_ascii=False))


if __name__ == "__main__":
    main()
