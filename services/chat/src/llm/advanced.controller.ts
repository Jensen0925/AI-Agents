import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
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


const MAX_TEXT_LENGTH = 20_000;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} must be a non-empty string`);
  }

  if (value.trim().length > MAX_TEXT_LENGTH) {
    throw new BadRequestException(
      `${field} must not exceed ${MAX_TEXT_LENGTH} characters`,
    );
  }

  return value.trim();
}

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }
  return request.user.userId;
}

function scopedSessionId(userId: string, sessionId: string): string {
  return `${userId}:${sessionId}`;
}

@Controller("api/memory")
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(private readonly memoryService: RunnableMemoryService) {}

  @Post("chat")
  chat(
    @Req() request: AuthenticatedRequest,
    @Body() body: MemoryChatBody,
  ): Promise<MemoryChatResult> {
    const sessionId = requireText(body?.sessionId, "sessionId");
    const input = requireText(body?.input, "input");
    return this.memoryService.chat(
      scopedSessionId(currentUserId(request), sessionId),
      input,
    );
  }

  @Get("history/:sessionId")
  async getHistory(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") rawSessionId: string,
  ): Promise<{
    sessionId: string;
    messages: MemoryHistoryMessage[];
  }> {
    const sessionId = requireText(rawSessionId, "sessionId");
    return {
      sessionId,
      messages: await this.memoryService.getHistory(
        scopedSessionId(currentUserId(request), sessionId),
      ),
    };
  }

  @Delete("history/:sessionId")
  async clearHistory(
    @Req() request: AuthenticatedRequest,
    @Param("sessionId") rawSessionId: string,
  ): Promise<{ ok: true; sessionId: string }> {
    const sessionId = requireText(rawSessionId, "sessionId");
    await this.memoryService.clearSession(
      scopedSessionId(currentUserId(request), sessionId),
    );
    return { ok: true, sessionId };
  }
}

@Controller("api/files")
@UseGuards(JwtAuthGuard)
export class FilesystemController {
  constructor(private readonly filesystemService: FilesystemService) {}

  @Post("chat")
  chat(
    @Req() request: AuthenticatedRequest,
    @Body() body: FilesystemChatBody,
  ): Promise<FilesystemChatResult> {
    return this.filesystemService.chat(
      requireText(body?.input, "input"),
      currentUserId(request),
    );
  }
}

@Controller("api/embedding")
@UseGuards(JwtAuthGuard)
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
  async store(
    @Req() request: AuthenticatedRequest,
    @Body() body: StoreBody,
  ): Promise<{ count: number }> {
    if (
      !Array.isArray(body?.texts) ||
      body.texts.length === 0 ||
      body.texts.length > 100 ||
      body.texts.some(
        (text) =>
          typeof text !== "string" ||
          text.trim() === "" ||
          text.trim().length > MAX_TEXT_LENGTH,
      )
    ) {
      throw new BadRequestException(
        "texts must contain 1-100 non-empty strings of at most 20000 characters",
      );
    }

    const texts = body.texts.map((text) => text.trim());
    return {
      count: await this.vectorStoreService.addTexts(
        texts,
        currentUserId(request),
      ),
    };
  }

  @Post("search")
  async search(
    @Req() request: AuthenticatedRequest,
    @Body() body: SearchBody,
  ): Promise<{
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
      results: await this.vectorStoreService.search(
        query,
        k,
        currentUserId(request),
      ),
    };
  }
}

@Controller("api/agents")
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly orchestratorService: OrchestratorService) {}

  @Post("orchestrate")
  orchestrate(@Body() body: OrchestrateBody): Promise<OrchestrationResult> {
    return this.orchestratorService.orchestrate(
      requireText(body?.input, "input"),
    );
  }
}
