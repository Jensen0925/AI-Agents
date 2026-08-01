import { describe, expect, it, mock } from "bun:test";
import type { RequirementResult } from "@cloudsage/contracts";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { AppController } from "../src/app.controller";
import type { RequirementService } from "../src/llm/requirement.service";

const INPUT = "用户注册时必须绑定手机号，密码至少8位";

describe("AppController requirement extraction", () => {
  it("exposes POST /requirement/extract", () => {
    const handler = AppController.prototype.extractRequirement;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      "requirement/extract",
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
  });

  it("passes the request input to RequirementService", async () => {
    const expected: RequirementResult = {
      action: "绑定手机号",
      constraints: ["必须绑定手机号", "密码至少8位"],
      entities: ["用户", "手机号", "密码"],
    };
    const extract = mock(async () => expected);
    const requirementService = { extract } as unknown as RequirementService;
    const controller = new AppController(requirementService);

    await expect(controller.extractRequirement({ input: INPUT })).resolves.toEqual(
      expected,
    );
    expect(extract).toHaveBeenCalledWith(INPUT);
  });

  it("rejects an empty input before calling the model", () => {
    const extract = mock(async () => ({}) as RequirementResult);
    const requirementService = { extract } as unknown as RequirementService;
    const controller = new AppController(requirementService);

    expect(() => controller.extractRequirement({ input: "   " })).toThrow(
      "input must be a non-empty string",
    );
    expect(extract).not.toHaveBeenCalled();
  });
});
