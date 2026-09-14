import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import {
  type DocumentSearchResult,
  parseScope,
  type RetrievalScope,
  SearchService,
} from "./search.service";

interface SearchBody {
  query: string;
  topK: number;
  scope?: RetrievalScope;
}

/**
 * 检索接口响应。
 *
 * 保留 `results` 数组便于调用方遍历；`degraded` 专门用来区分「检索故障」与
 * 「确实没有结果」——两者的 results 都是空数组，只有前者会带此字段。
 */
export interface SearchResponse {
  results: DocumentSearchResult[];
  degraded?: string;
}

const MAX_QUERY_LENGTH = 20_000;
const MAX_TOP_K = 20;

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

@UseGuards(JwtAuthGuard)
@Controller("api/search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post()
  async search(
    @Req() request: AuthenticatedRequest,
    @Body() body: SearchBody,
  ): Promise<SearchResponse> {
    if (typeof body?.query !== "string" || body.query.trim().length === 0) {
      throw new BadRequestException("query must be a non-empty string");
    }
    if (body.query.trim().length > MAX_QUERY_LENGTH) {
      throw new BadRequestException(
        `query must not exceed ${MAX_QUERY_LENGTH} characters`,
      );
    }
    if (
      typeof body?.topK !== "number" ||
      !Number.isFinite(body.topK) ||
      body.topK < 1
    ) {
      throw new BadRequestException("topK must be a positive number");
    }

    let degraded: string | undefined;
    const results = await this.searchService.similaritySearch(
      body.query.trim(),
      currentUserId(request),
      Math.min(MAX_TOP_K, Math.floor(body.topK)),
      parseScope(body.scope),
      (reason) => {
        degraded ??= reason;
      },
    );

    return degraded ? { results, degraded } : { results };
  }
}
