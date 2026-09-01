import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "../auth/jwt-auth.guard";
import { CategoryService, type UserCategory } from "./category.service";

function currentUserId(request: AuthenticatedRequest): string {
  if (!request.user) {
    throw new BadRequestException("Authenticated user is unavailable");
  }

  return request.user.userId;
}

@UseGuards(JwtAuthGuard)
@Controller("api/categories")
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  /** 当前账号的自定义分类，内置分类不在此列。 */
  @Get()
  list(@Req() request: AuthenticatedRequest): Promise<UserCategory[]> {
    return this.categoryService.list(currentUserId(request));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Req() request: AuthenticatedRequest,
    @Body("name") name?: string,
  ): Promise<UserCategory> {
    if (typeof name !== "string") {
      throw new BadRequestException("name must be a string");
    }

    return this.categoryService.create(currentUserId(request), name);
  }

  /** 删除后，原归属该分类的文档会回落到内置分类，返回值给出受影响数量。 */
  @Delete(":id")
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ): Promise<{ reassigned: number }> {
    return this.categoryService.remove(currentUserId(request), id);
  }
}
