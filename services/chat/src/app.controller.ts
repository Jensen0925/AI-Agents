import { APP_NAME, type RequirementResult } from "@cloudsage/contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { RequirementService } from "./llm/requirement.service";

interface ExtractRequirementBody {
  input: string;
}

@Controller()
export class AppController {
  constructor(private readonly requirementService: RequirementService) {}

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

  @Post("requirement/extract")
  @UseGuards(JwtAuthGuard)
  extractRequirement(
    @Body() body: ExtractRequirementBody,
  ): Promise<RequirementResult> {
    if (typeof body?.input !== "string" || body.input.trim().length === 0) {
      throw new BadRequestException("input must be a non-empty string");
    }

    const input = body.input.trim();
    if (input.length > 20_000) {
      throw new BadRequestException("input must not exceed 20000 characters");
    }
    return this.requirementService.extract(input);
  }
}
