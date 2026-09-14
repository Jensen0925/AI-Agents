import { Module } from "@nestjs/common";
import { SecurityController } from "./security.controller";

/**
 * 安全运行时模块。
 *
 * 运行时本身是进程级单例（`securityRuntime`），所有业务代码直接按需引用，
 * 不需要 DI 传递；本模块只负责把管理端点注册进应用。
 */
@Module({
  controllers: [SecurityController],
})
export class SecurityModule {}
