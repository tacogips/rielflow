import { describe, expect, test } from "vitest";
import { parseClaudeAuthVerifyOutput } from "./claude-auth-verify-parse";

describe("parseClaudeAuthVerifyOutput", () => {
  test("accepts ready auth verify JSON", () => {
    expect(
      parseClaudeAuthVerifyOutput({
        ok: true,
        stdout: JSON.stringify({ ready: true, auth: { state: "configured" } }),
        stderr: "",
      }),
    ).toEqual({
      ok: true,
      message: "claude-code-agent authentication is valid",
    });
  });

  test("reports missing credentials from auth verify JSON", () => {
    expect(
      parseClaudeAuthVerifyOutput({
        ok: false,
        stdout: JSON.stringify({
          ready: false,
          auth: {
            state: "missing",
            available: false,
            message: "No stored Claude Code credentials were found.",
          },
        }),
        stderr: "",
      }),
    ).toEqual({
      ok: false,
      message: "No stored Claude Code credentials were found.",
    });
  });

  test("reports expired credentials from auth verify JSON", () => {
    expect(
      parseClaudeAuthVerifyOutput({
        ok: false,
        stdout: JSON.stringify({
          ready: false,
          auth: {
            state: "expired",
            available: false,
            message: "Stored credentials are expired.",
          },
        }),
        stderr: "",
      }),
    ).toEqual({
      ok: false,
      message: "Stored credentials are expired.",
    });
  });
});
