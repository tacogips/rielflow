import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyClaudeReadiness } from "claude-code-agent/sdk";
import {
  checkCodexModelAvailability as checkCodexModelAvailabilitySdk,
  getCodexLoginStatus as getCodexLoginStatusSdk,
  getToolVersions as getToolVersionsSdk,
} from "codex-agent/sdk";
import { createCursorAgentSdk } from "cursor-cli-agent/sdk";
import type {
  ModelAvailabilityOptions as CursorModelAvailabilityOptions,
  ModelAvailabilityReport as CursorModelAvailabilityReport,
  ToolCommandRunOptions as CursorToolCommandRunOptions,
  ToolCommandRunResult as CursorToolCommandRunResult,
} from "cursor-cli-agent/sdk";

const DEFAULT_TOOL_TIMEOUT_MS = 5_000;
const DEFAULT_MODEL_TIMEOUT_MS = 30_000;

export interface AgentBackendProbeOptions {
  readonly codexBinary?: string;
  readonly cursorBinary?: string;
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

export interface ClaudeBackendCliAuthStatus {
  readonly available: boolean;
  readonly verified: boolean;
  readonly message?: string;
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

interface CodexBackendSdkOperations {
  readonly checkCodexModelAvailability: typeof checkCodexModelAvailabilitySdk;
  readonly getCodexLoginStatus: typeof getCodexLoginStatusSdk;
  readonly getToolVersions: typeof getToolVersionsSdk;
}

const defaultCodexBackendSdkOperations: CodexBackendSdkOperations = {
  checkCodexModelAvailability: checkCodexModelAvailabilitySdk,
  getCodexLoginStatus: getCodexLoginStatusSdk,
  getToolVersions: getToolVersionsSdk,
};

let codexBackendSdkOperations = defaultCodexBackendSdkOperations;

export function setCodexBackendSdkOperationsForTest(
  operations: Partial<CodexBackendSdkOperations> | undefined,
): void {
  codexBackendSdkOperations =
    operations === undefined
      ? defaultCodexBackendSdkOperations
      : { ...defaultCodexBackendSdkOperations, ...operations };
}

type CursorSdkCheckModelFn = (
  commandRunner: ReturnType<typeof createCursorCommandRunner>,
  options: CursorModelAvailabilityOptions,
  cursorBinary?: string,
) => Promise<CursorModelAvailabilityReport>;

const defaultCursorSdkCheckModel: CursorSdkCheckModelFn = async (
  commandRunner,
  options,
  cursorBinary,
) => {
  const sdk = createCursorAgentSdk({
    commandRunner,
    ...(cursorBinary !== undefined ? { cursorBinary } : {}),
  });
  return await sdk.tools.checkModel(options);
};

let cursorSdkCheckModelImpl: CursorSdkCheckModelFn = defaultCursorSdkCheckModel;

export function setCursorSdkCheckModelForTest(
  impl: CursorSdkCheckModelFn | undefined,
): void {
  cursorSdkCheckModelImpl = impl ?? defaultCursorSdkCheckModel;
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
  const captureDir = await mkdtemp(path.join(os.tmpdir(), "rielflow-probe-"));
  const captureId = randomUUID();
  const stdoutPath = path.join(captureDir, `${captureId}-stdout.log`);
  const stderrPath = path.join(captureDir, `${captureId}-stderr.log`);
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
  return await new Promise<ProbeCommandResult>((resolve) => {
    const child = spawn(
      "sh",
      [
        "-c",
        'exec "$@" >"$RIEL_PROBE_STDOUT" 2>"$RIEL_PROBE_STDERR"',
        "rielflow-probe",
        command,
        ...args,
      ],
      {
        cwd: options.cwd,
        env: {
          ...buildProcessEnv(options.env),
          RIEL_PROBE_STDOUT: stdoutPath,
          RIEL_PROBE_STDERR: stderrPath,
        },
        shell: false,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );

    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: ProbeCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      resolve(result);
    };

    child.on("error", (error: unknown) => {
      void (async () => {
        const logs = await readCapturedLogs();
        settle({
          exitCode: null,
          signal: null,
          stdout: logs.stdout,
          stderr: logs.stderr,
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
        });
      })();
    });

    child.on("close", (exitCode, signal) => {
      void (async () => {
        const logs = await readCapturedLogs();
        settle({
          exitCode,
          signal,
          stdout: logs.stdout,
          stderr: logs.stderr,
          timedOut,
          ...(timedOut
            ? { error: `command timed out after ${timeoutMs}ms` }
            : {}),
        });
      })();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
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

function normalizeCodexToolVersion(
  name: string,
  command: string,
  info:
    | {
        readonly version: string | null;
        readonly error: string | null;
      }
    | undefined,
): AgentBackendToolInfo {
  if (info === undefined) {
    return unavailableTool(name, command, "version command returned no result");
  }
  if (info.error === null && info.version !== null) {
    return availableTool(name, command, info.version);
  }
  return unavailableTool(
    name,
    command,
    info.error ?? "version command succeeded but produced no output",
  );
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
  readonly codexBinary?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly timeoutMs?: number | undefined;
}): AgentBackendProbeOptions {
  return {
    ...(input.codexBinary === undefined
      ? {}
      : { codexBinary: input.codexBinary }),
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
  const versions = await codexBackendSdkOperations.getToolVersions({
    includeGit: true,
    ...buildProbeOptions({
      codexBinary: options.codexBinary,
      cwd: options.cwd,
      env: options.env,
      timeoutMs: normalizeTimeout(options.timeoutMs, DEFAULT_TOOL_TIMEOUT_MS),
    }),
  });
  return {
    codex: normalizeCodexToolVersion("codex", "codex", versions.codex),
    git: normalizeCodexToolVersion("git", "git", versions.git),
  };
}

export async function getCodexBackendLoginStatus(
  options: AgentBackendProbeOptions = {},
): Promise<CodexBackendLoginStatus> {
  return await codexBackendSdkOperations.getCodexLoginStatus({
    ...buildProbeOptions({
      codexBinary: options.codexBinary,
      cwd: options.cwd,
      env: options.env,
      timeoutMs: normalizeTimeout(options.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
    }),
  });
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

export async function checkCodexBackendModelAvailability(input: {
  readonly model: string;
  readonly codexBinary?: string;
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
    return await codexBackendSdkOperations.checkCodexModelAvailability({
      model,
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...buildProbeOptions({
        codexBinary: input.codexBinary,
        cwd: input.cwd,
        env: input.env,
        timeoutMs: normalizeTimeout(input.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
      }),
    });
  } catch (error) {
    const message = toErrorMessage(error);
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

function parseClaudeCliAuthStatus(
  stdout: string,
): { readonly loggedIn: boolean | null; readonly message?: string } {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) {
      return { loggedIn: null };
    }
    const record = parsed as Record<string, unknown>;
    const loggedIn = record["loggedIn"];
    if (typeof loggedIn === "boolean") {
      return {
        loggedIn,
        ...(loggedIn
          ? {}
          : { message: "Claude Code CLI reports loggedIn=false" }),
      };
    }
  } catch {
    // Older Claude Code versions may print text while still exiting 0.
  }
  return { loggedIn: null };
}

export async function getClaudeBackendCliAuthStatus(
  options: AgentBackendProbeOptions = {},
): Promise<ClaudeBackendCliAuthStatus> {
  const result = await runProbeCommand("claude", ["auth", "status"], options);
  if (result.exitCode !== 0 || result.timedOut || result.error !== undefined) {
    return {
      available: false,
      verified: true,
      message: commandFailureMessage(result),
    };
  }

  const parsed = parseClaudeCliAuthStatus(result.stdout);
  if (parsed.loggedIn === false) {
    return {
      available: false,
      verified: true,
      ...(parsed.message === undefined ? {} : { message: parsed.message }),
    };
  }

  return {
    available: true,
    verified: parsed.loggedIn === true,
  };
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
      ...(options.cursorBinary !== undefined
        ? { cursorBinary: options.cursorBinary }
        : {}),
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
  readonly cursorBinary?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly probe?: boolean;
}): Promise<CursorBackendModelAvailability> {
  try {
    const commandRunner = createCursorCommandRunner(
      buildProbeOptions({
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
      }),
    );
    const report = await cursorSdkCheckModelImpl(commandRunner, {
      model: input.model,
      probe: input.probe ?? false,
      timeoutMs: normalizeTimeout(input.timeoutMs, DEFAULT_MODEL_TIMEOUT_MS),
      ...(input.cursorBinary === undefined
        ? {}
        : { cursorAgentBinary: input.cursorBinary }),
      ...(input.cwd === undefined ? {} : { workspace: input.cwd }),
    }, input.cursorBinary);
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
