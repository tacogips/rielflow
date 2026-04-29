import { describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type NodeAdapter,
  normalizeAdapterOutput,
  parseJsonObjectCandidate,
  ScenarioNodeAdapter,
} from "./adapter";
import { executeAdapterWithTimeout } from "./adapter-execution";

describe("normalizeAdapterOutput", () => {
  test("normalizes valid adapter output", () => {
    const normalized = normalizeAdapterOutput(
      {
        provider: "provider-x",
        model: "model-x",
        promptText: "hello",
        completionPassed: true,
        when: { always: true },
        payload: { value: 1 },
      },
      "fallback-model",
    );

    expect(normalized.provider).toBe("provider-x");
    expect(normalized.model).toBe("model-x");
    expect(normalized.when["always"]).toBe(true);
  });

  test("throws invalid_output for malformed payload", () => {
    expect(() =>
      normalizeAdapterOutput(
        {
          provider: "provider-x",
          promptText: "hello",
          completionPassed: true,
          when: { always: "true" },
          payload: { value: 1 },
        },
        "fallback-model",
      ),
    ).toThrowError(AdapterExecutionError);
  });
});

describe("parseJsonObjectCandidate", () => {
  test("accepts a fenced json object response", () => {
    expect(
      parseJsonObjectCandidate(
        '```json\n{\n  "summary": "ok"\n}\n```',
        "test source",
      ),
    ).toEqual({ summary: "ok" });
  });

  test("rejects non-object json responses", () => {
    expect(() =>
      parseJsonObjectCandidate("[1,2,3]", "test source"),
    ).toThrowError(AdapterExecutionError);
  });
});

function makeExecutionInput(
  overrides: Partial<AdapterExecutionInput> = {},
): AdapterExecutionInput {
  return {
    workflowId: "wf",
    workflowExecutionId: "wfexec-000001",
    nodeId: "step-1",
    nodeExecId: "exec-000001",
    node: {
      id: "step-1",
      executionBackend: "codex-agent",
      model: "gpt-5-nano",
      variables: {},
    } as AdapterExecutionInput["node"],
    workingDirectory: "/tmp/project",
    mergedVariables: {},
    promptText: "prompt",
    arguments: null,
    executionIndex: 1,
    artifactDir: "/tmp/step-1",
    upstreamCommunicationIds: [],
    ...overrides,
  };
}

const adapterContext: AdapterExecutionContext = {
  timeoutMs: 1000,
  signal: new AbortController().signal,
};

describe("ScenarioNodeAdapter", () => {
  test("advances scenario arrays across output validation attempts", async () => {
    const adapter = new ScenarioNodeAdapter({
      "step-1": [
        { payload: { phase: "first-attempt" } },
        { payload: { phase: "retry-attempt" } },
      ],
    });

    const first = await adapter.execute(
      makeExecutionInput({
        output: {
          maxValidationAttempts: 2,
          attempt: 1,
          candidatePath: "/tmp/candidate-1.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      }),
      adapterContext,
    );
    const retry = await adapter.execute(
      makeExecutionInput({
        output: {
          maxValidationAttempts: 2,
          attempt: 2,
          candidatePath: "/tmp/candidate-2.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      }),
      adapterContext,
    );

    expect(first.payload).toEqual({ phase: "first-attempt" });
    expect(retry.payload).toEqual({ phase: "retry-attempt" });
  });

  test("advances scenario arrays across repeated output-node executions", async () => {
    const adapter = new ScenarioNodeAdapter({
      "step-1": [
        { payload: { turn: 1 } },
        { payload: { turn: 2 } },
        { payload: { turn: 3 } },
      ],
    });

    const first = await adapter.execute(
      makeExecutionInput({
        executionIndex: 1,
        output: {
          maxValidationAttempts: 1,
          attempt: 1,
          candidatePath: "/tmp/candidate-1.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      }),
      adapterContext,
    );
    const second = await adapter.execute(
      makeExecutionInput({
        executionIndex: 2,
        nodeExecId: "exec-000002",
        output: {
          maxValidationAttempts: 1,
          attempt: 1,
          candidatePath: "/tmp/candidate-2.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      }),
      adapterContext,
    );
    const third = await adapter.execute(
      makeExecutionInput({
        executionIndex: 3,
        nodeExecId: "exec-000003",
        output: {
          maxValidationAttempts: 1,
          attempt: 1,
          candidatePath: "/tmp/candidate-3.json",
          validationErrors: [],
          publication: {
            owner: "runtime",
            finalArtifactWrite: "runtime-only",
            mailboxWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      }),
      adapterContext,
    );

    expect(first.payload).toEqual({ turn: 1 });
    expect(second.payload).toEqual({ turn: 2 });
    expect(third.payload).toEqual({ turn: 3 });
  });
});

describe("executeAdapterWithTimeout", () => {
  test("classifies non-DOM abort errors from timed-out adapters as timeout", async () => {
    const abortingAdapter = {
      async execute(_input, context) {
        return await new Promise((_, reject) => {
          context.signal.addEventListener(
            "abort",
            () => {
              const error = new Error("operation aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      },
    } satisfies NodeAdapter;

    const result = await executeAdapterWithTimeout(
      abortingAdapter,
      makeExecutionInput(),
      1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toBe("adapter execution timed out");
  });

  test("does not classify adapter-raised abort errors before timeout as timeout", async () => {
    const abortingAdapter = {
      async execute() {
        const error = new Error("operation aborted by adapter");
        error.name = "AbortError";
        throw error;
      },
    } satisfies NodeAdapter;

    const result = await executeAdapterWithTimeout(
      abortingAdapter,
      makeExecutionInput(),
      1000,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("provider_error");
    expect(result.error.message).toBe("operation aborted by adapter");
  });
});