import { spawn } from "node:child_process";
import { verifyClaudeReadiness } from "claude-code-agent/sdk";
import {
  checkCodexModelAvailability,
  getCodexLoginStatus,
  getToolVersions,
} from "codex-agent/sdk";
import type { ToolVersionInfo as CodexToolVersionInfo } from "codex-agent/sdk";
import { createCursorAgentSdk } from "cursor-cli-agent/sdk";
import type {
  ToolCommandRunOptions as CursorToolCommandRunOptions,
  ToolCommandRunResult as CursorToolCommandRunResult,
} from "cursor-cli-agent/sdk";

const DEFAULT_TOOL_TIMEOUT_MS = 5_000;
const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

export interface AgentBackendProbeOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

export interface AgentBackendToolInfo {
  readonly name: string;
  readonly command: string;
  readonly version: string | null;
  readonly status: "available" | "unavailable" | "unknown" | "not_checked";
  readonly error?: string;
}

export interface CodexBackendToolVersions {
  readonly codex: AgentBackendToolInfo;
  readonly git: AgentBackendToolInfo;
}

export interface CodexBackendLoginStatus {
  readonly ok: boolean;
  readonly status: string | null;
  readonly error: string | null;
  readonly exitCode: number | null;
}

export interface CodexBackendModelProbe {
  readonly ok: boolean;
  readonly model: string;
  readonly output: string | null;
  readonly error: string | null;
  readonly exitCode: number | null;
}

export interface CodexBackendModelAvailability {
  readonly ok: boolean;
  readonly model: string;
  readonly auth: CodexBackendLoginStatus;
  readonly probe: CodexBackendModelProbe;
}

export interface ClaudeBackendAuthReadiness {
  readonly state: "missing" | "expired" | "configured";
  readonly available: boolean;
  readonly verified: boolean;
  readonly message?: string;
}

export interface ClaudeBackendCliReadiness {
  readonly checked: boolean;
  readonly available: boolean;
  readonly command: string;
  readonly exitCode?: number | null;
  readonly message?: string;
}

export interface ClaudeBackendModelReadiness {
  readonly requested: string | null;
  readonly checked: boolean;
  readonly available: boolean;
  readonly timedOut: boolean;
  readonly exitCode?: number | null;
  readonly message?: string;
}

export interface ClaudeBackendReadiness {
  readonly ready: boolean;
  readonly auth: ClaudeBackendAuthReadiness;
  readonly cli: ClaudeBackendCliReadiness;
  readonly model: ClaudeBackendModelReadiness;
}

export interface CursorBackendToolVersions {
  readonly packageVersion: string;
  readonly tools: readonly AgentBackendToolInfo[];
}

export interface CursorBackendAuthAvailability {
  readonly status: "available" | "unavailable" | "unknown" | "not_checked";
  readonly detail: string;
}

export interface CursorBackendModelReachability {
  readonly status: "available" | "unavailable" | "unknown" | "not_checked";
  readonly probed: boolean;
  readonly output?: string;
  readonly error?: string;
}

export interface CursorBackendModelAvailability {
  readonly model: string;
  readonly binary: AgentBackendToolInfo;
  readonly auth: CursorBackendAuthAvailability;
  readonly modelReachability: CursorBackendModelReachability;
}

interface ProbeCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly error?: string;
}

function normalizeTimeout(
  value: number | undefined,
  fallback: number,
): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function firstLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildProcessEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env === undefined) {
    return nextEnv;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

function buildDefinedEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (env === undefined) {
    return undefined;
  }
  const definedEntries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return definedEntries.length === 0
    ? undefined
    : Object.fromEntries(definedEntries);
}

