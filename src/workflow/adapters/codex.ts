import {
  AdapterExecutionError,
  normalizeAdapterOutput,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type NodeAdapter,
} from "../adapter";
import {
  bindAbortSignal,
  buildAmbientProcessEnv,
  buildCombinedPromptText,
  buildLocalAdapterOutput,
  throwIfAborted,
  withProcessEnvOverride,
} from "./local-agent";
import {
  buildRemoteAgentRequestBody,
  executeWithRetry,
  normalizeAdapterFailure,
  resolveConfiguredEnvValue,
  resolveRetryPolicy,
} from "./shared";

export const DEFAULT_CODEX_ENDPOINT = "http://127.0.0.1:7070/codex/execute";
const DEFAULT_CODEX_API_KEY_ENV = "CODEX_API_KEY";

type CodexSandboxMode = "full" | "network-only" | "none";
type CodexApprovalMode =
  | "always"
  | "unless-allow-listed"
  | "never"
  | "on-failure";

interface CodexSessionRunnerOptions {
  readonly codexBinary?: string;
  readonly codexHome?: string;
}

interface CodexSessionConfig {
  readonly prompt: string;
  readonly cwd?: string;
  readonly sandbox?: CodexSandboxMode;
  readonly approvalMode?: CodexApprovalMode;
  readonly fullAuto?: boolean;
  readonly model?: string;
  readonly additionalArgs?: readonly string[];
  readonly images?: readonly string[];
  readonly streamGranularity?: "event" | "char";
}

interface CodexSessionResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly messageCount: number;
  };
}

type CodexNormalizedEvent =
  | {
      readonly type: "session.started";
      readonly sessionId: string;
    }
  | {
      readonly type: "assistant.snapshot";
      readonly sessionId: string;
      readonly content: string;
    }
  | {
      readonly type: "session.error";
      readonly sessionId?: string;
      readonly error: Error;
    };

interface CodexRunningSessionLike {
  readonly sessionId: string;
  messages(): AsyncIterable<unknown>;
  waitForCompletion(): Promise<CodexSessionResult>;
  cancel(): Promise<void>;
}

interface CodexSessionRunnerLike {
  startSession(config: CodexSessionConfig): Promise<CodexRunningSessionLike>;
  resumeSession(
    sessionId: string,
    prompt?: string,
    options?: Omit<CodexSessionConfig, "prompt">,
  ): Promise<CodexRunningSessionLike>;
}

type CodexRunnerFactory = (
  options: CodexSessionRunnerOptions,
) => CodexSessionRunnerLike | Promise<CodexSessionRunnerLike>;

export interface CodexAdapterConfig {
  readonly endpoint?: string;
  readonly apiKeyEnv?: string;
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly cwd?: string;
  readonly codexBinary?: string;
  readonly codexHome?: string;
  readonly sandbox?: CodexSandboxMode;
  readonly approvalMode?: CodexApprovalMode;
  readonly fullAuto?: boolean;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: CodexRunnerFactory;
}

function resolveApiKey(config: CodexAdapterConfig): string | undefined {
  return resolveConfiguredEnvValue(config.apiKeyEnv, DEFAULT_CODEX_API_KEY_ENV);
}

const importUnknownModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

async function createDefaultRunner(
  options: CodexSessionRunnerOptions,
): Promise<CodexSessionRunnerLike> {
  const module = (await importUnknownModule("codex-agent")) as {
    readonly SessionRunner: new (
      options?: CodexSessionRunnerOptions,
    ) => CodexSessionRunnerLike;
  };
  return new module.SessionRunner(options);
}

async function toCodexNormalizedEvents(
  chunks: AsyncIterable<unknown>,
): Promise<AsyncIterable<CodexNormalizedEvent>> {
  const module = (await importUnknownModule("codex-agent")) as {
    readonly toNormalizedEvents: (
      input: AsyncIterable<unknown>,
    ) => AsyncIterable<CodexNormalizedEvent>;
  };
  return module.toNormalizedEvents(chunks);
}

async function executeRemoteCodexAgent(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  const endpoint = config.endpoint ?? DEFAULT_CODEX_ENDPOINT;
  const apiKey = resolveApiKey(config);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey !== undefined) {
    headers["authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: context.signal,
    body: JSON.stringify(buildRemoteAgentRequestBody(input)),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AdapterExecutionError(
        "policy_blocked",
        `codex adapter request blocked (${response.status})`,
      );
    }
    if (response.status === 408 || response.status === 504) {
      throw new AdapterExecutionError(
        "timeout",
        `codex adapter request timeout (${response.status})`,
      );
    }
    throw new AdapterExecutionError(
      "provider_error",
      `codex adapter request failed (${response.status})`,
    );
  }

  const payload = (await response.json()) as unknown;
  return normalizeAdapterOutput(payload, input.node.model);
}

