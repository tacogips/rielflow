import { describe, expect, test } from "vitest";
import {
  buildCodexModelCheckFailureMessage,
  parseCodexLoginStatus,
} from "./codex-auth-verify-parse";

describe("parseCodexLoginStatus", () => {
  test("reports authentication failure from non-zero exit", () => {
    expect(
      parseCodexLoginStatus({
        ok: false,
        stdout: "",
        stderr: "not logged in",
        message: "not logged in",
      }),
    ).toMatchObject({
      ok: false,
      message: "not logged in",
    });
  });

  test("treats Not logged in output as unauthenticated even with exit code 0", () => {
    expect(
      parseCodexLoginStatus({
        ok: true,
        stdout: "Not logged in\n",
        stderr: "",
      }),
    ).toEqual({
      ok: false,
      status: "Not logged in",
      message: "Not logged in",
    });
  });

  test("accepts logged-in status output", () => {
    expect(
      parseCodexLoginStatus({
        ok: true,
        stdout: "Logged in using ChatGPT\n",
        stderr: "",
      }),
    ).toMatchObject({
      ok: true,
      status: "Logged in using ChatGPT",
    });
  });
});

describe("buildCodexModelCheckFailureMessage", () => {
  test("classifies subscription failures as account unusable", () => {
    expect(
      buildCodexModelCheckFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        result: {
          ok: false,
          stdout: "",
          stderr:
            "model gpt-5-nano is not enabled for this account because the subscription expired",
          message:
            "model gpt-5-nano is not enabled for this account because the subscription expired",
        },
      }),
    ).toContain("account is not usable");
    expect(
      buildCodexModelCheckFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        result: {
          ok: false,
          stdout: "",
          stderr:
            "model gpt-5-nano is not enabled for this account because the subscription expired",
          message:
            "model gpt-5-nano is not enabled for this account because the subscription expired",
        },
      }),
    ).toContain("subscription expired");
  });

  test("prefers structured JSON probe errors from codex-agent model check output", () => {
    expect(
      buildCodexModelCheckFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        result: {
          ok: false,
          stdout: JSON.stringify({
            ok: false,
            probe: {
              error:
                "model gpt-5-nano is not enabled for this account because the subscription expired",
            },
          }),
          stderr: "",
        },
      }),
    ).toContain("subscription expired");
  });
});
