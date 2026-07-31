import { APP_NAME, type RequirementResult } from "@autix/contracts";
import { BadRequestException, Body, Controller, Get, Post } from "@nestjs/common";
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
  extractRequirement(
    @Body() body: ExtractRequirementBody,
  ): Promise<RequirementResult> {
    if (typeof body?.input !== "string" || body.input.trim().length === 0) {
      throw new BadRequestException("input must be a non-empty string");
    }

    return this.requirementService.extract(body.input.trim());
  }
}
