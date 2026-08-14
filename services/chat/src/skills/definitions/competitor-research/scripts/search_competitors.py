#!/usr/bin/env python3
import json
import sys


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    query = str(payload.get("query", ""))
    domain = str(payload.get("domain", "通用"))
    results = [
        {
            "title": f"{query} Competitor A",
            "snippet": f"{domain}场景下提供模板生成、知识库引用和团队协作。",
            "url": "https://example.com/competitor-a",
        },
        {
            "title": f"{query} Competitor B",
            "snippet": "突出 AI 辅助写作、改写和多渠道发布能力。",
            "url": "https://example.com/competitor-b",
        },
        {
            "title": f"{query} Competitor C",
            "snippet": "强调工作流编排、审批与品牌风格控制。",
            "url": "https://example.com/competitor-c",
        },
    ]
    sys.stdout.write(json.dumps({"results": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
