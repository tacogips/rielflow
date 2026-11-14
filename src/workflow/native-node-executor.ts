import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
  normalizeOutputContractEnvelope,
} from "./adapter";
import type { NodeExecutionMailbox } from "./node-execution-mailbox";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import { resolveNodeExecutionWorkingDirectory } from "./working-directory";
import {
  DEFAULT_MAIL_GATEWAY_IMAGE,
  DEFAULT_X_GATEWAY_IMAGE,
  GIT_COMMIT_ADDON_NAME,
  GIT_PUSH_ADDON_NAME,
} from "./node-addons";
import {
  getSuperviserControlAddonProviderOperationId,
  isSuperviserControlAddonName,
} from "./types";
import type {
  ChatReplyDispatcher,
  ChatReplyDispatchRequest,
  ChatReplyDispatchTarget,
  ChatReplyWorkerConfig,
  ContainerExecution,
  ContainerRunnerKind,
  JsonObject,
  NodePayload,
  ResolvedGitCommitAddon,
  ResolvedGitPushAddon,
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedChatReplyWorkerAddon,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
  ResolvedSuperviserControlAddon,
  SuperviserControlAddonName,
  WorkflowNodeAddonEnvBinding,
  WorkflowDefaults,
} from "./types";
import { atomicWriteTextFile } from "../shared/fs";
import { executeSuperviserControlNativeOperation } from "./superviser-control";
import type { SuperviserRuntimeControl } from "./superviser-control";

const X_GATEWAY_READ_BINARY = "x-gateway-reader";
const X_GATEWAY_BINARY = "x-gateway";
const MAIL_GATEWAY_READ_BINARY = "mail-gateway-reader";
const MAIL_GATEWAY_BINARY = "mail-gateway";

interface NativeNodeExecutionContext {
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

interface SpawnedProcessResult {
  readonly stdout: string;
  readonly stderr: string;
}

function resolveTemplateVariables(
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

function renderTemplateEntries(
  entries: readonly string[] | undefined,
  variables: Readonly<Record<string, unknown>>,
): readonly string[] {
  return (entries ?? []).map((entry) => renderPromptTemplate(entry, variables));
}

function renderTemplateMap(
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

interface DivedraExecutionEnvInput {
  readonly mailboxDir: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}

function buildDivedraExecutionEnv(
  input: DivedraExecutionEnvInput,
): Readonly<Record<string, string>> {
  return {
    DIVEDRA_MAILBOX_DIR: input.mailboxDir,
    DIVEDRA_WORKFLOW_ID: input.workflowId,
    DIVEDRA_WORKFLOW_EXECUTION_ID: input.workflowExecutionId,
    DIVEDRA_NODE_ID: input.nodeId,
    DIVEDRA_NODE_EXEC_ID: input.nodeExecId,
  };
}

function buildCommandEnv(
  input: DivedraExecutionEnvInput & {
    readonly renderedEnv: Readonly<Record<string, string>>;
    readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
  },
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(input.ambientEnv === undefined ? {} : input.ambientEnv),
    ...input.renderedEnv,
    ...buildDivedraExecutionEnv(input),
  };
}

function buildRunnerEnv(input: {
  readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(input.ambientEnv === undefined ? {} : input.ambientEnv),
  };
}

function buildContainerEnv(
  input: DivedraExecutionEnvInput & {
    readonly renderedEnv: Readonly<Record<string, string>>;
  },
): Readonly<Record<string, string>> {
  return {
    ...input.renderedEnv,
    ...buildDivedraExecutionEnv(input),
  };
}

function appendContainerEnvArgs(
  runArgs: string[],
  env: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(env)) {
    runArgs.push("-e", `${key}=${value}`);
  }
}

function appendContainerEnvNameArgs(
  runArgs: string[],
  env: Readonly<Record<string, string>>,
): void {
  for (const key of Object.keys(env)) {
    runArgs.push("-e", key);
  }
}

async function runSpawnedProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
}): Promise<SpawnedProcessResult> {
  return await new Promise<SpawnedProcessResult>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.context.signal.removeEventListener("abort", onAbort);
      fn();
    };

    const onAbort = (): void => {
      child.kill("SIGTERM");
      finish(() => {
        reject(
          new AdapterExecutionError(
            "timeout",
            "native node execution timed out",
            { processLogs: buildProcessLogAttachments({ stdout, stderr }) },
          ),
        );
      });
    };

    input.context.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: unknown) => {
      finish(() => {
        const message =
          error instanceof Error ? error.message : "unknown spawn error";
        reject(
          new AdapterExecutionError(
            "provider_error",
            `native node execution failed: ${message}`,
          ),
        );
      });
    });

    child.on("close", (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          new AdapterExecutionError(
            "provider_error",
            signal === null
              ? `native node execution exited with code ${String(code ?? "unknown")}`
              : `native node execution exited via signal ${signal}`,
            { processLogs: buildProcessLogAttachments({ stdout, stderr }) },
          ),
        );
      });
    });
  });
}

