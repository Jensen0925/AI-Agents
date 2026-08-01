import type { RequirementResult } from "@cloudsage/contracts";
import { Controller, Logger, Post, Res } from "@nestjs/common";
import {
  LANGCHAIN_USER_INPUT,
  LlmService,
  type BatchResult,
  type InvokeResult,
  type PromptPreviewResult,
  type ToolBindResult,
  type ToolLoopResult,
} from "./llm.service";
import { RequirementService } from "./requirement.service";

interface StreamingResponse {
  setHeader(name: string, value: string): void;
  flushHeaders?(): void;
  write(chunk: string): boolean;
  end(): void;
}

@Controller("api/langchain")
export class LlmController {
  private readonly logger = new Logger(LlmController.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly requirementService: RequirementService,
  ) {}

  private async writeStream(
    response: StreamingResponse,
    stream: AsyncIterable<string>,
    errorMessage: string,
  ): Promise<void> {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    try {
      for await (const chunk of stream) {
        response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      response.write(`event: done\ndata: {}\n\n`);
    } catch (error) {
      this.logger.error(errorMessage, error);
      response.write(
        `event: error\ndata: ${JSON.stringify({ message: errorMessage })}\n\n`,
      );
    } finally {
      response.end();
    }
  }

  @Post("invoke")
  invoke(): Promise<InvokeResult> {
    return this.llmService.invoke();
  }

  @Post("stream")
  stream(@Res() response: StreamingResponse): Promise<void> {
    // POST 路由使用 SSE 帧逐块写回，同时保留统一的 Controller 路径。
    return this.writeStream(
      response,
      this.llmService.stream(),
      "LangChain stream failed",
    );
  }

  @Post("batch")
  batch(): Promise<BatchResult> {
    return this.llmService.batch();
  }

  @Post("prompt-preview")
  promptPreview(): Promise<PromptPreviewResult> {
    return this.llmService.promptPreview();
  }

  @Post("prompt-to-model")
  promptToModel(): Promise<InvokeResult> {
    return this.llmService.promptToModel();
  }

  @Post("chain-invoke")
  chainInvoke(): Promise<InvokeResult> {
    return this.llmService.chainInvoke();
  }

  @Post("chain-stream")
  chainStream(@Res() response: StreamingResponse): Promise<void> {
    return this.writeStream(
      response,
      this.llmService.chainStream(),
      "LangChain chain stream failed",
    );
  }

  @Post("chain-batch")
  chainBatch(): Promise<BatchResult> {
    return this.llmService.chainBatch();
  }

  @Post("structured")
  structured(): Promise<RequirementResult> {
    return this.requirementService.extract(LANGCHAIN_USER_INPUT);
  }

  @Post("tool-bind")
  toolBind(): Promise<ToolBindResult> {
    return this.llmService.toolBind();
  }

  @Post("tool-loop")
  toolLoop(): Promise<ToolLoopResult> {
    return this.llmService.toolLoop();
  }
}
