import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Permissions } from "../auth/permissions.decorator";
import { PermissionsGuard } from "../auth/permissions.guard";
import { RolesService } from "./roles.service";

@Controller("api/roles")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @Permissions("roles:read")
  list() { return this.roles.list(); }

  @Get(":id")
  @Permissions("roles:read")
  find(@Param("id") id: string) { return this.roles.findById(id); }

  @Post()
  @Permissions("roles:create")
  create(@Body() body: Parameters<RolesService["create"]>[0]) { return this.roles.create(body); }

  @Patch(":id")
  @Permissions("roles:update")
  update(@Param("id") id: string, @Body() body: Parameters<RolesService["update"]>[1]) { return this.roles.update(id, body); }

  @Delete(":id")
  @Permissions("roles:delete")
  remove(@Param("id") id: string) { return this.roles.remove(id); }
}
