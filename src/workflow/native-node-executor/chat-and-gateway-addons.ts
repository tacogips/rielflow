import path from "node:path";
import { AdapterExecutionError, type AdapterExecutionOutput } from "../adapter";
import {
  DEFAULT_MAIL_GATEWAY_IMAGE,
  DEFAULT_X_GATEWAY_IMAGE,
} from "../node-addons";
import { renderPromptTemplate } from "../render";
import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchTarget,
  ChatReplyWorkerConfig,
  ContainerRunnerKind,
  JsonObject,
  ResolvedChatReplyWorkerAddon,
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
  WorkflowDefaults,
  WorkflowNodeAddonEnvBinding,
} from "../types";
import { resolveNodeExecutionWorkingDirectory } from "../working-directory";
import type {
  NativeNodeExecutionContext,
  NativeNodeExecutionInput,
} from "./template-env-and-containers";
import {
  appendContainerEnvNameArgs,
  buildNativeOutput,
  buildProcessLogAttachments,
  buildRunnerEnv,
  isContainerRunnerWithDockerCli,
  isRecord,
  MAIL_GATEWAY_BINARY,
  MAIL_GATEWAY_READ_BINARY,
  mergeProcessLogsIntoAdapterError,
  readOptionalString,
  resolveTemplateVariables,
  runLoggedSpawnedProcess,
  X_GATEWAY_BINARY,
  X_GATEWAY_READ_BINARY,
} from "./template-env-and-containers";

export function resolveChatReplyTarget(
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
export function buildFallbackReplyTarget(input: {
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
export function targetToJson(target: ChatReplyDispatchTarget): JsonObject {
  return {
    sourceId: target.sourceId,
    provider: target.provider,
    eventId: target.eventId,
    conversationId: target.conversationId,
    ...(target.threadId === undefined ? {} : { threadId: target.threadId }),
    ...(target.actorId === undefined ? {} : { actorId: target.actorId }),
  };
}
export function resolveChatReplyStatus(input: {
  readonly target: ChatReplyDispatchTarget | null;
  readonly config: ChatReplyWorkerConfig;
}): "intent-only" | "dry-run" {
  if (input.target !== null) {
    return "intent-only";
  }
  return input.config.onMissingTarget === "dry-run" ? "dry-run" : "intent-only";
}
export function buildChatReplyDispatchRequest(input: {
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
export function resolveOutputDestinationIds(
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
export function buildChatReplyIdempotencyKey(input: {
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
export async function executeChatReplyAddonNode(
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
export function resolveAddonEnv(input: {
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
export function parseXGatewayJsonOutput(input: {
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
export function resolveXGatewayRunner(input: {
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
export function parseMailGatewayJsonOutput(input: {
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
export function resolveMailGatewayRunner(input: {
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
export async function executeXGatewayReadAddonNode(
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
export async function executeXGatewayAddonNode(
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
export async function executeMailGatewayReadAddonNode(
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
export async function executeMailGatewayAddonNode(
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
export function parseCommittedFiles(input: {
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
export function normalizeCommittedFilePath(input: {
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
