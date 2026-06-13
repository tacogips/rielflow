import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteTextFile,
  isContainerRunnerWithDockerCli,
} from "../../../rielflow-core/src/index";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
  normalizeOutputContractEnvelope,
} from "../../../rielflow-core/src/index";
import type { NodeExecutionMailbox } from "../../../rielflow-core/src/index";
import { buildPromptTemplateVariables } from "../../../rielflow-core/src/index";
import { renderPromptTemplate } from "../../../rielflow-core/src/index";
import type { SuperviserRuntimeControl } from "../../../rielflow-core/src/index";
import type {
  ChatReplyDispatcher,
  ContainerExecution,
  ContainerRunnerKind,
  NodePayload,
  SuperviserControlAddonName,
  WorkflowDefaults,
} from "../../../rielflow-core/src/index";
import { resolveNodeExecutionWorkingDirectory } from "../../../rielflow-core/src/index";

export const X_GATEWAY_READ_BINARY = "x-gateway-reader";
export const X_GATEWAY_BINARY = "x-gateway";
export const MAIL_GATEWAY_READ_BINARY = "mail-gateway-reader";
export const MAIL_GATEWAY_BINARY = "mail-gateway";
const RESERVED_NATIVE_WORKER_ENV_KEYS = new Set([
  "RIEL_RESOLVED_INPUT_PATH",
  "RIEL_MAILBOX_DIR",
  "RIELFLOW_WORKFLOW_INPUT",
  "RIELFLOW_WORKFLOW_OUTPUT",
]);
export interface NativeNodeExecutionContext {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}
export interface NativeNodeExecutionInput {
  readonly workflowDirectory: string;
  readonly workflowWorkingDirectory: string;
  readonly artifactWorkflowRoot: string;
  readonly workflowId: string;
  readonly workflowDescription: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly node: NodePayload;
  readonly workflowDefaults: WorkflowDefaults;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly mergedVariables: Readonly<Record<string, unknown>>;
  readonly arguments: Readonly<Record<string, unknown>> | null;
  readonly artifactDir: string;
  readonly executionMailbox: NodeExecutionMailbox;
  readonly chatReplyDispatcher?: ChatReplyDispatcher;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Present when executing a phase-2 nested superviser workflow so
   * {@link SuperviserControlAddonName} add-ons can manage the paired target run.
   */
  readonly superviserControl?: SuperviserRuntimeControl;
}
export interface SpawnedProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}
export function resolveTemplateVariables(
  input: NativeNodeExecutionInput,
): Readonly<Record<string, unknown>> {
  return buildPromptTemplateVariables({
    nodeVariables: input.node.variables,
    runtimeVariables: input.runtimeVariables,
    workflowId: input.workflowId,
    workflowDescription: input.workflowDescription,
    nodeId: input.nodeId,
    upstream: input.executionMailbox.input.upstream,
    args: input.arguments,
  });
}
export function renderTemplateEntries(
  entries: readonly string[] | undefined,
  variables: Readonly<Record<string, unknown>>,
): readonly string[] {
  return (entries ?? []).map((entry) => renderPromptTemplate(entry, variables));
}
export function renderTemplateMap(
  entries: Readonly<Record<string, string>> | undefined,
  variables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  if (entries === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      renderPromptTemplate(value, variables),
    ]),
  );
}
export interface RielflowExecutionEnvInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}
export function buildRielflowExecutionEnv(
  input: RielflowExecutionEnvInput,
): Readonly<Record<string, string>> {
  return {
    RIEL_WORKFLOW_ID: input.workflowId,
    RIEL_WORKFLOW_EXECUTION_ID: input.workflowExecutionId,
    RIEL_NODE_ID: input.nodeId,
    RIEL_NODE_EXEC_ID: input.nodeExecId,
  };
}
function buildResolvedInputJson(input: {
  readonly executionMailbox: NodeExecutionMailbox;
}): string {
  return `${JSON.stringify(input.executionMailbox.input)}\n`;
}
function stripReservedNativeWorkerEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const stripped: NodeJS.ProcessEnv = { ...env };
  for (const key of RESERVED_NATIVE_WORKER_ENV_KEYS) {
    delete stripped[key];
  }
  return stripped;
}
function appendRenderedWorkerEnv(
  env: NodeJS.ProcessEnv,
  renderedEnv: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const merged = { ...env };
  for (const [key, value] of Object.entries(renderedEnv)) {
    if (!RESERVED_NATIVE_WORKER_ENV_KEYS.has(key)) {
      merged[key] = value;
    }
  }
  return merged;
}
export function buildCommandEnv(
  input: RielflowExecutionEnvInput & {
    readonly renderedEnv: Readonly<Record<string, string>>;
    readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
  },
): NodeJS.ProcessEnv {
  const env = stripReservedNativeWorkerEnv({
    ...process.env,
    ...(input.ambientEnv === undefined ? {} : input.ambientEnv),
  });
  return {
    ...appendRenderedWorkerEnv(env, input.renderedEnv),
    ...buildRielflowExecutionEnv(input),
  };
}
export function buildRunnerEnv(input: {
  readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  return stripReservedNativeWorkerEnv({
    ...process.env,
    ...(input.ambientEnv === undefined ? {} : input.ambientEnv),
  });
}
export function buildContainerEnv(
  input: RielflowExecutionEnvInput & {
    readonly renderedEnv: Readonly<Record<string, string>>;
  },
): Readonly<Record<string, string>> {
  const renderedWorkerEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.renderedEnv)) {
    if (!RESERVED_NATIVE_WORKER_ENV_KEYS.has(key)) {
      renderedWorkerEnv[key] = value;
    }
  }
  return {
    ...renderedWorkerEnv,
    ...buildRielflowExecutionEnv(input),
  };
}
export function appendContainerEnvArgs(
  runArgs: string[],
  env: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(env)) {
    runArgs.push("-e", `${key}=${value}`);
  }
}
export function appendContainerEnvNameArgs(
  runArgs: string[],
  env: Readonly<Record<string, string>>,
): void {
  for (const key of Object.keys(env)) {
    runArgs.push("-e", key);
  }
}
export async function runSpawnedProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly captureDirectory?: string;
  readonly stdin?: string;
}): Promise<SpawnedProcessResult> {
  const captureDirectory = input.captureDirectory ?? input.cwd;
  await mkdir(captureDirectory, { recursive: true });
  const captureId = randomUUID();
  const workerStdinPath = path.join(
    captureDirectory,
    `${captureId}-worker-stdin.json`,
  );
  const stdoutPath = path.join(captureDirectory, `${captureId}-stdout.log`);
  const stderrPath = path.join(captureDirectory, `${captureId}-stderr.log`);
  await writeFile(workerStdinPath, input.stdin ?? "", "utf8");
  const readCapturedLogs = async (): Promise<SpawnedProcessResult> => {
    const [stdout, stderr] = await Promise.all([
      readFile(stdoutPath, "utf8").catch(() => ""),
      readFile(stderrPath, "utf8").catch(() => ""),
    ]);
    return { stdout, stderr };
  };
  const cleanupCaptureFiles = (): void => {
    rmSync(workerStdinPath, { force: true });
    rmSync(stdoutPath, { force: true });
    rmSync(stderrPath, { force: true });
  };

  return await new Promise<SpawnedProcessResult>((resolve, reject) => {
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        "stdin_file=$1; stdout_file=$2; stderr_file=$3; shift 3; exec \"$@\" <\"$stdin_file\" >\"$stdout_file\" 2>\"$stderr_file\"",
        "rielflow-process",
        workerStdinPath,
        stdoutPath,
        stderrPath,
        input.command,
        ...input.args,
      ],
      {
        cwd: input.cwd,
        env: input.env,
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.stdin.on("error", () => {});
    child.stdin.end();

    let settled = false;
    let abortRequested = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (fn: () => void | Promise<void>): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.context.signal.removeEventListener("abort", onAbort);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      void fn();
    };

    const onAbort = (): void => {
      abortRequested = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
    };

    input.context.signal.addEventListener("abort", onAbort, { once: true });
    if (input.context.signal.aborted) {
      onAbort();
    }

    child.on("error", (error: unknown) => {
      finish(async () => {
        const logs = await readCapturedLogs();
        cleanupCaptureFiles();
        const message =
          error instanceof Error ? error.message : "unknown spawn error";
        reject(
          new AdapterExecutionError(
            "provider_error",
            `native node execution failed: ${message}`,
            { processLogs: buildProcessLogAttachments(logs) },
          ),
        );
      });
    });

    child.on("close", (code, signal) => {
      finish(async () => {
        const logs = await readCapturedLogs();
        cleanupCaptureFiles();
        if (abortRequested) {
          reject(
            new AdapterExecutionError(
              "timeout",
              "native node execution timed out",
              { processLogs: buildProcessLogAttachments(logs) },
            ),
          );
          return;
        }
        if (code === 0) {
          resolve(logs);
          return;
        }
        reject(
          new AdapterExecutionError(
            "provider_error",
            signal === null
              ? `native node execution exited with code ${String(code ?? "unknown")}`
              : `native node execution exited via signal ${signal}`,
            { processLogs: buildProcessLogAttachments(logs) },
          ),
        );
      });
    });
  });
}
export function readStdoutOutputPayload(
  stdout: string,
  sourceLabel: string,
): Readonly<Record<string, unknown>> {
  const records = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (records.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${sourceLabel} must write exactly one JSONL object to stdout`,
    );
  }
  if (records.length > 1) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${sourceLabel} must write exactly one JSONL object to stdout; received ${records.length} non-empty lines`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(records[0] ?? "") as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `${sourceLabel} stdout JSONL record must be valid JSON: ${message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `${sourceLabel} stdout JSONL record must be a JSON object`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}
export function buildNativeOutput(input: {
  readonly provider: string;
  readonly model: string;
  readonly promptText: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly processLogs?: readonly AdapterProcessLog[];
}): AdapterExecutionOutput {
  const normalized = normalizeOutputContractEnvelope(
    input.payload,
    "native stdout output",
  );
  return {
    provider: input.provider,
    model: input.model,
    promptText: input.promptText,
    completionPassed: normalized.completionPassed,
    when: normalized.when,
    payload: normalized.payload,
    ...(input.processLogs === undefined
      ? {}
      : { processLogs: input.processLogs }),
  };
}
export function buildProcessLogAttachments(
  result: SpawnedProcessResult,
  label?: string,
): readonly AdapterProcessLog[] {
  return [
    ...(result.stdout.length === 0
      ? []
      : [
          {
            stream: "stdout",
            text: result.stdout,
            ...(label === undefined ? {} : { label }),
          } as const,
        ]),
    ...(result.stderr.length === 0
      ? []
      : [
          {
            stream: "stderr",
            text: result.stderr,
            ...(label === undefined ? {} : { label }),
          } as const,
        ]),
  ];
}
export function labelProcessLogs(
  logs: readonly AdapterProcessLog[],
  label: string,
): readonly AdapterProcessLog[] {
  return logs.map((log) => ({
    ...log,
    label: log.label ?? label,
  }));
}
export async function writeProcessLogs(input: {
  readonly artifactDir: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly prefix?: string;
}): Promise<void> {
  const namePrefix =
    input.prefix === undefined || input.prefix.length === 0
      ? ""
      : `${input.prefix}-`;
  await Promise.all([
    atomicWriteTextFile(
      path.join(input.artifactDir, `${namePrefix}stdout.log`),
      input.stdout,
    ),
    atomicWriteTextFile(
      path.join(input.artifactDir, `${namePrefix}stderr.log`),
      input.stderr,
    ),
  ]);
}
export async function writeProcessLogAttachments(input: {
  readonly artifactDir: string;
  readonly processLogs: readonly AdapterProcessLog[];
  readonly prefix?: string;
}): Promise<void> {
  await writeProcessLogs({
    artifactDir: input.artifactDir,
    stdout: input.processLogs
      .filter((log) => log.stream === "stdout")
      .map((log) => log.text)
      .join(""),
    stderr: input.processLogs
      .filter((log) => log.stream === "stderr")
      .map((log) => log.text)
      .join(""),
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
  });
}
export async function runLoggedSpawnedProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly logPrefix?: string;
  readonly stdin?: string;
}): Promise<SpawnedProcessResult> {
  try {
    const result = await runSpawnedProcess({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      context: input.context,
      captureDirectory: input.artifactDir,
      ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
    });
    await writeProcessLogs({
      artifactDir: input.artifactDir,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(input.logPrefix === undefined ? {} : { prefix: input.logPrefix }),
    });
    return result;
  } catch (error: unknown) {
    if (
      error instanceof AdapterExecutionError &&
      error.processLogs !== undefined
    ) {
      await writeProcessLogAttachments({
        artifactDir: input.artifactDir,
        processLogs: error.processLogs,
        ...(input.logPrefix === undefined ? {} : { prefix: input.logPrefix }),
      });
      if (input.logPrefix !== undefined) {
        throw new AdapterExecutionError(error.code, error.message, {
          processLogs: labelProcessLogs(error.processLogs, input.logPrefix),
        });
      }
    }
    throw error;
  }
}
export { isContainerRunnerWithDockerCli };
export function resolveContainerRunner(input: {
  readonly container: ContainerExecution;
  readonly defaults: WorkflowDefaults["containerRuntime"];
}): {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerCommand: string;
} {
  const runnerKind =
    input.container.runnerKind ?? input.defaults?.runnerKind ?? "docker";
  return {
    runnerKind,
    runnerCommand:
      input.container.runnerPath ?? input.defaults?.runnerPath ?? runnerKind,
  };
}
export function resolveContainerBuildTag(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}): string {
  const suffix = createHash("sha256")
    .update(
      `${input.workflowId}:${input.workflowExecutionId}:${input.nodeId}:${input.nodeExecId}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 12);
  return `rielflow-${input.workflowId}-${input.nodeId}-${suffix}`;
}
export async function buildContainerImage(input: {
  readonly workflowDirectory: string;
  readonly artifactDir: string;
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerCommand: string;
  readonly build: NonNullable<ContainerExecution["build"]>;
  readonly context: NativeNodeExecutionContext;
  readonly imageTag: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<readonly AdapterProcessLog[]> {
  if (!isContainerRunnerWithDockerCli(input.runnerKind)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `container runner '${input.runnerKind}' is not supported for workflow-local builds`,
    );
  }

  const contextPath =
    input.build.runtimeContextPath ??
    path.join(input.workflowDirectory, input.build.contextPath);
  const buildArgs = ["build", "-t", input.imageTag];
  const containerfilePath =
    input.build.runtimeContainerfilePath ??
    (input.build.containerfilePath === undefined
      ? undefined
      : path.join(input.workflowDirectory, input.build.containerfilePath));
  if (containerfilePath !== undefined) {
    buildArgs.push(
      "-f",
      containerfilePath,
    );
  }
  if (input.build.target !== undefined) {
    buildArgs.push("--target", input.build.target);
  }
  buildArgs.push(contextPath);

  const result = await runLoggedSpawnedProcess({
    command: input.runnerCommand,
    args: buildArgs,
    cwd: input.workflowDirectory,
    env: input.env,
    context: input.context,
    artifactDir: input.artifactDir,
    logPrefix: "build",
  });
  return buildProcessLogAttachments(result, "build");
}
export function mergeProcessLogsIntoAdapterError(
  error: unknown,
  processLogs: readonly AdapterProcessLog[],
): unknown {
  if (error instanceof AdapterExecutionError && processLogs.length > 0) {
    return new AdapterExecutionError(error.code, error.message, {
      processLogs: [...processLogs, ...(error.processLogs ?? [])],
    });
  }
  return error;
}
export async function executeCommandNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const commandConfig = input.node.command;
  if (commandConfig === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' is missing command configuration`,
    );
  }

  const variables = resolveTemplateVariables(input);
  const argv = renderTemplateEntries(commandConfig.argvTemplate, variables);
  const resolvedInputJson = buildResolvedInputJson(input);
  const renderedEnv = renderTemplateMap(commandConfig.envTemplate, variables);
  const childEnv = buildCommandEnv({
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory ?? commandConfig.workingDirectory,
  );
  const scriptPath =
    commandConfig.runtimeScriptPath ??
    path.join(input.workflowDirectory, commandConfig.scriptPath);
  const extension = path.extname(scriptPath);
  const shellCommand =
    extension === ".bash"
      ? "/bin/bash"
      : extension === ".sh"
        ? "/bin/sh"
        : undefined;
  const command = shellCommand ?? scriptPath;
  const args =
    shellCommand === undefined ? [...argv] : [scriptPath, ...argv];

  const result = await runLoggedSpawnedProcess({
    command,
    args,
    cwd,
    env: childEnv,
    context,
    artifactDir: input.artifactDir,
    stdin: resolvedInputJson,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: "native-command",
      model: `command:${path.basename(commandConfig.scriptPath)}`,
      promptText: input.executionMailbox.meta.objective.instruction,
      payload: readStdoutOutputPayload(result.stdout, "native command"),
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}
export async function executeContainerNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const containerConfig = input.node.container;
  if (containerConfig === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' is missing container configuration`,
    );
  }

  const variables = resolveTemplateVariables(input);
  const renderedArgs = renderTemplateEntries(
    containerConfig.argsTemplate,
    variables,
  );
  const resolvedInputJson = buildResolvedInputJson(input);
  const renderedEnv = renderTemplateMap(containerConfig.envTemplate, variables);
  const { runnerKind, runnerCommand } = resolveContainerRunner({
    container: containerConfig,
    defaults: input.workflowDefaults.containerRuntime,
  });

  const containerEnv = buildContainerEnv({
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  });

  const runArgs = ["run", "--rm", "-i"];

  if (containerConfig.workspace?.mode === "ephemeral") {
    const workspaceHostDir = path.join(input.artifactDir, "workspace");
    await mkdir(workspaceHostDir, { recursive: true });
    runArgs.push(
      "-v",
      `${workspaceHostDir}:${containerConfig.workspace.mountPath ?? "/workspace"}`,
    );
  }

  if (input.node.durability?.mode === "node-persistent") {
    const durableHostDir = path.join(
      input.artifactWorkflowRoot,
      "durable",
      input.nodeId,
    );
    await mkdir(durableHostDir, { recursive: true });
    runArgs.push(
      "-v",
      `${durableHostDir}:${input.node.durability.mountPath ?? "/durable"}`,
    );
  }

  if (containerConfig.workingDirectory !== undefined) {
    runArgs.push("--workdir", containerConfig.workingDirectory);
  }
  if (containerConfig.networkPolicy === "disabled") {
    runArgs.push("--network", "none");
  }
  if (containerConfig.resources?.cpuMax !== undefined) {
    runArgs.push("--cpus", String(containerConfig.resources.cpuMax));
  }
  if (containerConfig.resources?.memoryMaxMb !== undefined) {
    runArgs.push(
      "--memory",
      `${String(containerConfig.resources.memoryMaxMb)}m`,
    );
  }
  if (containerConfig.resources?.pidsMax !== undefined) {
    runArgs.push("--pids-limit", String(containerConfig.resources.pidsMax));
  }
  appendContainerEnvArgs(runArgs, containerEnv);

  let image = containerConfig.image;
  let buildProcessLogs: readonly AdapterProcessLog[] = [];
  if (image === undefined) {
    const build = containerConfig.build;
    if (build === undefined) {
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' must declare container.image or container.build`,
      );
    }
    image = resolveContainerBuildTag({
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      nodeId: input.nodeId,
      nodeExecId: input.nodeExecId,
    });
    buildProcessLogs = await buildContainerImage({
      workflowDirectory: input.workflowDirectory,
      artifactDir: input.artifactDir,
      runnerKind,
      runnerCommand,
      build,
      context,
      imageTag: image,
      env: buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
    });
  }

  if (
    containerConfig.entrypoint !== undefined &&
    containerConfig.entrypoint.length > 0
  ) {
    runArgs.push("--entrypoint", containerConfig.entrypoint[0] ?? "");
  }
  runArgs.push(image);
  if (
    containerConfig.entrypoint !== undefined &&
    containerConfig.entrypoint.length > 1
  ) {
    runArgs.push(...containerConfig.entrypoint.slice(1));
  }
  runArgs.push(...renderedArgs);

  let result: SpawnedProcessResult;
  try {
    result = await runLoggedSpawnedProcess({
      command: runnerCommand,
      args: runArgs,
      cwd: resolveNodeExecutionWorkingDirectory(
        input.workflowWorkingDirectory,
        input.node.workingDirectory,
      ),
      env: buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
      context,
      artifactDir: input.artifactDir,
      stdin: resolvedInputJson,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, buildProcessLogs);
  }
  const processLogs = [
    ...buildProcessLogs,
    ...buildProcessLogAttachments(result),
  ];

  try {
    return buildNativeOutput({
      provider: `native-container:${runnerKind}`,
      model: image,
      promptText: input.executionMailbox.meta.objective.instruction,
      payload: readStdoutOutputPayload(result.stdout, "native container"),
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}
