import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from "./jwt-auth.guard";
import { AuthService } from "./auth.service";

interface CredentialsBody {
  email?: string;
  password?: string;
}

interface RefreshBody {
  refreshToken?: string;
}

@Controller("api/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: CredentialsBody) {
    if (!body.email || !body.password) {
      throw new BadRequestException("email and password are required");
    }
    return this.authService.login(body.email.trim().toLowerCase(), body.password);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshBody) {
    if (!body.refreshToken) throw new BadRequestException("refreshToken is required");
    return this.authService.refresh(body.refreshToken);
  }

  @Post("logout")
  logout(@Body() body: RefreshBody) {
    return body.refreshToken
      ? this.authService.logout(body.refreshToken)
      : undefined;
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
