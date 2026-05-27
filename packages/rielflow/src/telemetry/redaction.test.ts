import { describe, expect, test } from "vitest";
import {
  messagePayloadTelemetryAttributes,
  sanitizeTelemetryAttributes,
} from "./redaction";

describe("telemetry redaction", () => {
  test("redacts secret-like keys and bearer values", () => {
    expect(
      sanitizeTelemetryAttributes({
        authorization: "Bearer abc123",
        message: "send Bearer token-value",
        count: 2,
      }),
    ).toEqual({
      authorization: "[redacted]",
      message: "send Bearer [redacted]",
      count: 2,
    });
  });

  test("exports message metadata only by default", () => {
    expect(
      messagePayloadTelemetryAttributes({
        key: "workflow.message",
        value: { token: "secret-value" },
        exportMessages: false,
      }),
    ).toEqual({ "workflow.message.bytes": 24 });
  });

  test("exports redacted message bodies only with opt-in", () => {
    expect(
      messagePayloadTelemetryAttributes({
        key: "workflow.message",
        value: { authorization: "Bearer abc123" },
        exportMessages: true,
      })["workflow.message"],
    ).toContain("Bearer [redacted]");
  });
});
