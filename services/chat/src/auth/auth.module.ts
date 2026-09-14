import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { LoginThrottle } from "./login-throttle";
import { PermissionsGuard } from "./permissions.guard";

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    // 用工厂提供而不是让 Nest 反射构造：LoginThrottle 的构造参数是配置对象
    // 与时钟函数（为了可测试），反射会误判依赖类型。
    { provide: LoginThrottle, useFactory: () => new LoginThrottle() },
    JwtAuthGuard,
    PermissionsGuard,
  ],
  exports: [AuthService, JwtAuthGuard, PermissionsGuard],
})
export class AuthModule {}
