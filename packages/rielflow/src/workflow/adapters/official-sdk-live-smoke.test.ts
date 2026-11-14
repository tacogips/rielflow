import { describe, expect, test } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { AnthropicSdkAdapter } from "./anthropic-sdk";
import { CursorSdkAdapter } from "./cursor-sdk";
import { OpenAiSdkAdapter } from "./openai-sdk";

const SMOKE_TOKEN = "rielflow-sdk-smoke";
const SMOKE_TIMEOUT_MS = 60_000;

function createContext(): AdapterExecutionContext {
  return {
    timeoutMs: SMOKE_TIMEOUT_MS,
    signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
  };
}

function createInput(input: {
  readonly backend:
    | "official/openai-sdk"
    | "official/anthropic-sdk"
    | "official/cursor-sdk";
  readonly model: string;
}): AdapterExecutionInput {
  return {
    workflowId: "wf-live-smoke",
    workflowExecutionId: "sess-live-smoke",
    nodeId: "node-live-smoke",
    nodeExecId: "exec-live-smoke",
    node: {
      id: "node-live-smoke",
      model: input.model,
      executionBackend: input.backend,
      promptTemplate: "test",
      variables: {},
    },
    workingDirectory: process.cwd(),
    mergedVariables: {},
    systemPromptText:
      "You are validating a rielflow SDK adapter. Follow the user instruction exactly.",
    promptText: `Reply with exactly this ASCII token and no other text: ${SMOKE_TOKEN}`,
    arguments: null,
    executionIndex: 1,
    artifactDir: "/tmp/rielflow-live-smoke",
    upstreamCommunicationIds: [],
  };
}

function expectSmokeToken(output: unknown): void {
  expect(output).toEqual(expect.objectContaining({ text: expect.any(String) }));
  const text = (output as { readonly text: string }).text;
  expect(text).toContain(SMOKE_TOKEN);
}

function hasConfiguredApiKey(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value.length > 0 && value !== "test-key";
}

describe("official SDK adapter live smoke tests", () => {
  test.skipIf(!hasConfiguredApiKey("OPENAI_API_KEY"))(
    "executes the OpenAI/Codex SDK adapter when OPENAI_API_KEY is configured",
    async () => {
      const adapter = new OpenAiSdkAdapter();
      const output = await adapter.execute(
        createInput({
          backend: "official/openai-sdk",
          model: process.env["RIELFLOW_OPENAI_SDK_SMOKE_MODEL"] ?? "gpt-5-nano",
        }),
        createContext(),
      );

      expect(output.provider).toBe("official-openai-sdk");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );

  test.skipIf(!hasConfiguredApiKey("ANTHROPIC_API_KEY"))(
    "executes the Anthropic/Claude SDK adapter when ANTHROPIC_API_KEY is configured",
    async () => {
      const adapter = new AnthropicSdkAdapter({ maxTokens: 64 });
      const output = await adapter.execute(
        createInput({
          backend: "official/anthropic-sdk",
          model:
            process.env["RIELFLOW_ANTHROPIC_SDK_SMOKE_MODEL"] ??
            "claude-haiku-4-5",
        }),
        createContext(),
      );

      expect(output.provider).toBe("official-anthropic-sdk");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );

  test.skipIf(!hasConfiguredApiKey("CURSOR_API_KEY"))(
    "executes the Cursor SDK adapter when CURSOR_API_KEY is configured",
    async () => {
      const adapter = new CursorSdkAdapter();
      const output = await adapter.execute(
        createInput({
          backend: "official/cursor-sdk",
          model: process.env["RIELFLOW_CURSOR_SDK_SMOKE_MODEL"] ?? "composer-2",
        }),
        createContext(),
      );

      expect(output.provider).toBe("official-cursor-sdk");
      expectSmokeToken(output.payload);
    },
    SMOKE_TIMEOUT_MS,
  );
});
