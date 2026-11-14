import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import type { NodeExecutionBackend } from "../types";
import { ClaudeCodeAgentAdapter } from "./claude";
import { CodexAgentAdapter } from "./codex";
import { CursorCliAgentAdapter } from "./cursor";

const SMOKE_TOKEN = "rielflow-agent-smoke";
const SMOKE_TIMEOUT_MS = 120_000;
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function hasExecutable(command: string): boolean {
  return (
    spawnSync("sh", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    }).status === 0
  );
}

function shouldRunCliAgentSmoke(command: string): boolean {
  return (
    process.env["RIELFLOW_RUN_CLI_AGENT_LIVE_SMOKE"] === "1" &&
    hasExecutable(command)
  );
}

function createTempWorkingDirectory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createContext(): AdapterExecutionContext {
  return {
    timeoutMs: SMOKE_TIMEOUT_MS,
    signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
  };
}

function createInput(input: {
  readonly backend: NodeExecutionBackend;
  readonly model: string;
  readonly workingDirectory: string;
}): AdapterExecutionInput {
  return {
    workflowId: "wf-cli-agent-live-smoke",
    workflowExecutionId: "sess-cli-agent-live-smoke",
    nodeId: "node-cli-agent-live-smoke",
    nodeExecId: "exec-cli-agent-live-smoke",
    node: {
      id: "node-cli-agent-live-smoke",
      model: input.model,
      executionBackend: input.backend,
      promptTemplate: "test",
      variables: {},
    },
    workingDirectory: input.workingDirectory,
    mergedVariables: {},
    systemPromptText:
      "You are validating a rielflow CLI-agent adapter. Do not inspect or modify files. Follow the user instruction exactly.",
    promptText: `Reply with exactly this ASCII token and no other text: ${SMOKE_TOKEN}`,
    arguments: null,
    executionIndex: 1,
    artifactDir: join(input.workingDirectory, "artifacts"),
    upstreamCommunicationIds: [],
  };
}

function expectSmokeToken(output: unknown): void {
  expect(output).toEqual(expect.objectContaining({ text: expect.any(String) }));
  const text = (output as { readonly text: string }).text;
  expect(text).toContain(SMOKE_TOKEN);
}

describe("CLI agent adapter live smoke tests", () => {
  test.skipIf(!shouldRunCliAgentSmoke("codex"))(
    "executes codex-agent when CLI live smoke is enabled and codex is available",
    async () => {
      const workingDirectory = createTempWorkingDirectory("rielflow-codex-");
      const adapter = new CodexAgentAdapter({ cwd: workingDirectory });
      const output = await adapter.execute(
        createInput({
          backend: "codex-agent",
          model:
            process.env["RIELFLOW_CODEX_AGENT_SMOKE_MODEL"] ?? "gpt-5-nano",
          workingDirectory,
        }),
        createContext(),
      );

      expect(output.provider).toBe("codex-agent");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );

  test.skipIf(!shouldRunCliAgentSmoke("claude"))(
    "executes claude-code-agent when CLI live smoke is enabled and claude is available",
    async () => {
      const workingDirectory = createTempWorkingDirectory("rielflow-claude-");
      const adapter = new ClaudeCodeAgentAdapter({ cwd: workingDirectory });
      const output = await adapter.execute(
        createInput({
          backend: "claude-code-agent",
          model:
            process.env["RIELFLOW_CLAUDE_CODE_AGENT_SMOKE_MODEL"] ??
            "claude-haiku-4-5",
          workingDirectory,
        }),
        createContext(),
      );

      expect(output.provider).toBe("claude-code-agent");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );

  test.skipIf(!shouldRunCliAgentSmoke("cursor-agent"))(
    "executes cursor-cli-agent when CLI live smoke is enabled and cursor-agent is available",
    async () => {
      const workingDirectory = createTempWorkingDirectory("rielflow-cursor-");
      const adapter = new CursorCliAgentAdapter({ cwd: workingDirectory });
      const output = await adapter.execute(
        createInput({
          backend: "cursor-cli-agent",
          model:
            process.env["RIELFLOW_CURSOR_CLI_AGENT_SMOKE_MODEL"] ??
            "composer-2",
          workingDirectory,
        }),
        createContext(),
      );

      expect(output.provider).toBe("cursor-cli-agent");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );
});
