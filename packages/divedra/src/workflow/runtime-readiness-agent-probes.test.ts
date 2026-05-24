import { afterEach, describe, expect, test } from "vitest";
import { mockAgentCliCommands } from "./runtime-readiness-agent-probes-test-helpers";
import { probeAgentBackendAuthReadiness } from "./runtime-readiness-agent-probes";

const mocks: Array<{ restore: () => void }> = [];

afterEach(() => {
  for (const mock of mocks.splice(0)) {
    mock.restore();
  }
});

const codexCandidate = {
  backend: "codex-agent" as const,
  models: new Set(["gpt-5-nano"]),
  nodeIds: ["worker"],
  stepIds: ["worker"],
};

const claudeCandidate = {
  backend: "claude-code-agent" as const,
  models: new Set(["claude-sonnet-4-20250514"]),
  nodeIds: ["manager"],
  stepIds: ["manager"],
};

describe("probeAgentBackendAuthReadiness", () => {
  test("reports invalid codex authentication from login status probe", async () => {
    mocks.push(
      mockAgentCliCommands({
        codex: (args) => {
          if (args[0] === "login" && args[1] === "status") {
            return {
              ok: false,
              stdout: "",
              stderr: "not logged in",
              message: "not logged in",
            };
          }
          return {
            ok: false,
            stdout: "",
            stderr: "",
            message: `unexpected codex args: ${args.join(" ")}`,
          };
        },
      }),
    );

    const results = await probeAgentBackendAuthReadiness(codexCandidate, {});
    expect(
      results.some(
        (entry) =>
          entry.status === "invalid" &&
          entry.backend === "codex-agent" &&
          entry.message.includes("authentication"),
      ),
    ).toBe(true);
  });

  test("reports invalid codex account readiness when login succeeds but model check fails", async () => {
    mocks.push(
      mockAgentCliCommands({
        codex: (args) => {
          if (args[0] === "login" && args[1] === "status") {
            return {
              ok: true,
              stdout: "Logged in using ChatGPT\n",
              stderr: "",
            };
          }
          return {
            ok: false,
            stdout: "",
            stderr: "",
            message: `unexpected codex args: ${args.join(" ")}`,
          };
        },
        "codex-agent": () => ({
          ok: false,
          stdout: JSON.stringify({
            ok: false,
            model: "gpt-5-nano",
            auth: {
              ok: true,
              status: "Logged in using ChatGPT",
              error: null,
            },
            probe: {
              ok: false,
              model: "gpt-5-nano",
              error:
                "model gpt-5-nano is not enabled for this account because the subscription expired",
            },
          }),
          stderr: "",
          message:
            "model gpt-5-nano is not enabled for this account because the subscription expired",
        }),
      }),
    );

    const results = await probeAgentBackendAuthReadiness(codexCandidate, {});
    expect(
      results.some(
        (entry) =>
          entry.status === "invalid" &&
          entry.backend === "codex-agent" &&
          entry.message.includes("account is not usable") &&
          entry.message.includes("subscription expired"),
      ),
    ).toBe(true);
  });

  test("reports invalid claude authentication from auth verify probe", async () => {
    mocks.push(
      mockAgentCliCommands({
        "claude-code-agent": (args) => {
          if (args[0] === "auth" && args[1] === "verify") {
            return {
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
              message: "Stored credentials are expired.",
            };
          }
          return {
            ok: false,
            stdout: "",
            stderr: "",
            message: `unexpected claude-code-agent args: ${args.join(" ")}`,
          };
        },
      }),
    );

    const results = await probeAgentBackendAuthReadiness(claudeCandidate, {});
    expect(
      results.some(
        (entry) =>
          entry.status === "invalid" &&
          entry.backend === "claude-code-agent" &&
          entry.message.includes("Stored credentials are expired"),
      ),
    ).toBe(true);
  });
});