function resolveLocalSessionConfig(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: CodexSessionConfig;
} {
  const promptText = buildCombinedPromptText(input);
  return {
    promptText,
    sessionConfig: {
      prompt: promptText,
      cwd: config.cwd ?? process.cwd(),
      model: input.node.model,
      ...(config.sandbox === undefined ? {} : { sandbox: config.sandbox }),
      ...(config.approvalMode === undefined
        ? {}
        : { approvalMode: config.approvalMode }),
      ...(config.fullAuto === undefined ? {} : { fullAuto: config.fullAuto }),
      ...(config.additionalArgs === undefined
        ? {}
        : { additionalArgs: config.additionalArgs }),
      streamGranularity: "event",
    },
  };
}

function buildResumeSessionOptions(
  sessionConfig: CodexSessionConfig,
): Omit<CodexSessionConfig, "prompt"> {
  return {
    ...(sessionConfig.cwd === undefined ? {} : { cwd: sessionConfig.cwd }),
    ...(sessionConfig.model === undefined ? {} : { model: sessionConfig.model }),
    ...(sessionConfig.sandbox === undefined
      ? {}
      : { sandbox: sessionConfig.sandbox }),
    ...(sessionConfig.approvalMode === undefined
      ? {}
      : { approvalMode: sessionConfig.approvalMode }),
    ...(sessionConfig.fullAuto === undefined
      ? {}
      : { fullAuto: sessionConfig.fullAuto }),
    ...(sessionConfig.additionalArgs === undefined
      ? {}
      : { additionalArgs: sessionConfig.additionalArgs }),
    ...(sessionConfig.images === undefined
      ? {}
      : { images: sessionConfig.images }),
    ...(sessionConfig.streamGranularity === undefined
      ? {}
      : { streamGranularity: sessionConfig.streamGranularity }),
  };
}

function isCodexEvent(
  value: unknown,
): value is CodexNormalizedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { readonly type?: unknown }).type === "string"
  );
}

async function executeLocalCodexAgent(
  config: CodexAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  throwIfAborted(context.signal, "codex adapter aborted before start");

  const runner = await (config.createRunner ?? createDefaultRunner)({
    ...(config.codexBinary === undefined
      ? {}
      : { codexBinary: config.codexBinary }),
    ...(config.codexHome === undefined ? {} : { codexHome: config.codexHome }),
  });
  const { promptText, sessionConfig } = resolveLocalSessionConfig(config, input);
  const ambientEnv = buildAmbientProcessEnv(
    config.env,
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );

  const session = await withProcessEnvOverride(ambientEnv, async () => {
    if (
      input.backendSession?.mode === "reuse" &&
      input.backendSession.sessionId !== undefined
    ) {
      return await runner.resumeSession(
        input.backendSession.sessionId,
        promptText,
        buildResumeSessionOptions(sessionConfig),
      );
    }
    return await runner.startSession(sessionConfig);
  });

  throwIfAborted(context.signal, "codex adapter aborted before execution");

  let responseText = "";
  let sessionId = session.sessionId;
  let lastError: Error | undefined;
  const disposeAbort = bindAbortSignal(context.signal, async () => {
    await session.cancel();
  });

  try {
    const events = await toCodexNormalizedEvents(session.messages());
    for await (const event of events) {
      if (!isCodexEvent(event)) {
        continue;
      }
      switch (event.type) {
        case "session.started":
          sessionId = event.sessionId;
          break;
        case "assistant.snapshot":
          responseText = event.content;
          break;
        case "session.error":
          lastError = event.error;
          break;
      }
    }

    const result = await session.waitForCompletion();
    if (!result.success) {
      if (context.signal.aborted) {
        throw new AdapterExecutionError(
          "timeout",
          "codex adapter aborted by timeout",
        );
      }
      throw new AdapterExecutionError(
        "provider_error",
        lastError?.message ??
          `codex agent session '${sessionId}' failed with exit code ${result.exitCode}`,
      );
    }

    throwIfAborted(context.signal, "codex adapter aborted after completion");
    return buildLocalAdapterOutput(
      {
        node: input.node,
        output: input.output,
      },
      {
        provider: "codex-agent",
        promptText,
        responseText,
        backendSessionId: sessionId,
      },
    );
  } finally {
    disposeAbort();
  }
}

export class CodexAgentAdapter implements NodeAdapter {
  readonly #config: CodexAdapterConfig;

  constructor(config: CodexAdapterConfig = {}) {
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
        this.#config.endpoint === undefined
          ? await executeLocalCodexAgent(this.#config, input, context)
          : await executeRemoteCodexAgent(this.#config, input, context),
      normalizeError: (error) =>
        error instanceof DOMException && error.name === "AbortError"
          ? new AdapterExecutionError(
              "timeout",
              "codex adapter aborted by timeout",
            )
          : normalizeAdapterFailure(error, "unknown codex adapter failure"),
    });
  }
}