async function runProbeCommand(
  command: string,
  args: readonly string[],
  options: AgentBackendProbeOptions,
): Promise<ProbeCommandResult> {
  const timeoutMs = normalizeTimeout(options.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS);
  return await new Promise<ProbeCommandResult>((resolve) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: buildProcessEnv(options.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: ProbeCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: unknown) => {
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on("close", (exitCode, signal) => {
      settle({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut: false,
      });
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        timedOut: true,
        error: `command timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

function commandFailureMessage(result: ProbeCommandResult): string {
  if (result.timedOut) {
    return result.error ?? "command timed out";
  }
  if (result.error !== undefined && result.error.length > 0) {
    return result.error;
  }
  const reason =
    result.signal !== null
      ? `signal ${result.signal}`
      : `exit code ${String(result.exitCode ?? "unknown")}`;
  const details = firstLine(result.stderr) ?? firstLine(result.stdout);
  return details === null
    ? `command failed (${reason})`
    : `command failed (${reason}): ${details}`;
}

function availableTool(
  name: string,
  command: string,
  version: string,
): AgentBackendToolInfo {
  return { name, command, version, status: "available" };
}

function unavailableTool(
  name: string,
  command: string,
  error: string,
): AgentBackendToolInfo {
  return { name, command, version: null, status: "unavailable", error };
}

function normalizeCodexSdkToolInfo(
  name: string,
  command: string,
  result: CodexToolVersionInfo | undefined,
): AgentBackendToolInfo {
  if (result === undefined) {
    return unavailableTool(
      name,
      command,
      "tool was not reported by the bundled SDK",
    );
  }
  if (result.version !== null) {
    return availableTool(name, command, result.version);
  }
  return unavailableTool(name, command, result.error ?? "tool unavailable");
}

function normalizeCursorToolInfo(info: {
  readonly name: string;
  readonly command?: string;
  readonly version: string | null;
  readonly status: AgentBackendToolInfo["status"];
  readonly error?: string;
}): AgentBackendToolInfo {
  return {
    name: info.name,
    command: info.command ?? info.name,
    version: info.version,
    status: info.status,
    ...(info.error === undefined ? {} : { error: info.error }),
  };
}

function buildProbeOptions(input: {
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly timeoutMs?: number | undefined;
}): AgentBackendProbeOptions {
  return {
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function createCursorCommandRunner(options: AgentBackendProbeOptions) {
  return async (
    command: string,
    args: readonly string[],
    runOptions: CursorToolCommandRunOptions,
  ): Promise<CursorToolCommandRunResult> => {
    const result = await runProbeCommand(
      command,
      args,
      buildProbeOptions({
        cwd: runOptions.cwd ?? options.cwd,
        env: options.env,
        timeoutMs: runOptions.timeoutMs ?? options.timeoutMs,
      }),
    );
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  };
}

export async function getCodexBackendToolVersions(
  options: AgentBackendProbeOptions = {},
): Promise<CodexBackendToolVersions> {
  try {
    const toolVersions = await getToolVersions({
      includeGit: true,
      ...buildProbeOptions({
        cwd: options.cwd,
        env: options.env,
        timeoutMs: normalizeTimeout(
          options.timeoutMs,
          DEFAULT_TOOL_TIMEOUT_MS,
        ),
      }),
    });
    return {
      codex: normalizeCodexSdkToolInfo("codex", "codex", toolVersions.codex),
      git: normalizeCodexSdkToolInfo("git", "git", toolVersions.git),
    };
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      codex: unavailableTool("codex", "codex", message),
      git: unavailableTool("git", "git", message),
    };
  }
}

export async function getCodexBackendLoginStatus(
  options: AgentBackendProbeOptions = {},
): Promise<CodexBackendLoginStatus> {
  try {
    return await getCodexLoginStatus(
      buildProbeOptions({
        cwd: options.cwd,
        env: options.env,
        timeoutMs: normalizeTimeout(
          options.timeoutMs,
          DEFAULT_MODEL_TIMEOUT_MS,
        ),
      }),
    );
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: toErrorMessage(error),
      exitCode: null,
    };
  }
}

function codexModelAvailabilityOptions(input: {
  readonly model: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly prompt?: string;
}) {
  return {
    model: input.model,
    ...buildProbeOptions({
      cwd: input.cwd,
      env: input.env,
      timeoutMs: normalizeTimeout(input.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
    }),
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
  };
}

function blankModelAvailability(model: string): CodexBackendModelAvailability {
  const message = "model is required";
  return {
    ok: false,
    model,
    auth: {
      ok: false,
      status: null,
      error: message,
      exitCode: null,
    },
    probe: {
      ok: false,
      model,
      output: null,
      error: message,
      exitCode: null,
    },
  };
}

function codexModelProbeExceptionAvailability(input: {
  readonly model: string;
  readonly error: unknown;
}): CodexBackendModelAvailability {
  const message = toErrorMessage(input.error);
  return {
    ok: false,
    model: input.model,
    auth: {
      ok: false,
      status: null,
      error: message,
      exitCode: null,
    },
    probe: {
      ok: false,
      model: input.model,
      output: null,
      error: message,
      exitCode: null,
    },
  };
}

export async function checkCodexBackendModelAvailability(input: {
  readonly model: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly prompt?: string;
}): Promise<CodexBackendModelAvailability> {
  const model = input.model.trim();
  if (model.length === 0) {
    return blankModelAvailability(input.model);
  }
  try {
    return await checkCodexModelAvailability(
      codexModelAvailabilityOptions({
        ...input,
        model,
      }),
    );
  } catch (error) {
    return codexModelProbeExceptionAvailability({
      model,
      error,
    });
  }
}

export async function getClaudeBackendToolVersion(
  options: AgentBackendProbeOptions = {},
): Promise<AgentBackendToolInfo> {
  try {
    const result = await runProbeCommand("claude", ["--version"], options);
    if (
      result.exitCode === 0 &&
      !result.timedOut &&
      result.error === undefined
    ) {
      const version = firstLine(result.stdout) ?? firstLine(result.stderr);
      return version === null
        ? unavailableTool(
            "claude",
            "claude",
            "version command succeeded but produced no output",
          )
        : availableTool("claude", "claude", version);
    }
    return unavailableTool("claude", "claude", commandFailureMessage(result));
  } catch (error) {
    return unavailableTool("claude", "claude", toErrorMessage(error));
  }
}

export async function verifyClaudeBackendReadiness(
  options: AgentBackendProbeOptions & {
    readonly model?: string;
    readonly prompt?: string;
  } = {},
): Promise<ClaudeBackendReadiness> {
  try {
    const result = await verifyClaudeReadiness({
      cwd: options.cwd,
      env: buildDefinedEnv(options.env),
      timeoutMs: normalizeTimeout(options.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
    });
    return {
      ready: result.ready,
      auth: {
        state: result.auth.state,
        available: result.auth.available,
        verified: result.auth.verified,
        ...(result.auth.message === undefined
          ? {}
          : { message: result.auth.message }),
      },
      cli: {
        checked: result.cli.checked,
        available: result.cli.available,
        command: result.cli.command,
        ...(result.cli.exitCode === undefined
          ? {}
          : { exitCode: result.cli.exitCode }),
        ...(result.cli.message === undefined
          ? {}
          : { message: result.cli.message }),
      },
      model: {
        requested: result.model.requested,
        checked: result.model.checked,
        available: result.model.available,
        timedOut: result.model.timedOut,
        ...(result.model.exitCode === undefined
          ? {}
          : { exitCode: result.model.exitCode }),
        ...(result.model.message === undefined
          ? {}
          : { message: result.model.message }),
      },
    };
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      ready: false,
      auth: {
        state: "missing",
        available: false,
        verified: false,
        message,
      },
      cli: {
        checked: false,
        available: false,
        command: "claude",
        message,
      },
      model: {
        requested: options.model ?? null,
        checked: false,
        available: false,
        timedOut: false,
        message,
      },
    };
  }
}

export async function getCursorBackendToolVersions(
  options: AgentBackendProbeOptions = {},
): Promise<CursorBackendToolVersions> {
  try {
    const sdk = createCursorAgentSdk({
      commandRunner: createCursorCommandRunner(options),
    });
    const report = await sdk.tools.versions({
      timeoutMs: normalizeTimeout(options.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS),
    });
    return {
      packageVersion: report.packageVersion,
      tools: report.tools.map(normalizeCursorToolInfo),
    };
  } catch (error) {
    return {
      packageVersion: "unknown",
      tools: [
        unavailableTool("cursor-agent", "cursor-agent", toErrorMessage(error)),
      ],
    };
  }
}

export async function checkCursorBackendModelAvailability(input: {
  readonly model: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly probe?: boolean;
}): Promise<CursorBackendModelAvailability> {
  try {
    const sdk = createCursorAgentSdk({
      commandRunner: createCursorCommandRunner(
        buildProbeOptions({
          cwd: input.cwd,
          env: input.env,
          timeoutMs: input.timeoutMs,
        }),
      ),
    });
    const report = await sdk.tools.checkModel({
      model: input.model,
      probe: input.probe ?? true,
      timeoutMs: normalizeTimeout(input.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
      ...(input.cwd === undefined ? {} : { workspace: input.cwd }),
    });
    return {
      model: report.model,
      binary: normalizeCursorToolInfo(report.binary),
      auth: {
        status: report.auth.status,
        detail: report.auth.detail,
      },
      modelReachability: {
        status: report.modelReachability.status,
        probed: report.modelReachability.probed,
        ...(report.modelReachability.output === undefined
          ? {}
          : { output: report.modelReachability.output }),
        ...(report.modelReachability.error === undefined
          ? {}
          : { error: report.modelReachability.error }),
      },
    };
  } catch (error) {
    const message = toErrorMessage(error);
    return {
      model: input.model,
      binary: unavailableTool("cursor-agent", "cursor-agent", message),
      auth: {
        status: "unknown",
        detail: "Cursor auth was not checked because the SDK probe failed.",
      },
      modelReachability: {
        status: "unavailable",
        probed: false,
        error: message,
      },
    };
  }
}
