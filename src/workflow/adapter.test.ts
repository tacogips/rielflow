import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { describe, expect, test } from "vitest";
import {
  AdapterExecutionError,
  type AdapterExecutionInput,
  type NodeAdapter,
  isAdapterExecutionOutputEnvelope,
  normalizeOutputContractEnvelope,
  normalizeAdapterOutput,
  parseJsonObjectCandidate,
} from "./adapter";
import {
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
} from "./adapter-execution";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-adapter-execution-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

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

describe("isAdapterExecutionOutputEnvelope", () => {
  test("recognizes complete adapter output envelopes", () => {
    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "codex-agent",
        model: "gpt-5.5",
        promptText: "prompt",
        completionPassed: true,
        when: { always: true },
        payload: { result: "ok" },
      }),
    ).toBe(true);
  });

  test("does not treat business payloads with provider and model fields as envelopes", () => {
    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "external-system",
        model: "business-model",
        payload: { result: "ok" },
      }),
    ).toBe(false);
  });

  test("rejects empty provider or model fields", () => {
    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "",
        model: "gpt-5.5",
        promptText: "prompt",
        completionPassed: true,
        when: { always: true },
        payload: { result: "ok" },
      }),
    ).toBe(false);

    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "codex-agent",
        model: "",
        promptText: "prompt",
        completionPassed: true,
        when: { always: true },
        payload: { result: "ok" },
      }),
    ).toBe(false);
  });

  test("rejects malformed envelope control fields", () => {
    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "codex-agent",
        model: "gpt-5.5",
        promptText: "prompt",
        completionPassed: true,
        when: { always: "true" },
        payload: { result: "ok" },
      }),
    ).toBe(false);

    expect(
      isAdapterExecutionOutputEnvelope({
        provider: "codex-agent",
        model: "gpt-5.5",
        promptText: "prompt",
        completionPassed: true,
        when: { always: true },
        payload: ["not", "an", "object"],
      }),
    ).toBe(false);
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

  test("accepts a fenced json object with surrounding prose", () => {
    expect(
      parseJsonObjectCandidate(
        'Here is the JSON:\n```json\n{"summary":"ok"}\n```\nDone.',
        "test source",
      ),
    ).toEqual({ summary: "ok" });
  });

  test("accepts the first balanced json object in prose", () => {
    expect(
      parseJsonObjectCandidate(
        'I will continue with {"summary":"ok","nested":{"value":1}} now.',
        "test source",
      ),
    ).toEqual({ summary: "ok", nested: { value: 1 } });
  });

  test("accepts a balanced json object at the start with trailing prose", () => {
    expect(
      parseJsonObjectCandidate(
        '{"summary":"ok","count":2}\nAdditional notes.',
        "test source",
      ),
    ).toEqual({ summary: "ok", count: 2 });
  });

  test("ignores braces inside json strings while extracting prose objects", () => {
    expect(
      parseJsonObjectCandidate(
        'Wrapped {"summary":"{not depth}","quote":"escaped \\" { brace"} done.',
        "test source",
      ),
    ).toEqual({ summary: "{not depth}", quote: 'escaped " { brace' });
  });

  test("skips balanced prose braces before the first valid json object", () => {
    expect(
      parseJsonObjectCandidate(
        'Ignore {not json} and use {"summary":"ok"} instead.',
        "test source",
      ),
    ).toEqual({ summary: "ok" });
  });

  test("rejects non-object json responses", () => {
    expect(() =>
      parseJsonObjectCandidate("[1,2,3]", "test source"),
    ).toThrowError(AdapterExecutionError);
  });

  test("rejects valid array responses that contain objects", () => {
    expect(() =>
      parseJsonObjectCandidate('[{"summary":"ok"}]', "test source"),
    ).toThrowError(AdapterExecutionError);
  });

  test("rejects scalar json responses", () => {
    expect(() => parseJsonObjectCandidate('"ok"', "test source")).toThrowError(
      AdapterExecutionError,
    );
  });

  test("rejects unbalanced object text", () => {
    expect(() =>
      parseJsonObjectCandidate('prefix {"summary":"ok"', "test source"),
    ).toThrowError(AdapterExecutionError);
  });
});

