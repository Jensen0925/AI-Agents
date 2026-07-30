import { APP_NAME } from "@autix/contracts";
import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health(): { ok: true } {
    return { ok: true };
  }

  @Get("hello")
  hello(): { message: string } {
    return {
      message: `Hello from Chat, shared APP_NAME=${APP_NAME}`,
    };
  }
}
