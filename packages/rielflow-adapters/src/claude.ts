import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname, resolve } from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "rielflow-core";
import { SessionRunner } from "claude-code-agent/sdk";
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
} from "./local-agent";
import {
  executeWithRetry,
  normalizeAdapterFailure,
  resolveRetryPolicy,
} from "./shared";
import {
  getClaudeBackendCliAuthStatus,
  getClaudeBackendToolVersion,
} from "./readiness";

type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

interface ClaudeSessionConfig {
  readonly prompt: string;
  readonly projectPath?: string;
  readonly systemPrompt?: string;
  readonly attachments?: readonly ClaudeSessionAttachment[];
}

interface ClaudeSessionAttachment {
  readonly path: string;
}

interface ClaudeSessionRunnerOptions {
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly permissionMode?: PermissionMode;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

interface ClaudeSessionResult {
  readonly success: boolean;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly toolCallCount: number;
    readonly messageCount: number;
  };
}

interface ClaudeRunningSessionLike {
  readonly sessionId: string;
  messages(): AsyncIterable<object>;
  waitForCompletion(): Promise<ClaudeSessionResult>;
  cancel(): Promise<void>;
  getState?(): unknown;
  on(event: "error", listener: (error: unknown) => void): void;
  removeListener(event: "error", listener: (error: unknown) => void): void;
}

interface ClaudeSessionRunnerLike {
  startSession(config: ClaudeSessionConfig): Promise<ClaudeRunningSessionLike>;
  resumeSession(
    sessionId: string,
    prompt?: string,
    systemPrompt?: string,
    attachments?: readonly ClaudeSessionAttachment[],
  ): Promise<ClaudeRunningSessionLike>;
}

type ClaudeRunnerFactory = (
  options: ClaudeSessionRunnerOptions,
) => ClaudeSessionRunnerLike | Promise<ClaudeSessionRunnerLike>;

export interface ClaudeAdapterConfig extends LlmSessionStallWatchConfig {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
  readonly authPreflight?: boolean;
  readonly authPreflightTimeoutMs?: number;
  readonly cwd?: string;
  readonly permissionMode?: PermissionMode;
  readonly additionalArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createRunner?: ClaudeRunnerFactory;
  readonly checkAuthPreflight?: (
    input: AdapterExecutionInput,
    options: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string | undefined>>;
      readonly timeoutMs?: number;
    },
  ) => Promise<void>;
}

const DEFAULT_AUTH_PREFLIGHT_TIMEOUT_MS = 5_000;
const CLAUDE_PRINT_ABORT_KILL_GRACE_MS = 2_000;

async function createDefaultRunner(
  options: ClaudeSessionRunnerOptions,
): Promise<ClaudeSessionRunnerLike> {
  return new SessionRunner(options);
}

function shouldRunAuthPreflight(config: ClaudeAdapterConfig): boolean {
  if (config.authPreflight !== undefined) {
    return config.authPreflight;
  }
  return config.checkAuthPreflight !== undefined || config.createRunner === undefined;
}

async function runClaudeAuthPreflight(
  config: ClaudeAdapterConfig,
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
  const cli = await getClaudeBackendToolVersion(options);
  if (cli.status !== "available") {
    throw new AdapterExecutionError(
      "policy_blocked",
      `claude-code-agent CLI is unavailable: ${cli.error ?? "claude command is unavailable"}`,
    );
  }
  const auth = await getClaudeBackendCliAuthStatus(options);
  if (!auth.available) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `claude-code-agent authentication is unavailable: ${auth.message ?? "auth verify failed"}`,
    );
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }

    const record = toRecord(block);
    if (record === null) {
      continue;
    }

    const textValue = record["text"];
    if (
      typeof textValue === "string" &&
      textValue.length > 0 &&
      (record["type"] === "text" ||
        record["type"] === "output_text" ||
        record["type"] === "input_text")
    ) {
      parts.push(textValue);
    }
  }

  return parts.join("");
}

function extractAssistantText(message: object): string | null {
  const root = toRecord(message);
  if (root === null) {
    return null;
  }

  const topLevelType = typeof root["type"] === "string" ? root["type"] : null;
  const roleFromRoot = typeof root["role"] === "string" ? root["role"] : null;
  const messageRecord = toRecord(root["message"]);
  const roleFromMessage =
    messageRecord !== null && typeof messageRecord["role"] === "string"
      ? messageRecord["role"]
      : null;
  const isAssistant =
    topLevelType === "assistant" ||
    roleFromRoot === "assistant" ||
    roleFromMessage === "assistant";

  if (!isAssistant) {
    return null;
  }

  const contentSource =
    messageRecord?.["content"] ?? root["content"] ?? messageRecord;
  const text = extractTextFromContent(contentSource);
  return text.length === 0 ? null : text;
}

