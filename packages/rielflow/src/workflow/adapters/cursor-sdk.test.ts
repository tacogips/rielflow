import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  AdapterExecutionContext,
  AdapterExecutionInput,
} from "../adapter";
import { AdapterExecutionError } from "../adapter";
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

  test("uses the workflow working directory as the default Cursor local cwd", async () => {
    let capturedOptions: unknown;
    const adapter = new CursorSdkAdapter({
      agentFactory: async (options) => {
        capturedOptions = options;
        return {
          async send() {
            return {
              async wait() {
                return { status: "finished", result: "hello from cursor" };
              },
              async cancel() {
                return;
              },
            };
          },
          close() {
            return;
          },
        };
      },
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    await adapter.execute(baseInput, baseContext);

    expect(capturedOptions).toMatchObject({
      local: { cwd: baseInput.workingDirectory },
    });
  });

  test("spawns the Bun child from adapter runtime cwd while passing workflow cwd through stdin", async () => {
    let capturedSpawnCwd: string | undefined;
    let capturedChildInput = "";
    const adapter = new CursorSdkAdapter({
      bunChildSpawn: (_command, _args, options) => {
        capturedSpawnCwd = options.cwd;
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const child = new EventEmitter() as ChildProcessWithoutNullStreams;
        Object.assign(child, {
          exitCode: null,
          stdin: {
            end(chunk: string) {
              capturedChildInput = chunk;
            },
          },
          stdout,
          stderr,
          kill: vi.fn(() => {
            Object.assign(child, { exitCode: 0 });
            child.emit("exit", 0, null);
            return true;
          }),
        });
        queueMicrotask(() => {
          stdout.write(
            JSON.stringify({ status: "finished", result: "hello from cursor" }),
          );
          stdout.end();
          Object.assign(child, { exitCode: 0 });
          child.emit("exit", 0, null);
        });
        return child;
      },
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    const output = await adapter.execute(baseInput, baseContext);

    expect(capturedSpawnCwd).toBeDefined();
    expect(capturedSpawnCwd).not.toBe(baseInput.workingDirectory);
    expect(JSON.parse(capturedChildInput)).toEqual({
      modelId: "composer-2",
      cwd: baseInput.workingDirectory,
      storeRoot: `${baseInput.workingDirectory}/.rielflow-data/cursor-sdk-jsonl`,
      message: "hello",
    });
    expect(output.payload).toEqual({ text: "hello from cursor" });
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
            messageWrite: "runtime-only-after-validation",
            candidateSubmission: "inline-json-or-reserved-candidate-file",
            futureCommunicationIdsExposed: false,
          },
        },
      },
      baseContext,
    );
    expect(output.payload).toEqual({ summary: "hello from cursor" });
  });

  test("cancels the Cursor SDK run when the adapter context aborts", async () => {
    const abortController = new AbortController();
    let resolveRunCreated: (() => void) | undefined;
    const runCreated = new Promise<void>((resolve) => {
      resolveRunCreated = resolve;
    });
    let resolveWait:
      | ((value: { readonly status: string; readonly result: string }) => void)
      | undefined;
    const cancel = vi.fn(async () => {
      resolveWait?.({ status: "finished", result: "cancelled" });
    });
    const adapter = new CursorSdkAdapter({
      agentFactory: async () => ({
        async send() {
          resolveRunCreated?.();
          return {
            wait: async () =>
              await new Promise<{
                readonly status: string;
                readonly result: string;
              }>((resolve) => {
                resolveWait = resolve;
              }),
            cancel,
          };
        },
        close() {
          return;
        },
      }),
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    const execution = adapter.execute(baseInput, {
      timeoutMs: 1000,
      signal: abortController.signal,
    });
    await runCreated;
    abortController.abort();

    await expect(execution).rejects.toMatchObject({
      code: "timeout",
      message: "official Cursor SDK request aborted",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("redacts the Cursor API key from provider failures", async () => {
    const adapter = new CursorSdkAdapter({
      maxAttempts: 1,
      agentFactory: async () => {
        throw new AdapterExecutionError(
          "provider_error",
          "provider stderr included test-key",
          {
            processLogs: [
              {
                stream: "stderr",
                text: "raw stderr included test-key",
              },
            ],
          },
        );
      },
    });
    process.env["CURSOR_API_KEY"] = "test-key";

    await expect(adapter.execute(baseInput, baseContext)).rejects.toMatchObject(
      {
        code: "provider_error",
        message: "provider stderr included [REDACTED]",
        processLogs: [
          {
            stream: "stderr",
            text: "raw stderr included [REDACTED]",
          },
        ],
      },
    );
  });
});
