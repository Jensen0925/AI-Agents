import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Permissions } from "../auth/permissions.decorator";
import { PermissionsGuard } from "../auth/permissions.guard";
import { securityRuntime } from "./security-runtime";

interface KillSwitchBody {
  reason?: string;
}

/**
 * 安全运行时管理端点。
 *
 * 暴露 `securityRuntime` 的可运维面：事故中一键停掉 Agent 的模型调用，
 * 以及查询审计事件、查看当前配额与紧急停止状态。
 */
@Controller("api/security")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecurityController {
  @Get("status")
  @Permissions("security:read")
  status() {
    return securityRuntime.getStatus();
  }

  /** 最近的安全审计事件；支持按事件类型过滤。 */
  @Get("audit")
  @Permissions("security:read")
  audit() {
    return securityRuntime.audit.query({ limit: 200 });
  }

  @Post("kill")
  @Permissions("security:manage")
  kill(@Body() body: KillSwitchBody) {
    const reason = body?.reason?.trim();
    if (!reason) {
      throw new BadRequestException("reason must be a non-empty string");
    }
    securityRuntime.kill(reason);
    return securityRuntime.getStatus();
  }

  @Post("restore")
  @Permissions("security:manage")
  restore() {
    securityRuntime.restore();
    return securityRuntime.getStatus();
  }
}
