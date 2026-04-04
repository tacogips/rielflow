import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AdapterExecutionError, type AdapterExecutionOutput } from "./adapter";
import type { NodeExecutionMailbox } from "./node-execution-mailbox";
import { buildPromptTemplateVariables } from "./prompt-template-context";
import { renderPromptTemplate } from "./render";
import type {
  ContainerExecution,
  ContainerRunnerKind,
  NodePayload,
  WorkflowDefaults,
} from "./types";
import { atomicWriteTextFile } from "../shared/fs";

interface NativeNodeExecutionContext {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface NativeNodeExecutionInput {
  readonly workflowDirectory: string;
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

function buildChildEnv(input: {
  readonly mailboxDir: string;
  readonly renderedEnv: Readonly<Record<string, string>>;
  readonly ambientEnv?: Readonly<Record<string, string | undefined>>;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(input.ambientEnv === undefined ? {} : input.ambientEnv),
    ...input.renderedEnv,
    DIVEDRA_MAILBOX_DIR: input.mailboxDir,
    DIVEDRA_WORKFLOW_ID: input.workflowId,
    DIVEDRA_WORKFLOW_EXECUTION_ID: input.workflowExecutionId,
    DIVEDRA_NODE_ID: input.nodeId,
    DIVEDRA_NODE_EXEC_ID: input.nodeExecId,
  };
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
          ),
        );
      });
    });
  });
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
    const message = error instanceof Error ? error.message : "unknown parse error";
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
}): AdapterExecutionOutput {
  return {
    provider: input.provider,
    model: input.model,
    promptText: input.promptText,
    completionPassed: true,
    when: { always: true },
    payload: input.payload,
  };
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
}): { readonly runnerKind: ContainerRunnerKind; readonly runnerCommand: string } {
  const runnerKind =
    input.container.runnerKind ??
    input.defaults?.runnerKind ??
    "podman";
  return {
    runnerKind,
    runnerCommand: input.container.runnerPath ?? input.defaults?.runnerPath ?? runnerKind,
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
}): Promise<void> {
  if (!isContainerRunnerWithDockerCli(input.runnerKind)) {
    throw new AdapterExecutionError(
      "policy_blocked",
      `container runner '${input.runnerKind}' is not supported for workflow-local builds`,
    );
  }

  const contextPath = path.join(input.workflowDirectory, input.build.contextPath);
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

  const result = await runSpawnedProcess({
    command: input.runnerCommand,
    args: buildArgs,
    cwd: input.workflowDirectory,
    env: input.env,
    context: input.context,
  });
  await writeProcessLogs({
    artifactDir: input.artifactDir,
    stdout: result.stdout,
    stderr: result.stderr,
    prefix: "build",
  });
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
  const childEnv = buildChildEnv({
    mailboxDir,
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
  });
  const scriptPath = path.join(input.workflowDirectory, commandConfig.scriptPath);
  const cwd =
    commandConfig.workingDirectory === undefined
      ? input.workflowDirectory
      : path.join(input.workflowDirectory, commandConfig.workingDirectory);
  const command =
    path.extname(scriptPath) === ".sh" ? "sh" : scriptPath;
  const args = command === "sh" ? [scriptPath, ...argv] : [...argv];

  const result = await runSpawnedProcess({
    command,
    args,
    cwd,
    env: childEnv,
    context,
  });
  await writeProcessLogs({
    artifactDir: input.artifactDir,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  return buildNativeOutput({
    provider: "native-command",
    model: `command:${path.basename(commandConfig.scriptPath)}`,
    promptText: input.executionMailbox.meta.objective.instruction,
    payload: await readMailboxOutputPayload(mailboxDir),
  });
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
  const renderedArgs = renderTemplateEntries(containerConfig.argsTemplate, variables);
  const renderedEnv = renderTemplateMap(containerConfig.envTemplate, variables);
  const { runnerKind, runnerCommand } = resolveContainerRunner({
    container: containerConfig,
    defaults: input.workflowDefaults.containerRuntime,
  });

  const childEnv = buildChildEnv({
    mailboxDir: "/mailbox",
    renderedEnv,
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    nodeId: input.nodeId,
    nodeExecId: input.nodeExecId,
    ...(input.env === undefined ? {} : { ambientEnv: input.env }),
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
    runArgs.push("--memory", `${String(containerConfig.resources.memoryMaxMb)}m`);
  }
  if (containerConfig.resources?.pidsMax !== undefined) {
    runArgs.push("--pids-limit", String(containerConfig.resources.pidsMax));
  }
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) {
      continue;
    }
    runArgs.push("-e", `${key}=${value}`);
  }

  let image = containerConfig.image;
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
    await buildContainerImage({
      workflowDirectory: input.workflowDirectory,
      artifactDir: input.artifactDir,
      runnerKind,
      runnerCommand,
      build,
      context,
      imageTag: image,
      env: {
        ...process.env,
        ...(input.env === undefined ? {} : input.env),
      },
    });
  }

  if (containerConfig.entrypoint !== undefined && containerConfig.entrypoint.length > 0) {
    runArgs.push("--entrypoint", containerConfig.entrypoint[0] ?? "");
  }
  runArgs.push(image);
  if (containerConfig.entrypoint !== undefined && containerConfig.entrypoint.length > 1) {
    runArgs.push(...containerConfig.entrypoint.slice(1));
  }
  runArgs.push(...renderedArgs);

  const result = await runSpawnedProcess({
    command: runnerCommand,
    args: runArgs,
    cwd: input.workflowDirectory,
    env: {
      ...process.env,
      ...(input.env === undefined ? {} : input.env),
    },
    context,
  });
  await writeProcessLogs({
    artifactDir: input.artifactDir,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  return buildNativeOutput({
    provider: `native-container:${runnerKind}`,
    model: image,
    promptText: input.executionMailbox.meta.objective.instruction,
    payload: await readMailboxOutputPayload(mailboxDir),
  });
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
    default:
      throw new AdapterExecutionError(
        "policy_blocked",
        `node '${input.nodeId}' does not use a native command/container executor`,
      );
  }
}
