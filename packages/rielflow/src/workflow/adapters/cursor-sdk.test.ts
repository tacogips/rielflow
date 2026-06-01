import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { CursorSdkAdapter } from "./cursor-sdk";

const baseInput: AdapterExecutionInput = {
  workflowId: "wf",
  workflowExecutionId: "sess-1",
  nodeId: "node-1",
  nodeExecId: "exec-1",
  node: {
    id: "node-1",
    model: "composer-2",
    executionBackend: "official/cursor-sdk",
    promptTemplate: "test",
    variables: {},
  },
  workingDirectory: "/tmp/project",
  mergedVariables: {},
  promptText: "hello",
  arguments: null,
  executionIndex: 1,
  artifactDir: "/tmp/node-1/exec-1",
  upstreamCommunicationIds: [],
};

const baseContext: AdapterExecutionContext = {
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

const originalCursorApiKey = process.env["CURSOR_API_KEY"];

afterEach(() => {
  if (originalCursorApiKey === undefined) {
    delete process.env["CURSOR_API_KEY"];
    return;
  }
  process.env["CURSOR_API_KEY"] = originalCursorApiKey;
});

describe("CursorSdkAdapter", () => {
  test("creates a Cursor SDK agent with API key, model, and cwd", async () => {
    let capturedOptions: unknown;
    let capturedPrompt: string | undefined;
    const close = vi.fn();
    const adapter = new CursorSdkAdapter({
      cwd: "/tmp/project",
      agentFactory: async (options) => {
        capturedOptions = options;
        return {
          async send(message) {
            capturedPrompt = message;
            return {
              async wait() {
                return { status: "finished", result: "hello from cursor" };
              },
              async cancel() {
                return;
              },
            };
          },
          close,
        };
      },
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    const output = await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
      },
      baseContext,
    );

    expect(capturedOptions).toEqual({
      apiKey: "test-key",
      model: { id: "composer-2" },
      local: { cwd: "/tmp/project" },
    });
    expect(capturedPrompt).toBe("system\n\nhello");
    expect(output.provider).toBe("official-cursor-sdk");
    expect(output.payload).toEqual({ text: "hello from cursor" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("parses structured JSON object output when an output contract is present", async () => {
    const adapter = new CursorSdkAdapter({
      agentFactory: async () => ({
        async send() {
          return {
            async wait() {
              return {
                status: "finished",
                result: '{"summary":"hello from cursor"}',
              };
            },
            async cancel() {
              return;
            },
          };
        },
        close() {
          return;
        },
      }),
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    const output = await adapter.execute(
      {
        ...baseInput,
        output: {
          maxValidationAttempts: 3,
          attempt: 1,
          candidatePath: "/tmp/node-1/exec-1/candidate.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      },
      baseContext,
    );
    expect(output.payload).toEqual({ summary: "hello from cursor" });
  });
});