function extractMessageRole(message: object): string | undefined {
  const root = toRecord(message);
  if (root === null) {
    return undefined;
  }
  const rootRole = root["role"];
  if (typeof rootRole === "string" && rootRole.length > 0) {
    return rootRole;
  }
  const messageRecord = toRecord(root["message"]);
  const nestedRole = messageRecord?.["role"];
  return typeof nestedRole === "string" && nestedRole.length > 0
    ? nestedRole
    : undefined;
}

function extractMessageEventType(message: object): string {
  const root = toRecord(message);
  const eventType = root?.["type"];
  return typeof eventType === "string" && eventType.length > 0
    ? eventType
    : "message";
}

function stringifyUnknown(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function resolveLocalSessionConfig(
  config: ClaudeAdapterConfig,
  input: AdapterExecutionInput,
): {
  readonly promptText: string;
  readonly sessionConfig: ClaudeSessionConfig;
  readonly runnerOptions: ClaudeSessionRunnerOptions;
} {
  const promptText = buildCombinedPromptText(input);
  const images = resolveAdapterImagePaths(input);
  const env = buildAmbientProcessEnv(
    config.env,
    input.rielflowHookContext === undefined
      ? undefined
      : { ...input.rielflowHookContext.environment },
    input.ambientManagerContext === undefined
      ? undefined
      : { ...input.ambientManagerContext.environment },
  );

  return {
    promptText,
    sessionConfig: {
      prompt: input.promptText,
      projectPath: config.cwd ?? input.workingDirectory,
      ...(input.systemPromptText === undefined
        ? {}
        : { systemPrompt: input.systemPromptText }),
      ...(images.length === 0
        ? {}
        : { attachments: images.map((imagePath) => ({ path: imagePath })) }),
    },
    runnerOptions: {
      cwd: config.cwd ?? input.workingDirectory,
      model: input.node.model,
      ...(input.node.effort === undefined ? {} : { effort: input.node.effort }),
      ...(config.permissionMode === undefined
        ? {}
        : { permissionMode: config.permissionMode }),
      ...(config.additionalArgs === undefined
        ? {}
        : { additionalArgs: [...config.additionalArgs] }),
      ...(env === undefined ? {} : { env: { ...env } }),
    },
  };
}

function buildClaudePrintArgs(input: {
  readonly config: ClaudeAdapterConfig;
  readonly sessionConfig: ClaudeSessionConfig;
  readonly model: string;
  readonly effort?: string;
}): readonly string[] {
  const args = ["-p", "--output-format", "text", "--model", input.model];
  if (input.effort !== undefined) {
    args.push("--effort", input.effort);
  }
  if (input.config.permissionMode !== undefined) {
    args.push("--permission-mode", input.config.permissionMode);
  }
  if (input.sessionConfig.attachments !== undefined) {
    const directories = new Set<string>();
    for (const attachment of input.sessionConfig.attachments) {
      directories.add(resolve(dirname(attachment.path)));
    }
    for (const directory of directories) {
      args.push("--add-dir", directory);
    }
  }
  if (input.config.additionalArgs !== undefined) {
    args.push(...input.config.additionalArgs);
  }
  return args;
}

function buildClaudePrintPrompt(
  prompt: string,
  systemPrompt: string | undefined,
  attachments: readonly ClaudeSessionAttachment[] | undefined,
): string {
  const promptParts =
    systemPrompt === undefined
      ? [prompt]
      : ["System instruction:", systemPrompt, "", "User instruction:", prompt];
  if (attachments === undefined || attachments.length === 0) {
    return promptParts.join("\n");
  }
  return [
    ...promptParts,
    "",
    "Attached files:",
    ...attachments.map((attachment) => `- ${attachment.path}`),
  ].join("\n");
}

async function runClaudePrintCommand(input: {
  readonly args: readonly string[];
  readonly prompt: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const captureDir = await mkdtemp(path.join(os.tmpdir(), "rielflow-claude-"));
  const captureId = randomUUID();
  const stdinPath = path.join(captureDir, `${captureId}-stdin.txt`);
  const stdoutPath = path.join(captureDir, `${captureId}-stdout.log`);
  const stderrPath = path.join(captureDir, `${captureId}-stderr.log`);
  const childEnv: NodeJS.ProcessEnv = {
    ...(input.env === undefined
      ? process.env
      : { ...process.env, ...input.env }),
    RIEL_CLAUDE_STDIN: stdinPath,
    RIEL_CLAUDE_STDOUT: stdoutPath,
    RIEL_CLAUDE_STDERR: stderrPath,
  };
  delete childEnv["RIEL_MAILBOX_DIR"];
  await writeFile(stdinPath, input.prompt, "utf8");
  const readCapturedLogs = async (): Promise<{
    readonly stdout: string;
    readonly stderr: string;
  }> => {
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, "utf8").catch(() => ""),
      readFile(stderrPath, "utf8").catch(() => ""),
    ]);
    await rm(captureDir, { recursive: true, force: true }).catch(() => {});
    return { stdout, stderr };
  };
  return await new Promise((resolve, reject) => {
    if (input.signal.aborted) {
      reject(new AdapterExecutionError("timeout", "claude adapter aborted"));
      return;
    }

    const child = spawn(
      "sh",
      [
        "-c",
        'exec "$@" <"$RIEL_CLAUDE_STDIN" >"$RIEL_CLAUDE_STDOUT" 2>"$RIEL_CLAUDE_STDERR"',
        "rielflow-claude",
        "claude",
        ...input.args,
      ],
      {
        cwd: input.cwd,
        env: childEnv,
        detached: true,
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );

    let settled = false;
    let abortRequested = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (callback: () => void | Promise<void>): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.signal.removeEventListener("abort", onAbort);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      void callback();
    };

    const onAbort = (): void => {
      abortRequested = true;
      killClaudePrintProcess(child.pid, "SIGTERM");
      killTimer = setTimeout(() => {
        killClaudePrintProcess(child.pid, "SIGKILL");
      }, CLAUDE_PRINT_ABORT_KILL_GRACE_MS);
    };

    input.signal.addEventListener("abort", onAbort, { once: true });
    if (input.signal.aborted) {
      onAbort();
    }
    child.on("error", (error: unknown) => {
      settle(async () => {
        await readCapturedLogs();
        reject(error);
      });
    });
    child.on("close", (code, signal) => {
      settle(async () => {
        const logs = await readCapturedLogs();
        if (abortRequested) {
          reject(
            new AdapterExecutionError("timeout", "claude adapter aborted"),
          );
          return;
        }
        if (code === 0) {
          resolve(logs);
          return;
        }
        const reason =
          signal === null
            ? `exit code ${String(code ?? "unknown")}`
            : `signal ${signal}`;
        const detail = logs.stderr.trim() || logs.stdout.trim() || reason;
        reject(
          new AdapterExecutionError(
            "provider_error",
            `claude print command failed (${reason}): ${detail}`,
          ),
        );
      });
    });
  });
}

