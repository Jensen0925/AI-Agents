"use client";

import { APP_NAME } from "@autix/contracts";
import { Check, LoaderCircle, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";

type RequestState = "idle" | "loading" | "success" | "error";

interface HelloResponse {
  message: string;
}

export default function Home() {
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("Ready for a round trip.");

  async function callChat() {
    setRequestState("loading");
    setMessage("Contacting Chat...");

    try {
      const response = await fetch("/api/hello");

      if (!response.ok) {
        throw new Error(`Chat responded with status ${response.status}`);
      }

      const data = (await response.json()) as HelloResponse;
      setMessage(data.message);
      setRequestState("success");
    } catch {
      setMessage("Chat service is unavailable.");
      setRequestState("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="wordmark" aria-label={`${APP_NAME} home`}>
          {APP_NAME}
        </div>
        <div className="environment">
          <span className="environment-dot" aria-hidden="true" />
          local workspace
        </div>
      </header>

      <section className="workspace" aria-labelledby="page-title">
        <div className="intro">
          <p className="eyebrow">Shared contract / live service</p>
          <h1 id="page-title">{APP_NAME}</h1>
          <p className="lede">
            One request from the browser, through the web app, to the Chat API.
          </p>
        </div>

        <div className="console">
          <div className="console-heading">
            <div>
              <p className="console-label">Chat service</p>
              <p className="endpoint">GET /hello</p>
            </div>
            <span className={`state state-${requestState}`}>{requestState}</span>
          </div>

          <div className="response" aria-live="polite" aria-atomic="true">
            {requestState === "loading" && (
              <LoaderCircle className="response-icon spin" aria-hidden="true" />
            )}
            {requestState === "success" && (
              <Check className="response-icon success-icon" aria-hidden="true" />
            )}
            {requestState === "error" && (
              <TriangleAlert className="response-icon error-icon" aria-hidden="true" />
            )}
            <p>{message}</p>
          </div>

          <button
            className="call-button"
            type="button"
            onClick={callChat}
            disabled={requestState === "loading"}
          >
            <Send aria-hidden="true" />
            {requestState === "loading" ? "Calling Chat" : "Call Chat service"}
          </button>
        </div>
      </section>

      <footer className="footer">
        <span>chat-web :3002</span>
        <span>chat :4001</span>
      </footer>
    </main>
  );
}