async function readMailboxOutputPayload(
  mailboxDir: string,
): Promise<Readonly<Record<string, unknown>>> {
  const outputPath = path.join(mailboxDir, "outbox", "output.json");
  let raw: string;
  try {
    raw = await readFile(outputPath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new AdapterExecutionError(
      "invalid_output",
      `native node did not produce mailbox output at '${outputPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `mailbox output '${outputPath}' must be valid JSON: ${message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `mailbox output '${outputPath}' must be a JSON object`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function buildNativeOutput(input: {
  readonly provider: string;
  readonly model: string;
  readonly promptText: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly processLogs?: readonly AdapterProcessLog[];
}): AdapterExecutionOutput {
  const normalized = normalizeOutputContractEnvelope(
    input.payload,
    "native command mailbox output",
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

function buildProcessLogAttachments(
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

function labelProcessLogs(
  logs: readonly AdapterProcessLog[],
  label: string,
): readonly AdapterProcessLog[] {
  return logs.map((log) => ({
    ...log,
    label: log.label ?? label,
  }));
}

async function writeProcessLogs(input: {
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

async function writeProcessLogAttachments(input: {
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

async function runLoggedSpawnedProcess(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly logPrefix?: string;
}): Promise<SpawnedProcessResult> {
  try {
    const result = await runSpawnedProcess({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
      context: input.context,
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

function isContainerRunnerWithDockerCli(
  runnerKind: ContainerRunnerKind,
): runnerKind is "podman" | "docker" | "nerdctl" {
  return (
    runnerKind === "podman" ||
    runnerKind === "docker" ||
    runnerKind === "nerdctl"
  );
}

function resolveContainerRunner(input: {
  readonly container: ContainerExecution;
  readonly defaults: WorkflowDefaults["containerRuntime"];
}): {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerCommand: string;
} {
  const runnerKind =
    input.container.runnerKind ?? input.defaults?.runnerKind ?? "podman";
  return {
    runnerKind,
    runnerCommand:
      input.container.runnerPath ?? input.defaults?.runnerPath ?? runnerKind,
  };
}

function resolveContainerBuildTag(input: {
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
  return `divedra-${input.workflowId}-${input.nodeId}-${suffix}`;
}

async function buildContainerImage(input: {
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

  const contextPath = path.join(
    input.workflowDirectory,
    input.build.contextPath,
  );
  const buildArgs = ["build", "-t", input.imageTag];
  if (input.build.containerfilePath !== undefined) {
    buildArgs.push(
      "-f",
      path.join(input.workflowDirectory, input.build.containerfilePath),
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

function mergeProcessLogsIntoAdapterError(
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

async function executeCommandNode(
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

  const mailboxDir = path.join(input.artifactDir, "mailbox");
  const variables = resolveTemplateVariables(input);
  const argv = renderTemplateEntries(commandConfig.argvTemplate, variables);
  const renderedEnv = renderTemplateMap(commandConfig.envTemplate, variables);
  const childEnv = buildCommandEnv({
    mailboxDir,
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const scriptPath = path.join(
    input.workflowDirectory,
    commandConfig.scriptPath,
  );
  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory ?? commandConfig.workingDirectory,
  );
  const command = path.extname(scriptPath) === ".sh" ? "sh" : scriptPath;
  const args = command === "sh" ? [scriptPath, ...argv] : [...argv];

  const result = await runLoggedSpawnedProcess({
    command,
    args,
    cwd,
    env: childEnv,
    context,
    artifactDir: input.artifactDir,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: "native-command",
      model: `command:${path.basename(commandConfig.scriptPath)}`,
      promptText: input.executionMailbox.meta.objective.instruction,
      payload: await readMailboxOutputPayload(mailboxDir),
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

async function executeContainerNode(
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

  const mailboxDir = path.join(input.artifactDir, "mailbox");
  const variables = resolveTemplateVariables(input);
  const renderedArgs = renderTemplateEntries(
    containerConfig.argsTemplate,
    variables,
  );
  const renderedEnv = renderTemplateMap(containerConfig.envTemplate, variables);
  const { runnerKind, runnerCommand } = resolveContainerRunner({
    container: containerConfig,
    defaults: input.workflowDefaults.containerRuntime,
  });

  const containerEnv = buildContainerEnv({
    mailboxDir: "/mailbox",
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  });

  const runArgs = ["run", "--rm"];
  runArgs.push("-v", `${mailboxDir}:/mailbox`);

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
      payload: await readMailboxOutputPayload(mailboxDir),
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function resolveChatReplyTarget(
  runtimeVariables: Readonly<Record<string, unknown>>,
): ChatReplyDispatchTarget | null {
  const event = runtimeVariables["event"];
  if (!isRecord(event)) {
    return null;
  }

  const replyTarget = event["replyTarget"];
  if (isRecord(replyTarget)) {
    const sourceId = readOptionalString(replyTarget, "sourceId");
    const provider = readOptionalString(replyTarget, "provider");
    const eventId = readOptionalString(replyTarget, "eventId");
    const conversationId = readOptionalString(replyTarget, "conversationId");
    if (
      sourceId !== undefined &&
      provider !== undefined &&
      eventId !== undefined &&
      conversationId !== undefined
    ) {
      const threadId = readOptionalString(replyTarget, "threadId");
      const actorId = readOptionalString(replyTarget, "actorId");
      return {
        sourceId,
        provider,
        eventId,
        conversationId,
        ...(threadId === undefined ? {} : { threadId }),
        ...(actorId === undefined ? {} : { actorId }),
      };
    }
  }

  const sourceId = readOptionalString(event, "sourceId");
  const provider = readOptionalString(event, "provider");
  const eventId = readOptionalString(event, "eventId");
  const conversation = event["conversation"];
  if (
    sourceId === undefined ||
    provider === undefined ||
    eventId === undefined ||
    !isRecord(conversation)
  ) {
    return null;
  }

  const conversationId = readOptionalString(conversation, "id");
  if (conversationId === undefined) {
    return null;
  }

  const actor = event["actor"];
  const threadId = readOptionalString(conversation, "threadId");
  const actorId = isRecord(actor) ? readOptionalString(actor, "id") : undefined;
  return {
    sourceId,
    provider,
    eventId,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
    ...(actorId === undefined ? {} : { actorId }),
  };
}

function buildFallbackReplyTarget(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
}): ChatReplyDispatchTarget {
  return {
    sourceId: "missing",
    provider: "missing",
    eventId: input.workflowExecutionId,
    conversationId: `${input.workflowId}/${input.nodeId}`,
  };
}

function targetToJson(target: ChatReplyDispatchTarget): JsonObject {
  return {
    sourceId: target.sourceId,
    provider: target.provider,
    eventId: target.eventId,
    conversationId: target.conversationId,
    ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
    ...(target.actorId === undefined ? {} : { actorId: target.actorId }),
  };
}

function resolveChatReplyStatus(input: {
  readonly target: ChatReplyDispatchTarget | null;
  readonly config: ChatReplyWorkerConfig;
}): "intent-only" | "dry-run" {
  if (input.target !== null) {
    return "intent-only";
  }
  return input.config.onMissingTarget === "dry-run" ? "dry-run" : "intent-only";
}

function buildChatReplyDispatchRequest(input: {
  readonly target: ChatReplyDispatchTarget;
  readonly outputDestinationId?: string;
  readonly outputDestinationIds?: readonly string[];
  readonly text: string;
  readonly addon: ResolvedChatReplyWorkerAddon;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly idempotencyKey: string;
}): ChatReplyDispatchRequest {
  return {
    target: input.target,
    ...(input.outputDestinationId === undefined
      ? {}
      : { outputDestinationId: input.outputDestinationId }),
    ...(input.outputDestinationIds === undefined
      ? {}
      : { outputDestinationIds: input.outputDestinationIds }),
    message: { text: input.text },
    visibility: input.addon.config.visibility ?? "public",
    threadPolicy: input.addon.config.threadPolicy ?? "same-thread",
    idempotencyKey: input.idempotencyKey,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  };
}

function resolveOutputDestinationIds(
  runtimeVariables: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  const destinations = runtimeVariables["eventOutputDestinations"];
  if (!Array.isArray(destinations)) {
    return undefined;
  }
  const ids = destinations.filter(
    (destination): destination is string =>
      typeof destination === "string" && destination.length > 0,
  );
  return ids.length === 0 ? undefined : ids;
}

function buildChatReplyIdempotencyKey(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}): string {
  return [
    "chat-reply",
    input.workflowId,
    input.workflowExecutionId,
    input.nodeId,
    input.nodeExecId,
  ].join(":");
}

async function executeChatReplyAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedChatReplyWorkerAddon,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const renderedText = renderPromptTemplate(
    addon.config.textTemplate,
    variables,
  ).trim();
  if (renderedText.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty chat reply`,
    );
  }

  const target = resolveChatReplyTarget(input.runtimeVariables);
  const onMissingTarget = addon.config.onMissingTarget ?? "fail";
  if (target === null && onMissingTarget === "fail") {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' cannot reply because runtimeVariables.event does not include a chat conversation target`,
    );
  }

  const effectiveTarget =
    target ??
    buildFallbackReplyTarget({
      workflowId: input.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      nodeId: input.nodeId,
    });
  const idempotencyKey = buildChatReplyIdempotencyKey({
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
  });
  const outputDestinationIds = resolveOutputDestinationIds(
    input.runtimeVariables,
  );
  const dispatchResult =
    target === null || input.chatReplyDispatcher === undefined
      ? undefined
      : await input.chatReplyDispatcher.dispatchChatReply(
          buildChatReplyDispatchRequest({
            target,
            ...(outputDestinationIds === undefined
              ? {}
              : { outputDestinationIds }),
            text: renderedText,
            addon,
            workflowId: input.workflowId,
            workflowExecutionId: input.workflowExecutionId,
            nodeId: input.nodeId,
            nodeExecId: input.nodeExecId,
            idempotencyKey,
          }),
        );
  const status =
    dispatchResult?.status ??
    resolveChatReplyStatus({
      target,
      config: addon.config,
    });

  return {
    provider: "native-addon",
    model: `${addon.name}@${addon.version}`,
    promptText: addon.config.textTemplate,
    completionPassed: true,
    when: {
      always: true,
      replied: status !== "dry-run",
      dryRun: status === "dry-run",
    },
    payload: {
      reply: {
        status,
        target: targetToJson(effectiveTarget),
        message: { text: renderedText },
        visibility: addon.config.visibility ?? "public",
        threadPolicy: addon.config.threadPolicy ?? "same-thread",
        idempotencyKey,
        ...(dispatchResult === undefined
          ? {}
          : {
              dispatch: {
                provider: dispatchResult.provider,
                status: dispatchResult.status,
                ...(dispatchResult.dispatchId === undefined
                  ? {}
                  : { dispatchId: dispatchResult.dispatchId }),
                ...(dispatchResult.providerMessageId === undefined
                  ? {}
                  : { providerMessageId: dispatchResult.providerMessageId }),
              },
            }),
      },
    },
  };
}

function resolveAddonEnv(input: {
  readonly addonName: string;
  readonly nodeId: string;
  readonly bindings: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly sourceEnv?: Readonly<Record<string, string | undefined>>;
}): Readonly<Record<string, string>> {
  const sourceEnv = input.sourceEnv ?? process.env;
  const resolved: Record<string, string> = {};
  for (const [targetEnv, binding] of Object.entries(input.bindings)) {
    const value = sourceEnv[binding.fromEnv];
    if (value === undefined || value.length === 0) {
      if (binding.required === false) {
        continue;
      }
      throw new AdapterExecutionError(
        "provider_error",
        `node '${input.nodeId}' cannot run ${input.addonName} because required environment variable '${binding.fromEnv}' is not set for add-on env '${targetEnv}'`,
      );
    }
    resolved[targetEnv] = value;
  }
  return resolved;
}

function parseXGatewayJsonOutput(input: {
  readonly stdout: string;
  readonly nodeId: string;
}): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stdout) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' x-gateway output must be valid JSON: ${message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' x-gateway output must be a JSON object`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function resolveXGatewayRunner(input: {
  readonly addon: ResolvedXGatewayReadAddon | ResolvedXGatewayAddon;
  readonly defaults: WorkflowDefaults["containerRuntime"];
}): {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerCommand: string;
} {
  const runnerKind =
    input.addon.config.runnerKind ?? input.defaults?.runnerKind ?? "podman";
  if (!isContainerRunnerWithDockerCli(runnerKind)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `container runner '${runnerKind}' is not supported for ${input.addon.name}`,
    );
  }
  return {
    runnerKind,
    runnerCommand:
      input.addon.config.runnerPath ?? input.defaults?.runnerPath ?? runnerKind,
  };
}

function parseMailGatewayJsonOutput(input: {
  readonly stdout: string;
  readonly nodeId: string;
}): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stdout) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' mail-gateway output must be valid JSON: ${message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' mail-gateway output must be a JSON object`,
    );
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function resolveMailGatewayRunner(input: {
  readonly addon: ResolvedMailGatewayReadAddon | ResolvedMailGatewayAddon;
  readonly defaults: WorkflowDefaults["containerRuntime"];
}): {
  readonly runnerKind: ContainerRunnerKind;
  readonly runnerCommand: string;
} {
  const runnerKind =
    input.addon.config.runnerKind ?? input.defaults?.runnerKind ?? "podman";
  if (!isContainerRunnerWithDockerCli(runnerKind)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `container runner '${runnerKind}' is not supported for ${input.addon.name}`,
    );
  }
  return {
    runnerKind,
    runnerCommand:
      input.addon.config.runnerPath ?? input.defaults?.runnerPath ?? runnerKind,
  };
}

async function executeXGatewayReadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedXGatewayReadAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const renderedQuery = renderPromptTemplate(
    addon.config.queryTemplate,
    variables,
  ).trim();
  if (renderedQuery.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty x-gateway query`,
    );
  }

  const mappedEnv =
    addon.env === undefined
      ? {}
      : resolveAddonEnv({
          addonName: addon.name,
          nodeId: input.nodeId,
          bindings: addon.env,
          ...(input.env === undefined ? {} : { sourceEnv: input.env }),
        });
  const { runnerKind, runnerCommand } = resolveXGatewayRunner({
    addon,
    defaults: input.workflowDefaults.containerRuntime,
  });
  const image = addon.config.image ?? DEFAULT_X_GATEWAY_IMAGE;
  const runArgs = ["run", "--rm"];
  if (addon.config.networkPolicy === "disabled") {
    runArgs.push("--network", "none");
  }
  appendContainerEnvNameArgs(runArgs, mappedEnv);
  runArgs.push(
    image,
    X_GATEWAY_READ_BINARY,
    "graphql",
    "query",
    renderedQuery,
    "--json",
  );

  const result = await runLoggedSpawnedProcess({
    command: runnerCommand,
    args: runArgs,
    cwd: resolveNodeExecutionWorkingDirectory(
      input.workflowWorkingDirectory,
      input.node.workingDirectory,
    ),
    env: {
      ...buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
      ...mappedEnv,
    },
    context,
    artifactDir: input.artifactDir,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: `native-addon:x-gateway-read:${runnerKind}`,
      model: image,
      promptText: renderedQuery,
      payload: {
        xGateway: parseXGatewayJsonOutput({
          stdout: result.stdout,
          nodeId: input.nodeId,
        }),
      },
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

async function executeXGatewayAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedXGatewayAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const renderedDocument = renderPromptTemplate(
    addon.config.documentTemplate,
    variables,
  ).trim();
  if (renderedDocument.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty x-gateway document`,
    );
  }

  const mappedEnv =
    addon.env === undefined
      ? {}
      : resolveAddonEnv({
          addonName: addon.name,
          nodeId: input.nodeId,
          bindings: addon.env,
          ...(input.env === undefined ? {} : { sourceEnv: input.env }),
        });
  const { runnerKind, runnerCommand } = resolveXGatewayRunner({
    addon,
    defaults: input.workflowDefaults.containerRuntime,
  });
  const image = addon.config.image ?? DEFAULT_X_GATEWAY_IMAGE;
  const runArgs = ["run", "--rm"];
  if (addon.config.networkPolicy === "disabled") {
    runArgs.push("--network", "none");
  }
  appendContainerEnvNameArgs(runArgs, mappedEnv);
  runArgs.push(
    image,
    X_GATEWAY_BINARY,
    "graphql",
    "query",
    renderedDocument,
    "--json",
  );

  const result = await runLoggedSpawnedProcess({
    command: runnerCommand,
    args: runArgs,
    cwd: resolveNodeExecutionWorkingDirectory(
      input.workflowWorkingDirectory,
      input.node.workingDirectory,
    ),
    env: {
      ...buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
      ...mappedEnv,
    },
    context,
    artifactDir: input.artifactDir,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: `native-addon:x-gateway:${runnerKind}`,
      model: image,
      promptText: renderedDocument,
      payload: {
        xGateway: parseXGatewayJsonOutput({
          stdout: result.stdout,
          nodeId: input.nodeId,
        }),
      },
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

async function executeMailGatewayReadAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedMailGatewayReadAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const renderedQuery = renderPromptTemplate(
    addon.config.queryTemplate,
    variables,
  ).trim();
  if (renderedQuery.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty mail-gateway query`,
    );
  }

  const mappedEnv =
    addon.env === undefined
      ? {}
      : resolveAddonEnv({
          addonName: addon.name,
          nodeId: input.nodeId,
          bindings: addon.env,
          ...(input.env === undefined ? {} : { sourceEnv: input.env }),
        });
  const { runnerKind, runnerCommand } = resolveMailGatewayRunner({
    addon,
    defaults: input.workflowDefaults.containerRuntime,
  });
  const image = addon.config.image ?? DEFAULT_MAIL_GATEWAY_IMAGE;
  const runArgs = ["run", "--rm"];
  if (addon.config.networkPolicy === "disabled") {
    runArgs.push("--network", "none");
  }
  appendContainerEnvNameArgs(runArgs, mappedEnv);
  runArgs.push(
    image,
    MAIL_GATEWAY_READ_BINARY,
    "graphql",
    "--query",
    renderedQuery,
  );

  const result = await runLoggedSpawnedProcess({
    command: runnerCommand,
    args: runArgs,
    cwd: resolveNodeExecutionWorkingDirectory(
      input.workflowWorkingDirectory,
      input.node.workingDirectory,
    ),
    env: {
      ...buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
      ...mappedEnv,
    },
    context,
    artifactDir: input.artifactDir,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: `native-addon:mail-gateway-read:${runnerKind}`,
      model: image,
      promptText: renderedQuery,
      payload: {
        mailGateway: parseMailGatewayJsonOutput({
          stdout: result.stdout,
          nodeId: input.nodeId,
        }),
      },
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

async function executeMailGatewayAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedMailGatewayAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const renderedDocument = renderPromptTemplate(
    addon.config.documentTemplate,
    variables,
  ).trim();
  if (renderedDocument.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' rendered an empty mail-gateway document`,
    );
  }

  const mappedEnv =
    addon.env === undefined
      ? {}
      : resolveAddonEnv({
          addonName: addon.name,
          nodeId: input.nodeId,
          bindings: addon.env,
          ...(input.env === undefined ? {} : { sourceEnv: input.env }),
        });
  const { runnerKind, runnerCommand } = resolveMailGatewayRunner({
    addon,
    defaults: input.workflowDefaults.containerRuntime,
  });
  const image = addon.config.image ?? DEFAULT_MAIL_GATEWAY_IMAGE;
  const runArgs = ["run", "--rm"];
  if (addon.config.networkPolicy === "disabled") {
    runArgs.push("--network", "none");
  }
  appendContainerEnvNameArgs(runArgs, mappedEnv);
  runArgs.push(
    image,
    MAIL_GATEWAY_BINARY,
    "graphql",
    "--query",
    renderedDocument,
  );

  const result = await runLoggedSpawnedProcess({
    command: runnerCommand,
    args: runArgs,
    cwd: resolveNodeExecutionWorkingDirectory(
      input.workflowWorkingDirectory,
      input.node.workingDirectory,
    ),
    env: {
      ...buildRunnerEnv({
        ...(input.env === undefined ? {} : { ambientEnv: input.env }),
      }),
      ...mappedEnv,
    },
    context,
    artifactDir: input.artifactDir,
  });
  const processLogs = buildProcessLogAttachments(result);

  try {
    return buildNativeOutput({
      provider: `native-addon:mail-gateway:${runnerKind}`,
      model: image,
      promptText: renderedDocument,
      payload: {
        mailGateway: parseMailGatewayJsonOutput({
          stdout: result.stdout,
          nodeId: input.nodeId,
        }),
      },
      processLogs,
    });
  } catch (error: unknown) {
    throw mergeProcessLogsIntoAdapterError(error, processLogs);
  }
}

function parseCommittedFiles(input: {
  readonly renderedFiles: string;
  readonly nodeId: string;
}): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.renderedFiles) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' committedFilesTemplate must render a JSON string array: ${message}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeId}' committedFilesTemplate must render a JSON string array`,
    );
  }

  return parsed.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new AdapterExecutionError(
        "invalid_output",
        `node '${input.nodeId}' committedFilesTemplate entry ${index} must be a non-empty string`,
      );
    }
    return entry;
  });
}

function normalizeCommittedFilePath(input: {
  readonly filePath: string;
  readonly nodeId: string;
}): string {
  const normalized = path.posix.normalize(input.filePath.replaceAll("\\", "/"));
  const segments = normalized.split("/");
  if (
    path.isAbsolute(input.filePath) ||
    /^[A-Za-z]:[\\/]/.test(input.filePath) ||
    input.filePath.startsWith("\\\\") ||
    normalized === "." ||
    normalized.startsWith("../") ||
    segments.includes("..") ||
    input.filePath.includes("\0") ||
    /[\r\n\t]/.test(input.filePath)
  ) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused unsafe committedFiles path '${input.filePath}'`,
    );
  }
  return normalized;
}

async function rejectDirectoryCommittedFiles(input: {
  readonly cwd: string;
  readonly files: readonly string[];
  readonly nodeId: string;
}): Promise<void> {
  for (const filePath of input.files) {
    try {
      const fileStat = await stat(path.join(input.cwd, filePath));
      if (fileStat.isDirectory()) {
        throw new AdapterExecutionError(
          "policy_blocked",
          `node '${input.nodeId}' refused directory committedFiles path '${filePath}'`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof AdapterExecutionError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      throw new AdapterExecutionError(
        "provider_error",
        `node '${input.nodeId}' could not inspect committedFiles path '${filePath}': ${message}`,
      );
    }
  }
}

function parseGitRefTemplate(input: {
  readonly value: string | undefined;
  readonly fieldName: string;
  readonly nodeId: string;
}): string | undefined {
  const trimmed = input.value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  if (/[\0\r\n\t]/.test(trimmed)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' refused ${input.fieldName} containing control characters`,
    );
  }
  return trimmed;
}

async function runGitCommand(input: {
  readonly gitPath: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly label: string;
}): Promise<{
  readonly result: SpawnedProcessResult;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const result = await runLoggedSpawnedProcess({
    command: input.gitPath,
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    context: input.context,
    artifactDir: input.artifactDir,
    logPrefix: input.label,
  });
  return {
    result,
    processLogs: buildProcessLogAttachments(result, input.label),
  };
}

async function resolveCurrentGitBranch(input: {
  readonly gitPath: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly context: NativeNodeExecutionContext;
  readonly artifactDir: string;
  readonly nodeId: string;
}): Promise<{
  readonly branch: string;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const { result, processLogs } = await runGitCommand({
    ...input,
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    label: "git-current-branch",
  });
  const branch = result.stdout.trim();
  if (branch.length === 0 || branch === "HEAD") {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve the current git branch`,
      { processLogs },
    );
  }
  return { branch, processLogs };
}

async function executeGitCommit(input: {
  readonly nodeInput: NativeNodeExecutionInput;
  readonly context: NativeNodeExecutionContext;
  readonly config: ResolvedGitCommitAddon["config"];
}): Promise<{
  readonly commitHash: string;
  readonly commitMessage: string;
  readonly committedFiles: readonly string[];
  readonly cwd: string;
  readonly gitPath: string;
  readonly gitEnv: NodeJS.ProcessEnv;
  readonly processLogs: readonly AdapterProcessLog[];
}> {
  const variables = resolveTemplateVariables(input.nodeInput);
  const commitMessage = renderPromptTemplate(
    input.config.commitMessageTemplate,
    variables,
  ).trim();
  if (commitMessage.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeInput.nodeId}' rendered an empty git commit message`,
    );
  }

  const committedFiles = [
    ...new Set(
      parseCommittedFiles({
        renderedFiles: renderPromptTemplate(
          input.config.committedFilesTemplate,
          variables,
        ),
        nodeId: input.nodeInput.nodeId,
      }).map((filePath) =>
        normalizeCommittedFilePath({
          filePath,
          nodeId: input.nodeInput.nodeId,
        }),
      ),
    ),
  ];
  if (committedFiles.length === 0) {
    throw new AdapterExecutionError(
      "invalid_output",
      `node '${input.nodeInput.nodeId}' committedFilesTemplate rendered an empty file list`,
    );
  }

  const cwd = resolveNodeExecutionWorkingDirectory(
    input.nodeInput.workflowWorkingDirectory,
    input.nodeInput.node.workingDirectory,
  );
  await rejectDirectoryCommittedFiles({
    cwd,
    files: committedFiles,
    nodeId: input.nodeInput.nodeId,
  });

  const gitPath = input.config.gitPath ?? "git";
  const gitEnv = buildRunnerEnv({
    ...(input.nodeInput.env === undefined
      ? {}
      : { ambientEnv: input.nodeInput.env }),
  });
  const processLogs: AdapterProcessLog[] = [];
  const appendLogs = (logs: readonly AdapterProcessLog[]): void => {
    processLogs.push(...logs);
  };

  appendLogs(
    (
      await runGitCommand({
        gitPath,
        args: ["add", "--", ...committedFiles],
        cwd,
        env: gitEnv,
        context: input.context,
        artifactDir: input.nodeInput.artifactDir,
        label: "git-add",
      })
    ).processLogs,
  );

  const staged = await runGitCommand({
    gitPath,
    args: ["diff", "--cached", "--name-only", "--"],
    cwd,
    env: gitEnv,
    context: input.context,
    artifactDir: input.nodeInput.artifactDir,
    label: "git-staged-files",
  });
  appendLogs(staged.processLogs);
  const stagedFiles = staged.result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const allowedFiles = new Set(committedFiles);
  const unexpectedStagedFiles = stagedFiles.filter(
    (filePath) => !allowedFiles.has(filePath),
  );
  if (unexpectedStagedFiles.length > 0) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeInput.nodeId}' refused to commit pre-staged files outside committedFiles: ${unexpectedStagedFiles.join(", ")}`,
      { processLogs },
    );
  }
  if (stagedFiles.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeInput.nodeId}' has no staged changes to commit`,
      { processLogs },
    );
  }

  appendLogs(
    (
      await runGitCommand({
        gitPath,
        args: ["commit", "-m", commitMessage],
        cwd,
        env: gitEnv,
        context: input.context,
        artifactDir: input.nodeInput.artifactDir,
        label: "git-commit",
      })
    ).processLogs,
  );

  const commitHashResult = await runGitCommand({
    gitPath,
    args: ["rev-parse", "HEAD"],
    cwd,
    env: gitEnv,
    context: input.context,
    artifactDir: input.nodeInput.artifactDir,
    label: "git-commit-hash",
  });
  appendLogs(commitHashResult.processLogs);
  const commitHash = commitHashResult.result.stdout.trim();
  if (commitHash.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeInput.nodeId}' could not resolve the created commit hash`,
      { processLogs },
    );
  }

  return {
    commitHash,
    commitMessage,
    committedFiles: stagedFiles,
    cwd,
    gitPath,
    gitEnv,
    processLogs,
  };
}

async function executeGitCommitAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedGitCommitAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const committed = await executeGitCommit({
    nodeInput: input,
    context,
    config: addon.config,
  });
  return buildNativeOutput({
    provider: "native-addon:git-commit",
    model: `${addon.name}@${addon.version}`,
    promptText: addon.config.commitMessageTemplate,
    payload: {
      git: {
        status: "committed",
        commitHash: committed.commitHash,
        commitMessage: committed.commitMessage,
        committedFiles: committed.committedFiles,
      },
      commitStatus: "committed",
      commitHash: committed.commitHash,
      commitMessage: committed.commitMessage,
      committedFiles: committed.committedFiles,
      residualRisks: [],
    },
    processLogs: committed.processLogs,
  });
}

async function executeGitPushAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedGitPushAddon,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const variables = resolveTemplateVariables(input);
  const cwd = resolveNodeExecutionWorkingDirectory(
    input.workflowWorkingDirectory,
    input.node.workingDirectory,
  );
  const gitPath = addon.config.gitPath ?? "git";
  const gitEnv = buildRunnerEnv({
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const remote =
    parseGitRefTemplate({
      value:
        addon.config.remoteTemplate === undefined
          ? "origin"
          : renderPromptTemplate(addon.config.remoteTemplate, variables),
      fieldName: "remoteTemplate",
      nodeId: input.nodeId,
    }) ?? "origin";
  const processLogs: AdapterProcessLog[] = [];
  const appendLogs = (logs: readonly AdapterProcessLog[]): void => {
    processLogs.push(...logs);
  };
  const currentBranch =
    addon.config.branchTemplate === undefined
      ? await resolveCurrentGitBranch({
          gitPath,
          cwd,
          env: gitEnv,
          context,
          artifactDir: input.artifactDir,
          nodeId: input.nodeId,
        })
      : undefined;
  if (currentBranch !== undefined) {
    appendLogs(currentBranch.processLogs);
  }
  const branch =
    parseGitRefTemplate({
      value:
        addon.config.branchTemplate === undefined
          ? undefined
          : renderPromptTemplate(addon.config.branchTemplate, variables),
      fieldName: "branchTemplate",
      nodeId: input.nodeId,
    }) ?? currentBranch?.branch;
  if (branch === undefined) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve a git branch to push`,
      { processLogs },
    );
  }

  const commitHashResult = await runGitCommand({
    gitPath,
    args: ["rev-parse", "HEAD"],
    cwd,
    env: gitEnv,
    context,
    artifactDir: input.artifactDir,
    label: "git-push-commit-hash",
  });
  appendLogs(commitHashResult.processLogs);
  const commitHash = commitHashResult.result.stdout.trim();
  if (commitHash.length === 0) {
    throw new AdapterExecutionError(
      "provider_error",
      `node '${input.nodeId}' could not resolve HEAD before pushing`,
      { processLogs },
    );
  }

  const pushResult = await runGitCommand({
    gitPath,
    args: ["push", remote, `HEAD:${branch}`],
    cwd,
    env: gitEnv,
    context,
    artifactDir: input.artifactDir,
    label: "git-push",
  });
  appendLogs(pushResult.processLogs);

  return buildNativeOutput({
    provider: "native-addon:git-push",
    model: `${addon.name}@${addon.version}`,
    promptText: addon.config.branchTemplate ?? branch,
    payload: {
      git: {
        status: "pushed",
        commitHash,
        pushedRemote: remote,
        pushedBranch: branch,
      },
      pushStatus: "pushed",
      commitHash,
      pushedRemote: remote,
      pushedBranch: branch,
      residualRisks: [],
    },
    processLogs,
  });
}

async function executeSuperviserControlAddonNode(
  input: NativeNodeExecutionInput,
  addon: ResolvedSuperviserControlAddon,
): Promise<AdapterExecutionOutput> {
  if (input.superviserControl === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' add-on '${addon.name}' requires nested superviser runtime control (phase-2 --auto-improve); this add-on is not available in the current execution context`,
    );
  }
  const result = await executeSuperviserControlNativeOperation({
    addonName: addon.name,
    arguments: input.arguments,
    control: input.superviserControl,
    nodeId: input.nodeId,
  });
  if (!result.ok) {
    throw new AdapterExecutionError("provider_error", result.error);
  }
  return buildNativeOutput({
    provider: `native-addon:superviser-control/${getSuperviserControlAddonProviderOperationId(addon.name)}`,
    model: addon.name,
    promptText: "superviser-control",
    payload: { superviser: result.value },
  });
}

async function executeAddonNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  const addon = input.node.addon;
  if (addon === undefined) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `node '${input.nodeId}' does not declare a resolved add-on executor`,
    );
  }
  if (isSuperviserControlAddonName(addon.name)) {
    return await executeSuperviserControlAddonNode(
      input,
      addon as ResolvedSuperviserControlAddon,
    );
  }
  switch (addon.name) {
    case "divedra/chat-reply-worker":
      return await executeChatReplyAddonNode(input, addon);
    case "divedra/x-gateway-read":
      return await executeXGatewayReadAddonNode(input, addon, context);
    case "divedra/x-gateway":
      return await executeXGatewayAddonNode(input, addon, context);
    case "divedra/mail-gateway-read":
      return await executeMailGatewayReadAddonNode(input, addon, context);
    case "divedra/mail-gateway":
      return await executeMailGatewayAddonNode(input, addon, context);
    case GIT_COMMIT_ADDON_NAME:
      return await executeGitCommitAddonNode(input, addon, context);
    case GIT_PUSH_ADDON_NAME:
      return await executeGitPushAddonNode(input, addon, context);
    default:
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' declares add-on '${addon.name}' that does not use a native add-on executor`,
      );
  }
}

export async function executeNativeNode(
  input: NativeNodeExecutionInput,
  context: NativeNodeExecutionContext,
): Promise<AdapterExecutionOutput> {
  switch (input.node.nodeType) {
    case "command":
      return await executeCommandNode(input, context);
    case "container":
      return await executeContainerNode(input, context);
    case "addon":
      return await executeAddonNode(input, context);
    default:
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' does not use a native command/container/add-on executor`,
      );
  }
}
