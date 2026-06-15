import { afterEach, describe, expect, test } from "vitest";
import { mockAgentBackendReadinessOperations } from "./runtime-readiness-agent-probes-test-helpers";
import {
  probeAgentBackendAuthReadiness,
  probeAgentBackendNodeExecutability,
} from "./runtime-readiness-agent-probes";

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

const cursorCandidate = {
  backend: "cursor-cli-agent" as const,
  models: new Set(["claude-sonnet-4-5"]),
  nodeIds: ["cursor-worker"],
  stepIds: ["cursor-worker"],
};

const cursorGpt55HighCandidate = {
  backend: "cursor-cli-agent" as const,
  models: new Set(["gpt-5.5-high"]),
  nodeIds: ["cursor-gpt-worker"],
  stepIds: ["cursor-gpt-worker"],
};

function availableCursorToolVersions() {
  return {
    packageVersion: "0.1.0",
    tools: [
      {
        name: "cursor-agent",
        command: "cursor-agent",
        version: "0.45.0",
        status: "available" as const,
      },
    ],
  };
}

function successfulCodexModelAvailability(model: string) {
  return {
    ok: true,
    model,
    auth: {
      ok: true,
      status: "Logged in using ChatGPT",
      error: null,
      exitCode: 0,
    },
    probe: {
      ok: true,
      model,
      output: "OK",
      error: null,
      exitCode: 0,
    },
  };
}

function successfulClaudeReadiness(model?: string) {
  const modelRequested = model ?? null;
  return {
    ready: true,
    auth: {
      state: "configured" as const,
      available: true,
      verified: model !== undefined,
    },
    cli: {
      checked: model !== undefined,
      available: true,
      command: "claude",
      ...(model === undefined ? {} : { exitCode: 0 }),
    },
    model: {
      requested: modelRequested,
      checked: model !== undefined,
      available: model !== undefined,
      timedOut: false,
      ...(model === undefined ? {} : { exitCode: 0 }),
    },
  };
}

