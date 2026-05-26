import { describe, expect, test } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { AnthropicSdkAdapter } from "./anthropic-sdk";

const baseInput: AdapterExecutionInput = {
  workflowId: "wf",
  workflowExecutionId: "sess-1",
  nodeId: "node-1",
  nodeExecId: "exec-1",
  node: {
    id: "node-1",
    model: "claude-haiku-4-5",
    executionBackend: "official/anthropic-sdk",
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

describe("AnthropicSdkAdapter", () => {
  test("passes systemPromptText as Anthropic system content", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const adapter = new AnthropicSdkAdapter({
      clientFactory: () => ({
        messages: {
          async create(request) {
            capturedRequest = request as Record<string, unknown>;
            return {
              content: [{ type: "text", text: "hello from anthropic" }],
            };
          },
        },
      }),
    });
    process.env["ANTHROPIC_API_KEY"] = "test-key";

    await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
      },
      baseContext,
    );

    expect(capturedRequest?.["system"]).toBe("system");
    expect(capturedRequest?.["messages"]).toEqual([
      { role: "user", content: "hello" },
    ]);
  });

  test("normalizes successful SDK output", async () => {
    let capturedSignal: AbortSignal | undefined;
    const adapter = new AnthropicSdkAdapter({
      clientFactory: () => ({
        messages: {
          async create(_request, options) {
            capturedSignal = options?.signal;
            return {
              content: [{ type: "text", text: "hello from anthropic" }],
            };
          },
        },
      }),
    });
    process.env["ANTHROPIC_API_KEY"] = "test-key";

    const output = await adapter.execute(baseInput, baseContext);
    expect(output.provider).toBe("official-anthropic-sdk");
    expect(output.model).toBe("claude-haiku-4-5");
    expect(output.payload).toEqual({ text: "hello from anthropic" });
    expect(output.payload["outputAttempt"]).toBeUndefined();
    expect(capturedSignal).toBe(baseContext.signal);
  });

  test("parses structured JSON object output when an output contract is present", async () => {
    const adapter = new AnthropicSdkAdapter({
      clientFactory: () => ({
        messages: {
          async create() {
            return {
              content: [
                { type: "text", text: '{"summary":"hello from anthropic"}' },
              ],
            };
          },
        },
      }),
    });
    process.env["ANTHROPIC_API_KEY"] = "test-key";

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
    expect(output.payload).toEqual({ summary: "hello from anthropic" });
  });
});
