import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  normalizeTextBusinessPayload,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "rielflow-core";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

const DEFAULT_CURSOR_API_KEY_ENV = "CURSOR_API_KEY";
const DEFAULT_CURSOR_JSONL_STORE_DIR = ".rielflow-data/cursor-sdk-jsonl";
const BUN_CURSOR_SDK_SCRIPT = `
const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (
  typeof input.modelId !== "string" ||
  typeof input.cwd !== "string" ||
  typeof input.storeRoot !== "string" ||
  typeof input.message !== "string"
) {
  throw new Error("invalid Cursor SDK Bun child input");
}
const apiKey = process.env.CURSOR_API_KEY;
if (typeof apiKey !== "string" || apiKey.length === 0) {
  throw new Error("missing Cursor SDK Bun child API key");
}

const { Agent, JsonlLocalAgentStore } = await import("@cursor/sdk");
const store = new JsonlLocalAgentStore(input.storeRoot);
const agent = await Agent.create({
  apiKey,
  model: { id: input.modelId },
  local: { cwd: input.cwd, store },
});
const run = await agent.send(input.message);
const result = await run.wait();
process.stdout.write(JSON.stringify({
  status: result.status,
  result: result.result ?? "",
}));
process.exit(0);
`;

type CursorAgentOptions = {
  readonly apiKey: string;
  readonly model: { readonly id: string };
  readonly local: { readonly cwd: string };
};