describe("probeAgentBackendAuthReadiness", () => {
  test("reports invalid codex authentication from login status probe", async () => {
    mocks.push(
      mockAgentBackendReadinessOperations({
        getCodexBackendLoginStatus: async () => ({
          ok: false,
          status: null,
          error: "not logged in",
          exitCode: 1,
        }),
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
      mockAgentBackendReadinessOperations({
        getCodexBackendLoginStatus: async () => ({
          ok: true,
          status: "Logged in using ChatGPT",
          error: null,
          exitCode: 0,
        }),
        checkCodexBackendModelAvailability: async (input) => ({
          ok: false,
          model: input.model,
          auth: {
            ok: true,
            status: "Logged in using ChatGPT",
            error: null,
            exitCode: 0,
          },
          probe: {
            ok: false,
            model: input.model,
            output: null,
            error:
              "model gpt-5-nano is not enabled for this account because the subscription expired",
            exitCode: 1,
          },
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
      mockAgentBackendReadinessOperations({
        verifyClaudeBackendReadiness: async () => ({
          ready: false,
          auth: {
            state: "expired",
            available: false,
            verified: false,
            message: "Stored credentials are expired.",
          },
          cli: {
            checked: false,
            available: false,
            command: "claude",
          },
          model: {
            requested: null,
            checked: false,
            available: false,
            timedOut: false,
          },
        }),
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

  test("uses bundled SDK readiness for codex, claude, and cursor executability without wrapper binaries", async () => {
    mocks.push(
      mockAgentBackendReadinessOperations({
        getCodexBackendToolVersions: async () => ({
          codex: {
            name: "codex",
            command: "codex",
            version: "codex-cli 0.135.0",
            status: "available",
          },
          git: {
            name: "git",
            command: "git",
            version: "git version 2.53.0",
            status: "available",
          },
        }),
        getCodexBackendLoginStatus: async () => ({
          ok: true,
          status: "Logged in using ChatGPT",
          error: null,
          exitCode: 0,
        }),
        checkCodexBackendModelAvailability: async (input) =>
          successfulCodexModelAvailability(input.model),
        getClaudeBackendToolVersion: async () => ({
          name: "claude",
          command: "claude",
          version: "2.1.86",
          status: "available",
        }),
        verifyClaudeBackendReadiness: async (options = {}) =>
          successfulClaudeReadiness(options.model),
        getCursorBackendToolVersions: async () => ({
          packageVersion: "0.1.0",
          tools: [
            {
              name: "cursor-agent",
              command: "cursor-agent",
              version: "0.45.0",
              status: "available",
            },
          ],
        }),
        checkCursorBackendModelAvailability: async (input) => ({
          model: input.model,
          binary: {
            name: "cursor-agent",
            command: "cursor-agent",
            version: "0.45.0",
            status: "available",
          },
          auth: {
            status: "available",
            detail: "cursor-agent authentication is usable",
          },
          modelReachability: {
            status: "available",
            probed: true,
            output: "OK",
          },
        }),
      }),
    );

    const results = [
      ...(await probeAgentBackendNodeExecutability(codexCandidate, {})),
      ...(await probeAgentBackendNodeExecutability(claudeCandidate, {})),
      ...(await probeAgentBackendNodeExecutability(cursorCandidate, {})),
    ];

    expect(results.some((entry) => entry.status === "invalid")).toBe(false);
    expect(results.map((entry) => entry.message).join("\n")).toContain(
      "bundled sdk=codex-agent",
    );
    expect(results.map((entry) => entry.message).join("\n")).toContain(
      "bundled sdk=claude-code-agent",
    );
    expect(results.map((entry) => entry.message).join("\n")).toContain(
      "bundled sdk=cursor-cli-agent",
    );
    expect(results.map((entry) => entry.message).join("\n")).not.toContain(
      "Executable not found",
    );
    expect(results.map((entry) => entry.message).join("\n")).not.toContain(
      "claude-code-agent version",
    );
    expect(results.map((entry) => entry.message).join("\n")).not.toContain(
      "cursor-cli-agent tool",
    );
  });

  test("cursor executable preflight probes resolved gpt-5.5 effort slug", async () => {
    const probeCalls: Array<{ model: string; probe?: boolean }> = [];
    mocks.push(
      mockAgentBackendReadinessOperations({
        getCursorBackendToolVersions: async () => availableCursorToolVersions(),
        checkCursorBackendModelAvailability: async (input) => {
          probeCalls.push({
            model: input.model,
            ...(input.probe === undefined ? {} : { probe: input.probe }),
          });
          return {
            model: input.model,
            binary: {
              name: "cursor-agent",
              command: "cursor-agent",
              version: "0.45.0",
              status: "available",
            },
            auth: {
              status: "available",
              detail: "cursor-agent authentication is usable",
            },
            modelReachability: {
              status: "available",
              probed: true,
              output: "OK",
            },
          };
        },
      }),
    );

    const results = await probeAgentBackendNodeExecutability(
      cursorGpt55HighCandidate,
      {},
    );

    expect(
      probeCalls.some(
        (entry) => entry.model === "gpt-5.5-high" && entry.probe === true,
      ),
    ).toBe(true);
    expect(
      results.some(
        (entry) =>
          entry.status === "valid" &&
          entry.message.includes("gpt-5.5-high") &&
          entry.message.includes("reachable"),
      ),
    ).toBe(true);
  });

  test("cursor executable preflight reports unknown when model probe is skipped", async () => {
    mocks.push(
      mockAgentBackendReadinessOperations({
        getCursorBackendToolVersions: async () => availableCursorToolVersions(),
        checkCursorBackendModelAvailability: async (input) => ({
          model: input.model,
          binary: {
            name: "cursor-agent",
            command: "cursor-agent",
            version: "0.45.0",
            status: "available",
          },
          auth: {
            status: "available",
            detail: "cursor-agent authentication is usable",
          },
          modelReachability: {
            status: "unknown",
            probed: false,
          },
        }),
      }),
    );

    const results = await probeAgentBackendNodeExecutability(
      cursorGpt55HighCandidate,
      {},
    );

    expect(
      results.some(
        (entry) =>
          entry.status === "unknown" &&
          entry.message.includes("gpt-5.5-high") &&
          entry.message.includes("model probe did not run"),
      ),
    ).toBe(true);
    expect(
      results.some(
        (entry) =>
          entry.status === "valid" &&
          entry.message.includes("gpt-5.5-high") &&
          entry.message.includes("reachable"),
      ),
    ).toBe(false);
  });
});
