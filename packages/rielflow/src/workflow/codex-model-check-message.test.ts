import { describe, expect, test } from "vitest";
import { buildCodexModelAvailabilityFailureMessage } from "./codex-model-check-message";

describe("buildCodexModelAvailabilityFailureMessage", () => {
  test("classifies subscription failures as account unusable", () => {
    const availability = {
      ok: false,
      model: "gpt-5-nano",
      auth: {
        ok: true,
        status: "Logged in using ChatGPT",
        error: null,
        exitCode: 0,
      },
      probe: {
        ok: false,
        model: "gpt-5-nano",
        output: null,
        error:
          "model gpt-5-nano is not enabled for this account because the subscription expired",
        exitCode: 1,
      },
    };

    expect(
      buildCodexModelAvailabilityFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        availability,
      }),
    ).toContain("account is not usable");
    expect(
      buildCodexModelAvailabilityFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        availability,
      }),
    ).toContain("subscription expired");
  });

  test("prefers structured probe errors from codex-agent model availability", () => {
    expect(
      buildCodexModelAvailabilityFailureMessage({
        model: "gpt-5-nano",
        accountReadiness: true,
        availability: {
          ok: false,
          model: "gpt-5-nano",
          auth: {
            ok: true,
            status: "Logged in using ChatGPT",
            error: null,
            exitCode: 0,
          },
          probe: {
            ok: false,
            model: "gpt-5-nano",
            output: "less useful output",
            error:
              "model gpt-5-nano is not enabled for this account because the subscription expired",
            exitCode: 1,
          },
        },
      }),
    ).toContain("subscription expired");
  });
});