describe("normalizeOutputContractEnvelope", () => {
  test("keeps plain business payloads with adapter defaults", () => {
    const normalized = normalizeOutputContractEnvelope(
      { summary: "ok" },
      "candidate",
      {
        completionPassed: true,
        when: { always: true },
      },
    );

    expect(normalized).toEqual({
      completionPassed: true,
      when: { always: true },
      payload: { summary: "ok" },
      usedEnvelope: false,
    });
  });

  test("unwraps valid envelopes and honors completion overrides", () => {
    const normalized = normalizeOutputContractEnvelope(
      {
        when: { needs_revision: true },
        payload: { summary: "fix me" },
        completionPassed: false,
      },
      "candidate",
      {
        completionPassed: true,
        when: { always: true },
      },
    );

    expect(normalized).toEqual({
      completionPassed: false,
      when: { needs_revision: true },
      payload: { summary: "fix me" },
      usedEnvelope: true,
    });
  });

  test("rejects invalid when maps", () => {
    expect(() =>
      normalizeOutputContractEnvelope(
        {
          when: { needs_revision: "yes" },
          payload: { summary: "bad" },
        } as unknown as Readonly<Record<string, unknown>>,
        "candidate",
      ),
    ).toThrowError(AdapterExecutionError);
  });

  test("rejects envelopes without object payloads", () => {
    expect(() =>
      normalizeOutputContractEnvelope(
        {
          when: { needs_revision: true },
        },
        "candidate",
      ),
    ).toThrowError(AdapterExecutionError);
  });

  test("rejects non-boolean completion overrides", () => {
    expect(() =>
      normalizeOutputContractEnvelope(
        {
          when: { needs_revision: true },
          payload: { summary: "bad" },
          completionPassed: "no",
        } as unknown as Readonly<Record<string, unknown>>,
        "candidate",
      ),
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

function makeExecutionMailbox() {
  return {
    meta: {
      protocolVersion: 1,
      mailboxDirEnvVar: "DIVEDRA_MAILBOX_DIR",
      node: {
        workflowId: "wf",
        workflowDescription: "demo workflow",
        nodeId: "node-1",
        nodeKind: "task",
      },
      objective: {
        reason: "Run native node.",
        expectedReturn: "Return JSON.",
        instruction: "run native node",
      },
      paths: {
        inputPath: "inbox/input.json",
        inputFilesDir: "inbox/files",
        outputPath: "outbox/output.json",
        outputFilesDir: "outbox/files",
      },
      input: {
        kind: "json",
        upstreamSources: [],
      },
      output: {
        kind: "json",
        required: true,
        path: "outbox/output.json",
        filesDirectory: "outbox/files",
      },
    },
    input: {
      arguments: {},
      upstream: [],
    },
  } as const;
}

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

  test("classifies native package execution timeout even while loading the package executor", async () => {
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    const scriptsDir = path.join(workflowDirectory, "scripts");
    await mkdir(workflowWorkingDirectory, { recursive: true });
    await mkdir(scriptsDir, { recursive: true });
    await writeFile(
      path.join(scriptsDir, "slow.sh"),
      [
        "#!/bin/sh",
        "sleep 1",
        'mkdir -p "$DIVEDRA_MAILBOX_DIR/outbox"',
        `printf '{"ok":true}\n' > "$DIVEDRA_MAILBOX_DIR/outbox/output.json"`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o755 },
    );

    const result = await executePackageNodeWithTimeout({
      workflowDirectory,
      workflowWorkingDirectory,
      artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
      workflowId: "wf",
      workflowDescription: "demo workflow",
      workflowExecutionId: "sess-1",
      nodeId: "node-1",
      nodeExecId: "exec-1",
      node: {
        id: "node-1",
        nodeType: "command",
        variables: {},
        command: {
          scriptPath: "scripts/slow.sh",
        },
      },
      workflowDefaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120000,
      },
      runtimeVariables: {},
      mergedVariables: {},
      arguments: {},
      artifactDir,
      executionMailbox: makeExecutionMailbox(),
      timeoutMs: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toBe("native node execution timed out");
  });

  test("does not start native package execution after timeout wins during package loading", async () => {
    let executeNativeNodeCalls = 0;
    const executeNativeNode = async () => {
      executeNativeNodeCalls += 1;
      return {
        provider: "native",
        model: "command",
        promptText: "native node",
        completionPassed: true,
        when: { always: true },
        payload: { started: true },
      };
    };
    const loadExecutor = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return executeNativeNode;
    };
    const workflowDirectory = await makeTempDir();
    const workflowWorkingDirectory = path.join(workflowDirectory, "workspace");
    const artifactDir = path.join(workflowDirectory, "artifacts", "node-1");
    await mkdir(workflowWorkingDirectory, { recursive: true });

    const result = await executePackageNodeWithTimeout(
      {
        workflowDirectory,
        workflowWorkingDirectory,
        artifactWorkflowRoot: path.join(workflowDirectory, "artifacts"),
        workflowId: "wf",
        workflowDescription: "demo workflow",
        workflowExecutionId: "sess-1",
        nodeId: "node-1",
        nodeExecId: "exec-1",
        node: {
          id: "node-1",
          nodeType: "command",
          variables: {},
          command: {
            scriptPath: "scripts/should-not-run.sh",
          },
        },
        workflowDefaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120000,
        },
        runtimeVariables: {},
        mergedVariables: {},
        arguments: {},
        artifactDir,
        executionMailbox: makeExecutionMailbox(),
        timeoutMs: 1,
      },
      { loadExecutor },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toBe("native node execution timed out");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(executeNativeNodeCalls).toBe(0);
  });
});
