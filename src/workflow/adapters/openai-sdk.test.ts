import { describe, expect, test } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { OpenAiSdkAdapter } from "./openai-sdk";

const baseInput: AdapterExecutionInput = {
  workflowId: "wf",
  workflowExecutionId: "sess-1",
  nodeId: "node-1",
  nodeExecId: "exec-1",
  node: {
    id: "node-1",
    model: "gpt-5-nano",
    executionBackend: "official/openai-sdk",
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

describe("OpenAiSdkAdapter", () => {
  test("passes systemPromptText as OpenAI instructions", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const adapter = new OpenAiSdkAdapter({
      clientFactory: () => ({
        responses: {
          async create(request) {
            capturedRequest = request as Record<string, unknown>;
            return {
              output_text: "hello from openai",
            };
          },
        },
      }),
    });
    process.env["OPENAI_API_KEY"] = "test-key";

    await adapter.execute(
      {
        ...baseInput,
        systemPromptText: "system",
      },
      baseContext,
    );

    expect(capturedRequest?.["instructions"]).toBe("system");
    expect(capturedRequest?.["input"]).toBe("hello");
  });

  test("normalizes successful SDK output", async () => {
    let capturedSignal: AbortSignal | undefined;
    const adapter = new OpenAiSdkAdapter({
      clientFactory: () => ({
        responses: {
          async create(_request, options) {
            capturedSignal = options?.signal;
            return {
              output_text: "hello from openai",
            };
          },
        },
      }),
    });
    process.env["OPENAI_API_KEY"] = "test-key";

    const output = await adapter.execute(baseInput, baseContext);
    expect(output.provider).toBe("official-openai-sdk");
    expect(output.model).toBe("gpt-5-nano");
    expect(output.payload).toEqual({ text: "hello from openai" });
    expect(output.payload["outputAttempt"]).toBeUndefined();
    expect(capturedSignal).toBe(baseContext.signal);
  });

  test("parses structured JSON object output when an output contract is present", async () => {
    const adapter = new OpenAiSdkAdapter({
      clientFactory: () => ({
        responses: {
          async create() {
            return {
              output_text: '{"summary":"hello from openai"}',
            };
          },
        },
      }),
    });
    process.env["OPENAI_API_KEY"] = "test-key";

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
    expect(output.payload).toEqual({ summary: "hello from openai" });
  });
});