type CursorBunChildSpawn = (
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly stdio: ["pipe", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

type CursorRunResult = {
  readonly status: string;
  readonly result?: string;
};

interface CursorRunLike {
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
}

interface CursorAgentLike {
  send(message: string): Promise<CursorRunLike>;
  close(): void;
}

class BunChildCursorRun implements CursorRunLike {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #resultPromise: Promise<CursorRunResult>;

  constructor(input: {
    readonly options: CursorAgentOptions;
    readonly message: string;
    readonly childRuntimeCwd: string;
    readonly childSpawn: CursorBunChildSpawn;
  }) {
    this.#child = input.childSpawn(
      resolveBunExecutable(),
      ["--eval", BUN_CURSOR_SDK_SCRIPT],
      {
        cwd: input.childRuntimeCwd,
        env: {
          CURSOR_API_KEY: input.options.apiKey,
          PATH: process.env["PATH"] ?? "",
          HOME: process.env["HOME"] ?? "",
          LANG: process.env["LANG"] ?? "C.UTF-8",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.#resultPromise = this.#waitForChild();
    this.#child.stdin.end(
      JSON.stringify({
        modelId: input.options.model.id,
        cwd: input.options.local.cwd,
        storeRoot: join(
          input.options.local.cwd,
          DEFAULT_CURSOR_JSONL_STORE_DIR,
        ),
        message: input.message,
      }),
    );
  }

  async wait(): Promise<CursorRunResult> {
    return await this.#resultPromise;
  }

  async cancel(): Promise<void> {
    if (this.#child.exitCode !== null) {
      return;
    }
    this.#child.kill("SIGTERM");
  }

  async #waitForChild(): Promise<CursorRunResult> {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    this.#child.stdout.on("data", (chunk: unknown) => {
      stdoutChunks.push(String(chunk));
    });
    this.#child.stderr.on("data", (chunk: unknown) => {
      stderrChunks.push(String(chunk));
    });

    const exit = await new Promise<{
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      this.#child.once("error", reject);
      this.#child.once("exit", (code, signal) => resolve({ code, signal }));
    });

    const stdoutText = stdoutChunks.join("").trim();
    if (stdoutText.length > 0) {
      try {
        return parseCursorRunResult(JSON.parse(stdoutText));
      } catch (error: unknown) {
        throw new AdapterExecutionError(
          "provider_error",
          `invalid Cursor SDK Bun child response: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (exit.code !== 0) {
      const stderrText = stderrChunks.join("").trim();
      const detail =
        stderrText.length > 0
          ? stderrText
          : `Cursor SDK Bun child exited with code ${exit.code ?? "null"} signal ${
              exit.signal ?? "null"
            }`;
      throw new AdapterExecutionError("provider_error", detail);
    }

    throw new AdapterExecutionError(
      "provider_error",
      "Cursor SDK Bun child produced no response",
    );
  }
}

class BunChildCursorAgent implements CursorAgentLike {
  readonly #options: CursorAgentOptions;
  readonly #childRuntimeCwd: string;
  readonly #childSpawn: CursorBunChildSpawn;

  constructor(input: {
    readonly options: CursorAgentOptions;
    readonly childRuntimeCwd: string;
    readonly childSpawn: CursorBunChildSpawn;
  }) {
    this.#childRuntimeCwd = input.childRuntimeCwd;
    this.#childSpawn = input.childSpawn;
    this.#options = input.options;
  }

  async send(message: string): Promise<CursorRunLike> {
    return new BunChildCursorRun({
      options: this.#options,
      message,
      childRuntimeCwd: this.#childRuntimeCwd,
      childSpawn: this.#childSpawn,
    });
  }

  close(): void {
    return;
  }
}

export interface CursorSdkAdapterConfig {
  readonly apiKeyEnv?: string;
  readonly cwd?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly agentFactory?: (options: CursorAgentOptions) => Promise<CursorAgentLike>;
  readonly bunChildRuntimeCwd?: string;
  readonly bunChildSpawn?: CursorBunChildSpawn;
}

function formatCursorPrompt(input: AdapterExecutionInput): string {
  return input.systemPromptText === undefined
    ? input.promptText
    : `${input.systemPromptText}\n\n${input.promptText}`;
}

async function defaultAgentFactory(
  options: CursorAgentOptions,
  config: Pick<CursorSdkAdapterConfig, "bunChildRuntimeCwd" | "bunChildSpawn">,
): Promise<CursorAgentLike> {
  return new BunChildCursorAgent({
    options,
    childRuntimeCwd:
      config.bunChildRuntimeCwd ?? resolveCursorSdkBunChildRuntimeCwd(),
    childSpawn: config.bunChildSpawn ?? spawn,
  });
}

function resolveBunExecutable(): string {
  if ("bun" in process.versions) {
    return process.execPath;
  }
  return process.env["BUN_BINARY"] ?? "bun";
}

function resolveCursorSdkBunChildRuntimeCwd(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function parseCursorRunResult(value: unknown): CursorRunResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("response is not an object");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const status = record["status"];
  const result = record["result"];
  if (typeof status !== "string") {
    throw new Error("response status is not a string");
  }
  return {
    status,
    ...(typeof result === "string" ? { result } : {}),
  };
}

function normalizeCursorResult(result: CursorRunResult): string {
  if (result.status !== "finished") {
    throw new AdapterExecutionError(
      "provider_error",
      `Cursor SDK run ended with status '${result.status}'`,
    );
  }
  return result.result ?? "";
}

function redactSecret(text: string, secret: string): string {
  return secret.length === 0 ? text : text.split(secret).join("[REDACTED]");
}

function redactCursorAdapterError(
  error: AdapterExecutionError,
  apiKey: string,
): AdapterExecutionError {
  const message = redactSecret(error.message, apiKey);
  const processLogs = error.processLogs?.map((log) => ({
    ...log,
    text: redactSecret(log.text, apiKey),
  }));
  return new AdapterExecutionError(error.code, message, {
    ...(processLogs === undefined ? {} : { processLogs }),
  });
}

export class CursorSdkAdapter implements NodeAdapter {
  readonly #config: CursorSdkAdapterConfig;

  constructor(config: CursorSdkAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const apiKey = resolveConfiguredEnvValue(
      this.#config.apiKeyEnv,
      DEFAULT_CURSOR_API_KEY_ENV,
    );
    if (apiKey === undefined) {
      throw new AdapterExecutionError("policy_blocked", "missing Cursor API key");
    }

    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);
    const agentFactory =
      this.#config.agentFactory ??
      ((options) => defaultAgentFactory(options, this.#config));

    return executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        if (context.signal.aborted) {
          throw new AdapterExecutionError(
            "timeout",
            "official Cursor SDK request aborted",
          );
        }

        const agent = await agentFactory({
          apiKey,
          model: { id: input.node.model },
          local: { cwd: this.#config.cwd ?? input.workingDirectory },
        });

        let run: CursorRunLike | undefined;
        const abortHandler = () => {
          void run?.cancel().catch(() => undefined);
        };
        context.signal.addEventListener("abort", abortHandler, { once: true });

        try {
          run = await agent.send(formatCursorPrompt(input));
          if (context.signal.aborted) {
            await run.cancel().catch(() => undefined);
            throw new AdapterExecutionError(
              "timeout",
              "official Cursor SDK request aborted",
            );
          }
          const text = normalizeCursorResult(await run.wait());
          const normalizedPayload =
            input.output === undefined
              ? {
                  completionPassed: true,
                  when: { always: true },
                  payload: normalizeTextBusinessPayload(text),
                }
              : normalizeOutputContractEnvelope(
                  parseJsonObjectCandidate(text, "official Cursor SDK response"),
                  "official Cursor SDK response",
                );
          return {
            provider: "official-cursor-sdk",
            model: input.node.model,
            promptText: input.promptText,
            completionPassed: normalizedPayload.completionPassed,
            when: normalizedPayload.when,
            payload: normalizedPayload.payload,
          };
        } finally {
          context.signal.removeEventListener("abort", abortHandler);
          agent.close();
        }
      },
      normalizeError: (error: unknown) => {
        if (context.signal.aborted) {
          return new AdapterExecutionError(
            "timeout",
            "official Cursor SDK request aborted",
          );
        }
        return redactCursorAdapterError(
          normalizeAdapterFailure(error, "unknown Cursor SDK failure"),
          apiKey,
        );
      },
    });
  }
}
