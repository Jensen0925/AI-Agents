"use client";

import { APP_NAME, type RequirementResult } from "@cloudsage/contracts";
import { Braces, LoaderCircle, Send, TriangleAlert } from "lucide-react";
import { type FormEvent, useState } from "react";

type RequestState = "idle" | "loading" | "success" | "error";

const DEFAULT_INPUT = "用户注册时必须绑定手机号，密码至少8位";

export default function Home() {
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [result, setResult] = useState<RequirementResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function extractRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("loading");
    setErrorMessage("");

    try {
      const response = await fetch("/api/requirement/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });

      if (!response.ok) {
        throw new Error(`请求失败，状态码 ${response.status}`);
      }

      const data = (await response.json()) as RequirementResult;
      setResult(data);
      setRequestState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "抽取请求失败");
      setRequestState("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark" aria-label={`${APP_NAME} requirement extractor`}>
          <Braces aria-hidden="true" />
          <span>{APP_NAME}</span>
        </div>
        <div className="environment">
          <span className="environment-dot" aria-hidden="true" />
          local workspace
        </div>
      </header>

      <main className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow">LangChain / structured output</p>
          <h1 id="page-title">需求结构化抽取</h1>
          <span className={`state state-${requestState}`}>{requestState}</span>
        </div>

        <div className="extractor">
          <form className="input-pane" onSubmit={extractRequirement}>
            <div className="pane-heading">
              <label htmlFor="requirement-input">需求输入</label>
              <span>{input.length} 字</span>
            </div>
            <textarea
              id="requirement-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={10}
              required
            />
            <button
              className="submit-button"
              type="submit"
              disabled={requestState === "loading" || input.trim().length === 0}
            >
              {requestState === "loading" ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Send aria-hidden="true" />
              )}
              {requestState === "loading" ? "抽取中" : "开始抽取"}
            </button>
          </form>

          <section className="output-pane" aria-live="polite" aria-atomic="true">
            <div className="pane-heading">
              <span>JSON 结果</span>
              <span>POST /requirement/extract</span>
            </div>
            {requestState === "error" ? (
              <div className="error-message">
                <TriangleAlert aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            ) : (
              <pre>{result ? JSON.stringify(result, null, 2) : "{}"}</pre>
            )}
          </section>
        </div>
      </main>

      <footer className="footer">
        <span>chat-web :3002</span>
        <span>chat :4001</span>
      </footer>
    </main>
  );
}
