import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import {
  type OrchestrationResult,
  OrchestratorService,
} from "./agents/orchestrator.service";
import { EmbeddingService } from "./embedding/embedding.service";
import {
  type VectorSearchResult,
  VectorStoreService,
} from "./embedding/vector-store.service";
import {
  type FilesystemChatResult,
  FilesystemService,
} from "./filesystem/filesystem.service";
import {
  type MemoryChatResult,
  type MemoryHistoryMessage,
  RunnableMemoryService,
} from "./memory/runnable-memory.service";

interface MemoryChatBody {
  sessionId: string;
  input: string;
}

interface FilesystemChatBody {
  input: string;
}

interface EmbedBody {
  text: string;
}

interface StoreBody {
  texts: string[];
}

interface SearchBody {
  query: string;
  k: number;
}

interface OrchestrateBody {
  input: string;
}


function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  return value.trim();
}

@Controller("api/memory")
export class MemoryController {
  constructor(private readonly memoryService: RunnableMemoryService) {}

  @Post("chat")
  chat(@Body() body: MemoryChatBody): Promise<MemoryChatResult> {
    const sessionId = requireText(body?.sessionId, "sessionId");
    const input = requireText(body?.input, "input");
    return this.memoryService.chat(sessionId, input);
  }

  @Get("history/:sessionId")
  async getHistory(@Param("sessionId") rawSessionId: string): Promise<{
    sessionId: string;
    messages: MemoryHistoryMessage[];
  }> {
    const sessionId = requireText(rawSessionId, "sessionId");
    return {
      sessionId,
      messages: await this.memoryService.getHistory(sessionId),
    };
  }

  @Delete("history/:sessionId")
  async clearHistory(
    @Param("sessionId") rawSessionId: string,
  ): Promise<{ ok: true; sessionId: string }> {
    const sessionId = requireText(rawSessionId, "sessionId");
    await this.memoryService.clearSession(sessionId);
    return { ok: true, sessionId };
  }
}

@Controller("api/files")
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  @Post("chat")
  chat(@Body() body: FilesystemChatBody): Promise<FilesystemChatResult> {
    return this.filesystemService.chat(requireText(body?.input, "input"));
  }
}

@Controller("api/embedding")
export class EmbeddingController {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  @Post("embed")
  async embed(@Body() body: EmbedBody): Promise<{
    text: string;
    dimension: number;
    vector: number[];
  }> {
    const text = requireText(body?.text, "text");
    const vector = await this.embeddingService.embedQuery(text);
    return { text, dimension: vector.length, vector };
  }

  @Post("store")
  async store(@Body() body: StoreBody): Promise<{ count: number }> {
    if (
      !Array.isArray(body?.texts) ||
      body.texts.length === 0 ||
      body.texts.some((text) => typeof text !== "string" || text.trim() === "")
    ) {
      throw new BadRequestException("texts must be a non-empty string array");
    }

    const texts = body.texts.map((text) => text.trim());
    return { count: await this.vectorStoreService.addTexts(texts) };
  }

  @Post("search")
  async search(@Body() body: SearchBody): Promise<{
    query: string;
    k: number;
    results: VectorSearchResult[];
  }> {
    const query = requireText(body?.query, "query");
    if (
      typeof body?.k !== "number" ||
      !Number.isFinite(body.k) ||
      body.k < 1
    ) {
      throw new BadRequestException("k must be a positive number");
    }

    const k = Math.min(20, Math.floor(body.k));
    return {
      query,
      k,
      results: await this.vectorStoreService.search(query, k),
    };
  }
}

@Controller("api/agents")
export class AgentsController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post("orchestrate")
  orchestrate(@Body() body: OrchestrateBody): Promise<OrchestrationResult> {
    return this.orchestratorService.orchestrate(
      requireText(body?.input, "input"),
    );
  }
}
