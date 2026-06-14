import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "rielflow-core";
import { createCursorAgentSdk } from "cursor-cli-agent/sdk";
import {
  type LlmSessionStallWatchConfig,
} from "./llm-session-stall-watch";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  createWatchedLocalAgentSession,
  resolveAdapterImagePaths,
  throwIfAborted,
  withProcessEnvOverride,
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";
import { checkCursorBackendModelAvailability } from "./readiness";

type CursorAgentMode = "default" | "plan" | "ask";
type CursorAgentStreamMode = "event" | "normalized";

interface CursorAgentRequest {
  readonly prompt?: string;
  readonly systemPrompt?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly mode?: CursorAgentMode;
  readonly streamMode?: CursorAgentStreamMode;
  readonly images?: readonly string[];
  readonly trust?: boolean;
  readonly force?: boolean;
  readonly yolo?: boolean;
  readonly sandbox?: "enabled" | "disabled";
  readonly approveMcps?: boolean;
}

interface CursorAgentRunResult {
  readonly sessionId: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly events: readonly unknown[];
}

interface NormalizedMessage {
  readonly role: "user" | "assistant";
  readonly rawText: string;
  readonly displayText: string;
}

type CursorAgentEvent =
  | {
      readonly type: "session.started";
      readonly sessionId: string;
      readonly cwd: string;
      readonly model?: string;
    }
  | {
      readonly type: "session.pending";
      readonly recordId: string;
      readonly cursorChatId: string;
    }
  | {
      readonly type: "session.materialized";
      readonly recordId: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "session.user_message";
      readonly sessionId: string;
      readonly message: NormalizedMessage;
    }
  | {
      readonly type: "session.thinking";
      readonly sessionId: string;
      readonly state: "delta" | "completed";
    }
  | {
      readonly type: "session.assistant_message";
      readonly sessionId: string;
      readonly message: NormalizedMessage;
    }
  | {
      readonly type: "session.completed";
      readonly sessionId: string;
      readonly result: string;
    }
  | {
      readonly type: "session.error";
      readonly sessionId?: string;
      readonly message: string;
    };

interface CursorRunningAgentLike {
  readonly sessionId: string;
  messages(): AsyncIterable<unknown>;
  waitForCompletion(): Promise<CursorAgentRunResult>;
  cancel(): Promise<void>;
  interrupt(): Promise<void>;
}

interface CursorAgentRunnerLike {
  start(request: CursorAgentRequest): CursorRunningAgentLike;
  resume(
    request: CursorAgentRequest & { readonly sessionId: string },
  ): CursorRunningAgentLike;
}

interface CursorRunnerOptions {
  readonly cursorBinary?: string;
}

type CursorRunnerFactory = (
  options: CursorRunnerOptions,
) => CursorAgentRunnerLike | Promise<CursorAgentRunnerLike>;

export interface CursorAdapterConfig extends LlmSessionStallWatchConfig {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly authPreflight?: boolean;
  readonly authPreflightTimeoutMs?: number;
  readonly cwd?: string;
  readonly cursorBinary?: string;
  readonly mode?: CursorAgentMode;
  readonly streamMode?: CursorAgentStreamMode;
  readonly trust?: boolean;
  readonly force?: boolean;
  readonly yolo?: boolean;
  readonly sandbox?: "enabled" | "disabled";
  readonly approveMcps?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: CursorRunnerFactory;
  readonly checkAuthPreflight?: (
    input: AdapterExecutionInput,
    options: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly timeoutMs?: number;
    },
  ) => Promise<void>;
}

const DEFAULT_AUTH_PREFLIGHT_TIMEOUT_MS = 30_000;

async function createDefaultRunner(
  options: CursorRunnerOptions,
): Promise<CursorAgentRunnerLike> {
  const sdk = createCursorAgentSdk({
    ...(options.cursorBinary !== undefined
      ? { cursorBinary: options.cursorBinary }
      : {}),
  });
  return sdk.runner;
}

function shouldRunAuthPreflight(config: CursorAdapterConfig): boolean {
  if (config.authPreflight !== undefined) {
    return config.authPreflight;
  }
  return config.checkAuthPreflight !== undefined || config.createRunner === undefined;
}

