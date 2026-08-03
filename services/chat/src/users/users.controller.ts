import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { type AuthenticatedRequest, JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Permissions } from "../auth/permissions.decorator";
import { PermissionsGuard } from "../auth/permissions.guard";
import { UsersService } from "./users.service";

@Controller("api/users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions("users:read")
  list(@Query("q") q?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.users.list(q, Number(page), Number(pageSize));
  }

  @Get("me")
  @Permissions("profile:read")
  me(@Req() request: AuthenticatedRequest) {
    return this.users.findById(request.user!.userId);
  }

  @Get(":id")
  @Permissions("users:read")
  find(@Param("id") id: string) {
    return this.users.findById(id);
  }

  @Post()
  @Permissions("users:create")
  create(@Body() body: Parameters<UsersService["create"]>[0]) {
    return this.users.create(body);
  }

  @Patch("me")
  @Permissions("profile:update")
  updateMe(@Req() request: AuthenticatedRequest, @Body() body: { name?: string }) {
    if (!body.name?.trim()) throw new BadRequestException("name is required");
    return this.users.updateProfile(request.user!.userId, body);
  }

  @Patch(":id")
  @Permissions("users:update")
  update(@Param("id") id: string, @Body() body: Parameters<UsersService["update"]>[1]) {
    return this.users.update(id, body);
  }

  @Delete(":id")
  @Permissions("users:delete")
  remove(@Param("id") id: string) {
    return this.users.remove(id);
  }
}
