import { describe, expect, test } from "vitest";
import { createSessionId, isSafeSessionId } from "./session";

describe("createSessionId", () => {
  test("uses riel-workflowId-unixtime-hash format for workflow executions", () => {
    const sessionId = createSessionId({
      workflowId: "demo-workflow",
      now: new Date("2026-03-25T12:34:56.000Z"),
    });

    expect(sessionId).toMatch(/^riel-demo-workflow-1774442096-[a-f0-9]{8}$/);
    expect(isSafeSessionId(sessionId)).toBe(true);
  });

  test("sanitizes workflow ids for session-safe filenames", () => {
    const sessionId = createSessionId({
      workflowId: " Demo workflow/with spaces ",
      now: new Date("2026-03-25T12:34:56.000Z"),
    });

    expect(sessionId).toMatch(
      /^riel-Demo-workflow-with-spaces-1774442096-[a-f0-9]{8}$/,
    );
    expect(isSafeSessionId(sessionId)).toBe(true);
  });
});