async function runCursorAuthPreflight(
  config: CursorAdapterConfig,
  input: AdapterExecutionInput,
): Promise<void> {
  if (!shouldRunAuthPreflight(config)) {
    return;
  }
  const env = buildAmbientProcessEnv(
    config.env,
    input.rielflowHookContext === undefined
      ? undefined
      : { ...input.rielflowHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );
  const options = {
    cwd: config.cwd ?? input.workingDirectory,
    ...(env === undefined ? {} : { env }),
    timeoutMs: config.authPreflightTimeoutMs ?? DEFAULT_AUTH_PREFLIGHT_TIMEOUT_MS,
  };
  if (config.checkAuthPreflight !== undefined) {
    await config.checkAuthPreflight(input, options);
    return;
  }
  const availability = await checkCursorBackendModelAvailability({
    model: input.node.model,
    ...options,
    probe: true,
  });
  if (availability.binary.status !== "available") {
    throw new AdapterExecutionError(
      "policy_blocked",
      `cursor-cli-agent CLI is unavailable: ${availability.binary.error ?? "cursor-agent command is unavailable"}`,
    );
  }
  if (availability.auth.status === "unavailable") {
    throw new AdapterExecutionError(
      "policy_blocked",
      `cursor-cli-agent authentication is unavailable: ${availability.auth.detail}`,
    );
  }
  if (availability.modelReachability.status === "unavailable") {
    throw new AdapterExecutionError(
      "policy_blocked",
      `cursor-cli-agent model '${input.node.model}' is unavailable: ${availability.modelReachability.error ?? availability.modelReachability.output ?? "model probe failed"}`,
    );
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function extractAssistantMessageText(event: CursorAgentEvent): string | null {
  if (event.type !== "session.assistant_message") {
    return null;
  }
  const text =
    event.message.displayText.length > 0
      ? event.message.displayText
      : event.message.rawText;
  return text.length === 0 ? null : text;
}

const COMPOSER_MODEL_PREFIX = "composer-";

function modelSupportsCursorEffortSuffix(model: string): boolean {
  return !model.startsWith(COMPOSER_MODEL_PREFIX);
}

function resolveCursorAgentEffort(
  model: string,
  effort: string | undefined,
): string | undefined {
  if (effort === undefined || !modelSupportsCursorEffortSuffix(model)) {
    return undefined;
  }
  return effort;
}

function summarizeCursorAgentFailure(stderr: string): string | undefined {
  const line = stderr
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line;
}

interface CursorPermissionOptions {
  readonly trust: boolean;
  readonly force: boolean;
  readonly yolo: boolean;
  readonly sandbox: "enabled" | "disabled";
  readonly approveMcps: boolean;
}

function resolveCursorPermissionOptions(
  config: CursorAdapterConfig,
): CursorPermissionOptions {
  return {
    trust: config.trust !== undefined ? config.trust : true,
    force: config.force !== undefined ? config.force : true,
    yolo: config.yolo !== undefined ? config.yolo : true,
    sandbox: config.sandbox !== undefined ? config.sandbox : "disabled",
    approveMcps: config.approveMcps !== undefined ? config.approveMcps : true,
  };
}

function resolveLocalSessionConfig(
  config: CursorAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly startRequest: CursorAgentRequest;
  readonly baseResumeRequest: Omit<CursorAgentRequest, "prompt" | "sessionId">;
} {
  const promptText = buildCombinedPromptText(input);
  const cwd = config.cwd ?? input.workingDirectory;
  const streamMode: CursorAgentStreamMode = config.streamMode ?? "event";
  const images = resolveAdapterImagePaths(input);
  const effort = resolveCursorAgentEffort(input.node.model, input.node.effort);
  const permissionOptions = resolveCursorPermissionOptions(config);
  const baseRequest: Omit<CursorAgentRequest, "prompt" | "sessionId"> = {
    cwd,
    ...(input.systemPromptText === undefined
      ? {}
      : { systemPrompt: input.systemPromptText }),
    model: input.node.model,
    ...(effort === undefined ? {} : { effort }),
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    ...(images.length === 0 ? {} : { images }),
    streamMode,
    ...permissionOptions,
  };
  return {
    promptText,
    startRequest: { ...baseRequest, prompt: input.promptText },
    baseResumeRequest: baseRequest,
  };
}

async function executeLocalCursorAgent(
  config: CursorAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  throwIfAborted(context.signal, "cursor adapter aborted before start");

  const runner = await (config.createRunner ?? createDefaultRunner)({
    ...(config.cursorBinary === undefined
      ? {}
      : { cursorBinary: config.cursorBinary }),
  });

  const { promptText, startRequest, baseResumeRequest } =
    resolveLocalSessionConfig(config, input);
  const ambientEnv = buildAmbientProcessEnv(
    config.env,
    input.rielflowHookContext === undefined
      ? undefined
      : { ...input.rielflowHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );

  const session = await withProcessEnvOverride(ambientEnv, async () => {
    if (
      input.backendSession?.mode === "reuse" &&
      input.backendSession.sessionId !== undefined
    ) {
      return runner.resume({
        ...baseResumeRequest,
        sessionId: input.backendSession.sessionId,
        prompt: input.promptText,
      });
    }
    return runner.start(startRequest);
  });

  throwIfAborted(context.signal, "cursor adapter aborted before execution");

  let responseText = "";
  let completedResult = "";
  let sessionId = session.sessionId;
  const llmMessages: AdapterLlmSessionMessage[] = [];
  const processLogs: AdapterProcessLog[] = [];

  const disposeAbort = bindAbortSignal(context.signal, async () => {
    await session.cancel();
  });

  const watchedSession = createWatchedLocalAgentSession<
    CursorRunningAgentLike,
    CursorAgentRunResult
  >({
    provider: "cursor-cli-agent",
    primarySession: session,
    signal: context.signal,
    stallWatch: config,
    resumeSession: async (targetSessionId, prompt) =>
      await Promise.resolve(runner.resume({
        ...baseResumeRequest,
        sessionId: targetSessionId,
        prompt,
      })),
    isResultSuccess: (result) =>
      result.exitCode === 0 && result.signal === null,
    describeResult: (result) =>
      `exitCode=${String(result.exitCode)} signal=${result.signal ?? "null"}`,
    onProcessLog: (log) => {
      processLogs.push(log);
    },
  });

  try {
    for await (const rawEvent of watchedSession.messages) {
      if (typeof rawEvent !== "object" || rawEvent === null) {
        continue;
      }
      const event = rawEvent as CursorAgentEvent;

      if (event.type === "session.started") {
        sessionId = event.sessionId;
        continue;
      }

      if (event.type === "session.materialized" && event.sessionId.length > 0) {
        sessionId = event.sessionId;
        continue;
      }

      if (event.type === "session.completed" && event.result.length > 0) {
        completedResult = event.result;
        continue;
      }

      const assistantText = extractAssistantMessageText(event);
      if (assistantText !== null) {
        responseText = assistantText;
      }

      if (
        event.type === "session.assistant_message" ||
        event.type === "session.user_message"
      ) {
        const role: "assistant" | "user" =
          event.type === "session.assistant_message" ? "assistant" : "user";
        const rawMessageJson = stringifyUnknown(event);
        llmMessages.push({
          ordinal: llmMessages.length + 1,
          eventType: event.type,
          role,
          backendSessionId: sessionId,
          at: new Date().toISOString(),
          ...(assistantText !== null ? { contentText: assistantText } : {}),
          ...(rawMessageJson === undefined ? {} : { rawMessageJson }),
        });
      }
    }

    const result = await watchedSession.waitForCompletion();
    if (result.sessionId.length > 0) {
      sessionId = result.sessionId;
    }
    if (responseText.length === 0 && completedResult.length > 0) {
      responseText = completedResult;
    }
    const success = result.exitCode === 0 && result.signal === null;
    if (!success) {
      if (context.signal.aborted) {
        throw new AdapterExecutionError(
          "timeout",
          "cursor adapter aborted by timeout",
        );
      }
      const stderrHint = summarizeCursorAgentFailure(result.stderr);
      throw new AdapterExecutionError(
        "provider_error",
        `cursor agent session '${sessionId}' failed with exit code ${String(result.exitCode)} signal ${result.signal ?? "null"}${stderrHint === undefined ? "" : `: ${stderrHint}`}`,
      );
    }

    throwIfAborted(context.signal, "cursor adapter aborted after completion");
    const output = buildLocalAdapterOutput(
      { node: input.node, output: input.output },
      {
        provider: "cursor-cli-agent",
        promptText,
        responseText,
        backendSessionId: sessionId,
        llmMessages,
      },
    );
    return processLogs.length === 0 ? output : { ...output, processLogs };
  } finally {
    watchedSession.stop();
    disposeAbort();
  }
}

export class CursorCliAgentAdapter implements NodeAdapter {
  readonly #config: CursorAdapterConfig;

  constructor(config: CursorAdapterConfig = {}) {
    this.#config = config;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy({
      ...this.#config,
      defaultMaxAttempts: 1,
    });

    return await executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () => {
        await runCursorAuthPreflight(this.#config, input);
        return await executeLocalCursorAgent(this.#config, input, context);
      },
      normalizeError: (error) =>
        error instanceof DOMException && error.name === "AbortError"
          ? new AdapterExecutionError(
              "timeout",
              "cursor adapter aborted by timeout",
            )
          : normalizeAdapterFailure(error, "unknown cursor adapter failure"),
    });
  }
}
