import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  AdapterExecutionError,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
} from "./adapter";
import type { NodeExecutionMailbox } from "./node-execution-mailbox";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import { resolveNodeExecutionWorkingDirectory } from "./working-directory";
import {
  DEFAULT_MAIL_GATEWAY_IMAGE,
  DEFAULT_X_GATEWAY_IMAGE,
} from "./node-addons";
import type {
  ChatReplyDispatcher,
  ChatReplyDispatchRequest,
  ChatReplyDispatchTarget,
  ChatReplyWorkerConfig,
  ContainerExecution,
  ContainerRunnerKind,
  JsonObject,
  NodePayload,
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedChatReplyWorkerAddon,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
  WorkflowNodeAddonEnvBinding,
  WorkflowDefaults,
} from "./types";
import { atomicWriteTextFile } from "../shared/fs";

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
  return {
    provider: input.provider,
    model: input.model,
    promptText: input.promptText,
    completionPassed: true,
    when: { always: true },
    payload: input.payload,
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
  const dispatchResult =
    target === null || input.chatReplyDispatcher === undefined
      ? undefined
      : await input.chatReplyDispatcher.dispatchChatReply(
          buildChatReplyDispatchRequest({
            target,
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
