import { pathToFileURL } from "node:url";
import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "divedra-core";
import {
  type LlmSessionStallWatchConfig,
} from "./llm-session-stall-watch";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  createWatchedLocalAgentSession,
  throwIfAborted,
  withProcessEnvOverride,
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";

type CursorAgentMode = "default" | "plan" | "ask";
type CursorAgentStreamMode = "event" | "normalized";

interface CursorAgentRequest {
  readonly prompt?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly model?: string;
  readonly mode?: CursorAgentMode;
  readonly streamMode?: CursorAgentStreamMode;
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
  readonly cwd?: string;
  readonly cursorBinary?: string;
  readonly mode?: CursorAgentMode;
  readonly streamMode?: CursorAgentStreamMode;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: CursorRunnerFactory;
}

const importUnknownModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

async function createDefaultRunner(
  options: CursorRunnerOptions,
): Promise<CursorAgentRunnerLike> {
  const modulePath = pathToFileURL(
    `${process.cwd()}/node_modules/cursor-cli-agent/src/sdk/index.ts`,
  ).href;
  const module = (await importUnknownModule(modulePath)) as {
    readonly createCursorAgentSdk: (options?: {
      readonly cursorBinary?: string;
    }) => {
      readonly runner: CursorAgentRunnerLike;
    };
  };
  const sdk = module.createCursorAgentSdk({
    ...(options.cursorBinary !== undefined
      ? { cursorBinary: options.cursorBinary }
      : {}),
  });
  return sdk.runner;
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
  const baseRequest: Omit<CursorAgentRequest, "prompt" | "sessionId"> = {
    cwd,
    model: input.node.model,
    ...(config.mode === undefined ? {} : { mode: config.mode }),
    streamMode,
  };
  return {
    promptText,
    startRequest: { ...baseRequest, prompt: promptText },
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
    input.divedraHookContext === undefined
      ? undefined
      : { ...input.divedraHookContext.environment },
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
        prompt: promptText,
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
      throw new AdapterExecutionError(
        "provider_error",
        `cursor agent session '${sessionId}' failed with exit code ${String(result.exitCode)} signal ${result.signal ?? "null"}`,
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
    const { maxAttempts, retryDelayMs } = resolveRetryPolicy(this.#config);

    return await executeWithRetry({
      maxAttempts,
      retryDelayMs,
      signal: context.signal,
      run: async () =>
        await executeLocalCursorAgent(this.#config, input, context),
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
