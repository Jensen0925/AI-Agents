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
  SearchService,
} from "./search.service";

interface SearchBody {
  query: string;
  topK: number;
}

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
  search(
    @Req() request: AuthenticatedRequest,
    @Body() body: SearchBody,
  ): Promise<DocumentSearchResult[]> {
    if (typeof body?.query !== "string" || body.query.trim().length === 0) {
      throw new BadRequestException("query must be a non-empty string");
    }
    if (
      typeof body?.topK !== "number" ||
      !Number.isFinite(body.topK) ||
      body.topK < 1
    ) {
      throw new BadRequestException("topK must be a positive number");
    }

    return this.searchService.similaritySearch(
      body.query.trim(),
      currentUserId(request),
      Math.floor(body.topK),
    );
  }
}
