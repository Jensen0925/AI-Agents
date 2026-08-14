import { describe, expect, it } from "bun:test";
import { AxiosError, AxiosHeaders } from "axios";
import { apiErrorMessage } from "./api";

function createResponseError(
  data: { message?: string; traceId?: string },
  headers: Record<string, string> = {},
): AxiosError {
  return new AxiosError(
    "Request failed with status code 500",
    "ERR_BAD_RESPONSE",
    undefined,
    undefined,
    {
      data,
      status: 500,
      statusText: "Internal Server Error",
      headers: new AxiosHeaders(headers),
      config: { headers: new AxiosHeaders() },
    },
  );
}

describe("apiErrorMessage", () => {
  it("appends the trace id returned in the error payload", () => {
    const error = createResponseError({
      message: "服务端处理失败",
      traceId: "trace-body-1",
    });

    expect(apiErrorMessage(error)).toBe(
      "服务端处理失败（追踪 ID：trace-body-1）",
    );
  });

  it("falls back to the response header trace id", () => {
    const error = createResponseError(
      { message: "服务端处理失败" },
      { "x-trace-id": "trace-header-1" },
    );

    expect(apiErrorMessage(error)).toBe(
      "服务端处理失败（追踪 ID：trace-header-1）",
    );
  });
});