function killClaudePrintProcess(
  pid: number | undefined,
  signal: NodeJS.Signals,
): void {
  if (pid === undefined) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may have already exited.
    }
  }
}

async function executeClaudePrintMode(
  config: ClaudeAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  const { promptText, sessionConfig, runnerOptions } =
    resolveLocalSessionConfig(config, input);
  const result = await runClaudePrintCommand({
    args: buildClaudePrintArgs({
      config,
      sessionConfig,
      model: input.node.model,
      ...(input.node.effort === undefined
        ? {}
        : { effort: input.node.effort }),
    }),
    prompt: buildClaudePrintPrompt(
      sessionConfig.prompt,
      sessionConfig.systemPrompt,
      sessionConfig.attachments,
    ),
    ...(runnerOptions.cwd === undefined ? {} : { cwd: runnerOptions.cwd }),
    ...(runnerOptions.env === undefined ? {} : { env: runnerOptions.env }),
    signal: context.signal,
  });
  return buildLocalAdapterOutput(
    {
      node: input.node,
      output: input.output,
    },
    {
      provider: "claude-code-agent",
      promptText,
      responseText: result.stdout.trim(),
      llmMessages: [
        {
          ordinal: 1,
          eventType: "message",
          role: "assistant",
          at: new Date().toISOString(),
          contentText: result.stdout.trim(),
          rawMessageJson: JSON.stringify({
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        },
      ],
    },
  );
}

async function executeLocalClaudeCodeAgent(
  config: ClaudeAdapterConfig,
  input: AdapterExecutionInput,
  context: AdapterExecutionContext,
): Promise<AdapterExecutionOutput> {
  throwIfAborted(context.signal, "claude adapter aborted before start");

  if (config.createRunner === undefined && input.backendSession === undefined) {
    return await executeClaudePrintMode(config, input, context);
  }

  const { promptText, sessionConfig, runnerOptions } =
    resolveLocalSessionConfig(config, input);
  const runner = await (config.createRunner ?? createDefaultRunner)(
    runnerOptions,
  );
  const session =
    input.backendSession?.mode === "reuse" &&
    input.backendSession.sessionId !== undefined
      ? await runner.resumeSession(
          input.backendSession.sessionId,
          input.promptText,
          input.systemPromptText,
          sessionConfig.attachments,
        )
      : await runner.startSession(sessionConfig);

  throwIfAborted(context.signal, "claude adapter aborted before execution");

  let responseText = "";
  let lastError: Error | undefined;
  const llmMessages: AdapterLlmSessionMessage[] = [];
  const processLogs: AdapterProcessLog[] = [];
  const onError = (error: unknown) => {
    lastError =
      error instanceof Error ? error : new Error(String(error ?? "unknown"));
  };
  session.on("error", onError);
  const disposeAbort = bindAbortSignal(context.signal, async () => {
    await session.cancel();
  });
  const watchedSession = createWatchedLocalAgentSession<
    ClaudeRunningSessionLike,
    ClaudeSessionResult
  >({
    provider: "claude-code-agent",
    primarySession: session,
    signal: context.signal,
    stallWatch: config,
    resumeSession: async (targetSessionId, prompt) =>
      await runner.resumeSession(
        targetSessionId,
        prompt,
        input.systemPromptText,
        sessionConfig.attachments,
      ),
    isResultSuccess: (result) => result.success,
    describeResult: (result) =>
      `success=${result.success} messages=${result.stats.messageCount} tools=${result.stats.toolCallCount}`,
    onProcessLog: (log) => {
      processLogs.push(log);
    },
  });

  try {
    for await (const rawMessage of watchedSession.messages) {
      if (typeof rawMessage !== "object" || rawMessage === null) {
        continue;
      }
      const message = rawMessage;
      const assistantText = extractAssistantText(message);
      if (assistantText !== null) {
        responseText = assistantText;
      }
      const role = extractMessageRole(message);
      const rawMessageJson = stringifyUnknown(message);
      llmMessages.push({
        ordinal: llmMessages.length + 1,
        eventType: extractMessageEventType(message),
        backendSessionId: session.sessionId,
        at: new Date().toISOString(),
        ...(role === undefined ? {} : { role }),
        ...(assistantText === null ? {} : { contentText: assistantText }),
        ...(rawMessageJson === undefined ? {} : { rawMessageJson }),
      });
    }

    const result = await watchedSession.waitForCompletion();
    if (!result.success) {
      if (context.signal.aborted) {
        throw new AdapterExecutionError(
          "timeout",
          "claude adapter aborted by timeout",
        );
      }
      throw new AdapterExecutionError(
        "provider_error",
        lastError?.message ??
          `claude agent session '${session.sessionId}' failed`,
      );
    }

    throwIfAborted(context.signal, "claude adapter aborted after completion");
    const output = buildLocalAdapterOutput(
      {
        node: input.node,
        output: input.output,
      },
      {
        provider: "claude-code-agent",
        promptText,
        responseText,
        backendSessionId: session.sessionId,
        llmMessages,
      },
    );
    return processLogs.length === 0 ? output : { ...output, processLogs };
  } finally {
    watchedSession.stop();
    disposeAbort();
    session.removeListener("error", onError);
  }
}

export class ClaudeCodeAgentAdapter implements NodeAdapter {
  readonly #config: ClaudeAdapterConfig;

  constructor(config: ClaudeAdapterConfig = {}) {
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
        await runClaudeAuthPreflight(this.#config, input);
        return await executeLocalClaudeCodeAgent(this.#config, input, context);
      },
      normalizeError: (error) =>
        error instanceof DOMException && error.name === "AbortError"
          ? new AdapterExecutionError(
              "timeout",
              "claude adapter aborted by timeout",
            )
          : normalizeAdapterFailure(error, "unknown claude adapter failure"),
    });
  }
}
