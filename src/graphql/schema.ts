import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  SaveWorkflowResponse,
  ValidationResponse,
  WorkflowResponse,
} from "../shared/ui-contract";
import { normalizeAutoImprovePolicy } from "../workflow/auto-improve-policy";
import { runWorkflow, type WorkflowRunOptions } from "../workflow/engine";
import {
  createWorkflowTemplate,
  type CreateWorkflowTemplateMode,
} from "../workflow/create";
import {
  buildFanoutGroupSummaries,
  buildInspectionSummary,
} from "../workflow/inspect";
import { collectWorkflowAddonSourceSummaries } from "../workflow/addon-source-summary";
import { loadWorkflowFromCatalog, type LoadedWorkflow } from "../workflow/load";
import { isSafeWorkflowName } from "../workflow/paths";
import {
  listWorkflowCatalogSources,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "../workflow/catalog";
import {
  collectPromptTemplateFiles,
  collectWorkflowRevisionNodeFiles,
  computeWorkflowRevisionFromFiles,
} from "../workflow/revision";
import { saveWorkflowToDisk } from "../workflow/save";
import {
  createCommunicationService,
  type CommunicationLookupInput,
  type ReplayCommunicationInput as ServiceReplayCommunicationInput,
  type RetryCommunicationDeliveryInput as ServiceRetryCommunicationInput,
} from "../workflow/communication-service";
import {
  createManagerMessageService,
  type SendManagerMessageInput as ServiceSendManagerMessageInput,
} from "../workflow/manager-message-service";
import {
  createManagerSessionStore,
  resolveAmbientManagerExecutionContext,
  type ManagerSessionStore,
} from "../workflow/manager-session-store";
import { assertCommunicationInManagerScope } from "../workflow/manager-control";
import {
  createSessionId,
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type CommunicationRecord,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "../workflow/session";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeLlmSessionMessages,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  type RuntimeLlmSessionMessageRecord,
  type RuntimeNodeExecutionSummary,
  type RuntimeNodeLogEntry,
} from "../workflow/runtime-db";
import type {
  EventBinding,
  EventSupervisedRunRecord,
  EventSupervisorAction,
  EventSupervisorCommand,
  ExternalEventEnvelope,
} from "../events/types";
import { resolveEventRoot } from "../events/config";
import { createRuntimeSupervisorConversationRepository } from "../events/supervisor-conversations";
import { assertSupervisedBindingGraphqlPolicy } from "../events/validate";
import { createEventSupervisedRunRepository } from "../events/supervised-runs";
import { dispatchSupervisorChat } from "../events/dispatch-supervisor-chat";
import { EVENT_SUPERVISOR_ACTION_SET } from "../events/supervisor-command-contract";
import {
  createWorkflowSupervisorClient,
  reconcileTerminalSupervisedRunForCorrelation,
  reconcileTerminalSupervisedRunRecord,
} from "../workflow/supervisor-client";
import { createSupervisorRunnerPool } from "../workflow/supervisor-runner-pool";
import { createWorkflowSupervisorDispatchClient } from "../workflow/supervisor-dispatch-client";
import {
  listSessions,
  loadSession,
  saveSession,
} from "../workflow/session-store";
import type { WorkflowExecutionSummary } from "../shared/ui-contract";
import { err, ok, type Result } from "../workflow/result";
import { validateWorkflowBundleDetailedAsync } from "../workflow/validate";
import { deriveWorkflowVisualization } from "../workflow/visualization";
import { normalizeWorkflowWorkingDirectoryOverride } from "../workflow/working-directory";
import { parseWorkflowBundleInput } from "../workflow/workflow-bundle-input";
import type { WorkflowJson } from "../workflow/types";
import {
  continueWorkflowFromHistory,
  listMergedWorkflowExecutionStepRuns,
} from "../lib";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  type WorkflowCatalogOverview,
  type WorkflowStatusOverview,
} from "../workflow/overview";
import type {
  CreateWorkflowDefinitionInput,
  CommunicationConnection,
  SaveWorkflowDefinitionInput,
  SaveWorkflowDefinitionPayload,
  ExecuteWorkflowInput,
  ExecuteWorkflowPayload,
  GraphqlManagerScope,
  GraphqlRequestContext,
  GraphqlSchema,
  GraphqlSchemaDependencies,
  LlmSessionMessagesSelectionInput,
  LlmSessionMessageOrder,
  ManagerSessionLookupInput,
  ManagerSessionView,
  NodeExecutionLookupInput,
  NodeExecutionView,
  ValidateWorkflowDefinitionInput,
  ValidateWorkflowDefinitionPayload,
  WorkflowDefinitionLookupInput,
  WorkflowDefinitionView,
  WorkflowDefinitionsView,
  WorkflowExecutionConnection,
  WorkflowExecutionOverviewLookupInput,
  WorkflowExecutionOverviewView,
  WorkflowExecutionStepRunsPayload,
  WorkflowExecutionStepRunsQueryInput,
  ReplayCommunicationInput,
  ReplayCommunicationPayload,
  RetryCommunicationDeliveryInput,
  RetryCommunicationDeliveryPayload,
  RerunWorkflowExecutionInput,
  RerunWorkflowExecutionPayload,
  ResumeWorkflowExecutionInput,
  ResumeWorkflowExecutionPayload,
  SendManagerMessageInput,
  SendManagerMessagePayload,
  WorkflowExecutionLookupInput,
  WorkflowExecutionsQueryInput,
  WorkflowExecutionView,
  WorkflowCatalogOverviewGraphqlInput,
  WorkflowLookupInput,
  WorkflowSessionView,
  WorkflowStatusOverviewGraphqlInput,
  WorkflowView,
  CommunicationsQueryInput,
  CancelWorkflowExecutionInput,
  CancelWorkflowExecutionPayload,
  ContinueWorkflowExecutionInput,
  ContinueWorkflowExecutionPayload,
  DispatchSupervisedWorkflowCommandInput,
  DispatchSupervisorChatGraphqlInput,
  DispatchSupervisorChatPayload,
  DispatchSupervisorConversationGraphqlInput,
  DispatchSupervisorConversationPayload,
  SupervisorDispatchConversationGraphqlPayload,
  SupervisorDispatchConversationLookupGraphqlInput,
  EventSupervisorCommandInput,
  SupervisedWorkflowGraphqlPayload,
  SupervisedWorkflowLookupGraphqlInput,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_LLM_SESSION_MESSAGE_LIMIT = 1;
const DEFAULT_LLM_SESSION_MESSAGE_ORDER: LlmSessionMessageOrder = "DESC";

export interface GraphqlLlmSessionMessagesArgs {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}

function parseLlmSessionMessageOrder(
  order: string | null | undefined,
): LlmSessionMessagesSelectionInput["order"] {
  if (order === null || order === undefined) {
    return DEFAULT_LLM_SESSION_MESSAGE_ORDER;
  }

  const normalized = order.toUpperCase();
  if (normalized === "ASC" || normalized === "DESC") {
    return normalized;
  }
  throw new Error(`Unsupported LLM session message order: ${order}`);
}

function normalizeLlmSessionMessageLimit(
  limit: number | null | undefined,
): number {
  if (limit === null || limit === undefined) {
    return DEFAULT_LLM_SESSION_MESSAGE_LIMIT;
  }
  if (!Number.isFinite(limit)) {
    throw new Error("LLM session message limit must be a finite number");
  }
  return Math.trunc(limit);
}

function compareLlmSessionMessagesByAge(
  left: RuntimeLlmSessionMessageRecord,
  right: RuntimeLlmSessionMessageRecord,
): number {
  const idDelta = left.id - right.id;
  if (idDelta !== 0) {
    return idDelta;
  }

  const atCompare = left.at.localeCompare(right.at);
  if (atCompare !== 0) {
    return atCompare;
  }

  const nodeCompare = left.nodeExecId.localeCompare(right.nodeExecId);
  if (nodeCompare !== 0) {
    return nodeCompare;
  }
  return left.ordinal - right.ordinal;
}

export function selectGraphqlLlmSessionMessages(
  messages: readonly RuntimeLlmSessionMessageRecord[],
  args: GraphqlLlmSessionMessagesArgs = {},
): readonly RuntimeLlmSessionMessageRecord[] {
  const order = parseLlmSessionMessageOrder(args.order);
  const limit = normalizeLlmSessionMessageLimit(args.limit);
  const ordered = [...messages].sort((left, right) => {
    const ageComparison = compareLlmSessionMessagesByAge(left, right);
    return order === "ASC" ? ageComparison : -ageComparison;
  });

  if (limit <= 0) {
    return [];
  }
  return ordered.slice(0, limit);
}

interface GraphqlWorkflowRunOverridesInput {
  readonly autoImprove?: ExecuteWorkflowInput["autoImprove"];
  readonly nestedSuperviser?: boolean;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}

function buildGraphqlWorkflowRunOverrides(
  input: GraphqlWorkflowRunOverridesInput,
  defaultAutoImprove = false,
): Result<
  Pick<
    WorkflowRunOptions,
    | "autoImprove"
    | "nestedSuperviserDriver"
    | "workflowWorkingDirectory"
    | "dryRun"
    | "maxSteps"
    | "maxLoopIterations"
    | "defaultTimeoutMs"
    | "maxConcurrency"
  >,
  string
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  const autoImprove =
    input.autoImprove === undefined
      ? defaultAutoImprove
        ? { enabled: true }
        : undefined
      : input.autoImprove;
  const normalizedAutoImprove =
    autoImprove === undefined
      ? { ok: true as const, value: undefined }
      : normalizeAutoImprovePolicy(autoImprove);
  if (!normalizedAutoImprove.ok) {
    return err(`invalid autoImprove policy: ${normalizedAutoImprove.error}`);
  }
  if (input.nestedSuperviser === true && autoImprove === undefined) {
    return err("nestedSuperviser requires supervised autoImprove");
  }
  return ok({
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(autoImprove === undefined ? {} : { autoImprove }),
    ...(input.nestedSuperviser === true
      ? { nestedSuperviserDriver: true }
      : {}),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: input.maxConcurrency }),
  });
}

function parseWorkflowExecutionStepRunsStatusFilter(
  raw: string | undefined | null,
): NodeExecutionRecord["status"] | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const allowed: ReadonlySet<string> = new Set([
    "succeeded",
    "failed",
    "timed_out",
    "cancelled",
    "skipped",
  ]);
  if (!allowed.has(trimmed)) {
    throw new Error(
      `invalid workflowExecutionStepRuns status '${raw}' (expected succeeded, failed, timed_out, cancelled, or skipped)`,
    );
  }
  return trimmed as NodeExecutionRecord["status"];
}

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return null;
    }
    throw error;
  }
}

function resolveManagerStore(
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
): ManagerSessionStore {
  return deps.managerSessionStore ?? createManagerSessionStore(context);
}

function resolveCommunicationService(
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
) {
  const managerStore = resolveManagerStore(context, deps);
  return (
    deps.communicationService ??
    createCommunicationService({
      ...(deps.now === undefined ? {} : { now: deps.now }),
      idempotencyStore: managerStore,
    })
  );
}

function resolveManagerMessageService(
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
) {
  const managerStore = resolveManagerStore(context, deps);
  return (
    deps.managerMessageService ??
    createManagerMessageService({
      ...(deps.now === undefined ? {} : { now: deps.now }),
      managerSessionStore: managerStore,
      communicationService: resolveCommunicationService(context, deps),
    })
  );
}

function resolveScopedManagerSessionId(
  managerSessionId: string | undefined,
  context: GraphqlRequestContext,
): string | undefined {
  if (managerSessionId !== undefined) {
    return managerSessionId;
  }
  if (context.managerSessionId !== undefined) {
    return context.managerSessionId;
  }
  return resolveAmbientManagerExecutionContext(context.env)?.managerSessionId;
}

function resolveScopedAuthToken(
  context: GraphqlRequestContext,
): string | undefined {
  if (context.authToken !== undefined) {
    return context.authToken;
  }
  return resolveAmbientManagerExecutionContext(context.env)?.authToken;
}

async function listWorkflowDefinitionNames(
  context: GraphqlRequestContext,
): Promise<WorkflowDefinitionsView> {
  const sources = await listWorkflowCatalogSources(context);
  if (!sources.ok) {
    throw new Error(sources.error.message);
  }

  const names =
    context.fixedWorkflowName === undefined
      ? sources.value.map((source) => source.workflowName)
      : sources.value
          .filter((source) => source.workflowName === context.fixedWorkflowName)
          .map((source) => source.workflowName);

  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

function assertWorkflowDefinitionAccess(
  workflowName: string,
  context: GraphqlRequestContext,
): void {
  if (!isSafeWorkflowName(workflowName)) {
    throw new Error(`invalid workflow name '${workflowName}'`);
  }
  if (
    context.fixedWorkflowName !== undefined &&
    context.fixedWorkflowName !== workflowName
  ) {
    throw new Error("workflow name not allowed in fixed workflow mode");
  }
}

function isOverviewWorkflowCatalogNotFound(error: {
  readonly code: string;
  readonly message: string;
}): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "NOT_FOUND" &&
    typeof error.message === "string" &&
    !error.message.startsWith("session not found:")
  );
}

async function workflowCatalogOverviewQuery(
  input: WorkflowCatalogOverviewGraphqlInput,
  context: GraphqlRequestContext,
): Promise<WorkflowCatalogOverview> {
  const catalogInput = {
    ...(input.workflowScope === undefined
      ? {}
      : { workflowScope: input.workflowScope }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
  const built = await buildWorkflowCatalogOverview(catalogInput, context);
  if (!built.ok) {
    throw new Error(built.error.message);
  }
  let workflows = built.value.workflows;
  if (
    context.fixedWorkflowName !== undefined &&
    context.fixedResolvedWorkflowSource === undefined
  ) {
    workflows = workflows.filter(
      (row) => row.workflowName === context.fixedWorkflowName,
    );
  }
  return { workflows };
}

function workflowStatusOverviewInputForFixedMode(
  input: WorkflowStatusOverviewGraphqlInput,
  context: GraphqlRequestContext,
): WorkflowStatusOverviewGraphqlInput {
  const fixedSource = context.fixedResolvedWorkflowSource;
  if (fixedSource === undefined) {
    return input;
  }
  return {
    workflowName: fixedSource.workflowName,
    ...(fixedSource.scope === "direct"
      ? {}
      : { workflowScope: fixedSource.scope }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

async function workflowStatusOverviewQuery(
  input: WorkflowStatusOverviewGraphqlInput,
  context: GraphqlRequestContext,
): Promise<WorkflowStatusOverview | null> {
  assertWorkflowDefinitionAccess(input.workflowName, context);
  const effectiveInput = workflowStatusOverviewInputForFixedMode(
    input,
    context,
  );
  const built = await buildWorkflowStatusOverview(effectiveInput, context);
  if (!built.ok) {
    if (isOverviewWorkflowCatalogNotFound(built.error)) {
      return null;
    }
    throw new Error(built.error.message);
  }
  return built.value;
}

function assertWorkflowDefinitionWritable(
  workflowName: string,
  context: GraphqlRequestContext,
): void {
  if (context.readOnly === true) {
    throw new Error("read-only mode enabled");
  }
  if (
    context.fixedWorkflowName !== undefined &&
    context.fixedWorkflowName !== workflowName
  ) {
    throw new Error(
      "cannot write workflows outside fixed workflow mode target",
    );
  }
}

function optionsForLoadedWorkflow(
  loadedWorkflow: LoadedWorkflow,
  context: GraphqlRequestContext,
): GraphqlRequestContext {
  return loadedWorkflow.source === undefined
    ? context
    : withResolvedWorkflowSourceOptions(loadedWorkflow.source, context);
}

async function loadWorkflowDefinitionForGraphql(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<LoadedWorkflow | null> {
  assertWorkflowDefinitionAccess(workflowName, context);
  const loaded = await loadWorkflowFromCatalog(workflowName, context);
  return loaded.ok ? loaded.value : null;
}

async function resolveWorkflowContextForGraphql(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<GraphqlRequestContext> {
  assertWorkflowDefinitionAccess(workflowName, context);
  const source = await resolveWorkflowSource(workflowName, context);
  if (!source.ok) {
    throw new Error(source.error.message);
  }
  return withResolvedWorkflowSourceOptions(source.value, context);
}

async function buildWorkflowDefinitionView(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<WorkflowDefinitionView | null> {
  const loaded = await loadWorkflowDefinitionForGraphql(workflowName, context);
  if (loaded === null) {
    return null;
  }
  const nodeFiles = collectWorkflowRevisionNodeFiles(loaded.bundle.workflow);
  const revision = await computeWorkflowRevisionFromFiles(
    loaded.workflowDirectory,
    nodeFiles,
    collectPromptTemplateFiles(loaded.bundle.nodePayloads),
  );
  return {
    workflowName: loaded.workflowName,
    workflowDirectory: loaded.workflowDirectory,
    artifactWorkflowRoot: loaded.artifactWorkflowRoot,
    revision: revision.ok ? revision.value : null,
    bundle: loaded.bundle,
    derivedVisualization: deriveWorkflowVisualization({
      workflow: loaded.bundle.workflow,
    }),
  } satisfies WorkflowResponse;
}

async function createWorkflowDefinitionMutation(
  input: CreateWorkflowDefinitionInput,
  context: GraphqlRequestContext,
): Promise<WorkflowDefinitionView> {
  if (context.readOnly === true) {
    throw new Error("read-only mode enabled");
  }
  if (context.fixedWorkflowName !== undefined) {
    throw new Error("cannot create workflows in fixed workflow mode");
  }
  if (!isSafeWorkflowName(input.workflowName)) {
    throw new Error(`invalid workflow name '${input.workflowName}'`);
  }
  const templateMode = normalizeCreateWorkflowTemplateMode(input.templateMode);
  const created = await createWorkflowTemplate(input.workflowName, {
    ...context,
    ...(templateMode === undefined ? {} : { templateMode }),
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }
  const loaded = await buildWorkflowDefinitionView(
    created.value.workflowName,
    context,
  );
  if (loaded === null) {
    throw new Error(
      `workflow '${created.value.workflowName}' was not found after creation`,
    );
  }
  return loaded;
}

function normalizeCreateWorkflowTemplateMode(
  value: CreateWorkflowDefinitionInput["templateMode"],
): CreateWorkflowTemplateMode | undefined {
  if (value === undefined || value === "managed" || value === "MANAGED") {
    return value === undefined ? undefined : "managed";
  }
  if (value === "worker-only" || value === "WORKER_ONLY") {
    return "worker-only";
  }
  throw new Error(`unsupported workflow template mode '${value}'`);
}

async function saveWorkflowDefinitionMutation(
  input: SaveWorkflowDefinitionInput,
  context: GraphqlRequestContext,
): Promise<SaveWorkflowDefinitionPayload> {
  const parsedBundle = parseWorkflowBundleInput(input.bundle, "input.bundle");
  if (!parsedBundle.ok) {
    return {
      workflowName: input.workflowName,
      error: parsedBundle.error,
      issues: [],
    };
  }
  assertWorkflowDefinitionWritable(input.workflowName, context);
  const workflowContext = await resolveWorkflowContextForGraphql(
    input.workflowName,
    context,
  );
  const saveResult = await saveWorkflowToDisk(
    input.workflowName,
    {
      workflow: parsedBundle.value.workflow,
      nodePayloads: parsedBundle.value.nodePayloads,
      ...(input.expectedRevision === undefined
        ? {}
        : { expectedRevision: input.expectedRevision }),
    },
    workflowContext,
  );
  if (!saveResult.ok) {
    return {
      workflowName: input.workflowName,
      error: saveResult.error.message,
      ...(saveResult.error.currentRevision === undefined
        ? {}
        : { currentRevision: saveResult.error.currentRevision }),
      ...(saveResult.error.issues === undefined
        ? {}
        : { issues: saveResult.error.issues }),
    };
  }
  return {
    workflowName: saveResult.value.workflowName,
    workflowDirectory: saveResult.value.workflowDirectory,
    revision: saveResult.value.revision,
  } satisfies SaveWorkflowResponse;
}

async function validateWorkflowDefinitionMutation(
  input: ValidateWorkflowDefinitionInput,
  context: GraphqlRequestContext,
): Promise<ValidateWorkflowDefinitionPayload> {
  if (input.bundle !== undefined) {
    const parsedBundle = parseWorkflowBundleInput(input.bundle, "input.bundle");
    if (!parsedBundle.ok) {
      return {
        valid: false,
        error: parsedBundle.error,
        issues: [],
      } satisfies ValidationResponse;
    }
    const validation = await validateWorkflowBundleDetailedAsync(
      {
        workflow: parsedBundle.value.workflow,
        nodePayloads: parsedBundle.value.nodePayloads,
      },
      context,
    );
    if (!validation.ok) {
      return {
        valid: false,
        issues: validation.error,
      } satisfies ValidationResponse;
    }
    const addonSources = await collectWorkflowAddonSourceSummaries({
      workflow: validation.value.bundle.workflow,
      options: context,
    });
    return {
      valid: true,
      workflowId: validation.value.bundle.workflow.workflowId,
      addonSources,
      warnings: validation.value.issues.filter(
        (issue) => issue.severity === "warning",
      ),
      issues: validation.value.issues,
    } satisfies ValidationResponse;
  }

  assertWorkflowDefinitionAccess(input.workflowName, context);
  const loaded = await loadWorkflowFromCatalog(input.workflowName, context);
  if (!loaded.ok) {
    return {
      valid: false,
      error: loaded.error.message,
      issues: loaded.error.issues ?? [],
    } satisfies ValidationResponse;
  }
  const workflowContext = optionsForLoadedWorkflow(loaded.value, context);
  return {
    valid: true,
    workflowId: loaded.value.bundle.workflow.workflowId,
    addonSources: await collectWorkflowAddonSourceSummaries({
      workflow: loaded.value.bundle.workflow,
      options: workflowContext,
      ...(loaded.value.source === undefined
        ? {}
        : { workflowSource: loaded.value.source }),
    }),
    warnings: [],
  } satisfies ValidationResponse;
}

async function authenticateManagerScope(
  input: ManagerSessionLookupInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
): Promise<GraphqlManagerScope> {
  const managerSessionId = resolveScopedManagerSessionId(
    input.managerSessionId,
    context,
  );
  if (managerSessionId === undefined) {
    throw new Error(
      "managerSessionId is required for manager-scoped GraphQL operations",
    );
  }
  const authToken = resolveScopedAuthToken(context);
  if (authToken === undefined) {
    throw new Error(
      "manager auth token is required for manager-scoped GraphQL operations",
    );
  }

  const managerStore = resolveManagerStore(context, deps);
  const session = await managerStore.validateAuthToken({
    managerSessionId,
    authToken,
    now: (deps.now ?? nowIso)(),
  });
  if (session === null) {
    throw new Error(`invalid manager auth for session '${managerSessionId}'`);
  }

  return {
    context: resolveAmbientManagerExecutionContext(context.env),
    session,
  };
}

function assertWorkflowExecutionScope(
  workflowId: string,
  workflowExecutionId: string,
  scope: GraphqlManagerScope,
): void {
  if (
    scope.session.workflowId !== workflowId ||
    scope.session.workflowExecutionId !== workflowExecutionId
  ) {
    throw new Error(
      "manager session scope does not match the requested workflow execution",
    );
  }
}

function assertManagerIdentity(
  input: Pick<SendManagerMessageInput, "managerNodeExecId">,
  scope: GraphqlManagerScope,
): void {
  if (
    input.managerNodeExecId !== undefined &&
    input.managerNodeExecId !== scope.session.managerNodeExecId
  ) {
    throw new Error(
      "managerNodeExecId does not match the authenticated manager session",
    );
  }
}

function findTerminalMessage(
  session: WorkflowSessionState,
  nodeExecId: string,
  logs: readonly {
    readonly nodeExecId: string | null;
    readonly message: string;
  }[],
): string | null {
  const matchingLogs = logs.filter((entry) => entry.nodeExecId === nodeExecId);
  const lastLog = matchingLogs.at(-1);
  if (lastLog !== undefined) {
    return lastLog.message;
  }
  return session.lastError ?? null;
}

async function buildNodeExecutionViewFromState(
  session: WorkflowSessionState,
  sessionRecord: WorkflowSessionState["nodeExecutions"][number],
  runtimeExecutions: readonly RuntimeNodeExecutionSummary[],
  runtimeLogs: readonly RuntimeNodeLogEntry[],
  runtimeLlmMessages: readonly RuntimeLlmSessionMessageRecord[],
  recentLogLimit: number | undefined,
  llmMessagesSelection: LlmSessionMessagesSelectionInput | undefined,
): Promise<NodeExecutionView> {
  const runtimeExecution = runtimeExecutions.find(
    (execution) =>
      execution.nodeId === sessionRecord.nodeId &&
      execution.nodeExecId === sessionRecord.nodeExecId,
  );
  const matchingLogs = runtimeLogs.filter(
    (entry) => entry.nodeExecId === sessionRecord.nodeExecId,
  );
  const matchingLlmMessages = selectGraphqlLlmSessionMessages(
    runtimeLlmMessages.filter(
      (entry) => entry.nodeExecId === sessionRecord.nodeExecId,
    ),
    llmMessagesSelection,
  );
  const logLimit = recentLogLimit ?? 20;
  const recentLogs =
    logLimit <= 0
      ? []
      : matchingLogs.slice(Math.max(matchingLogs.length - logLimit, 0));
  const artifactDir =
    runtimeExecution?.artifactDir ?? sessionRecord.artifactDir;

  return {
    workflowId: session.workflowId,
    workflowExecutionId: session.sessionId,
    nodeId: sessionRecord.nodeId,
    ...(sessionRecord.stepId === undefined
      ? {}
      : { stepId: sessionRecord.stepId }),
    ...(sessionRecord.nodeRegistryId === undefined
      ? {}
      : { nodeRegistryId: sessionRecord.nodeRegistryId }),
    nodeExecId: sessionRecord.nodeExecId,
    ...(sessionRecord.mailboxInstanceId === undefined
      ? {}
      : { mailboxInstanceId: sessionRecord.mailboxInstanceId }),
    status: sessionRecord.status,
    startedAt: sessionRecord.startedAt,
    endedAt: sessionRecord.endedAt,
    ...(sessionRecord.attempt === undefined
      ? {}
      : { attempt: sessionRecord.attempt }),
    ...(sessionRecord.outputAttemptCount === undefined
      ? {}
      : { outputAttemptCount: sessionRecord.outputAttemptCount }),
    ...(sessionRecord.outputValidationErrors === undefined
      ? {}
      : { outputValidationErrors: sessionRecord.outputValidationErrors }),
    ...(sessionRecord.promptVariant === undefined
      ? {}
      : { promptVariant: sessionRecord.promptVariant }),
    ...(sessionRecord.timeoutMs === undefined
      ? {}
      : { timeoutMs: sessionRecord.timeoutMs }),
    ...(sessionRecord.backendSessionId === undefined
      ? {}
      : { backendSessionId: sessionRecord.backendSessionId }),
    ...(sessionRecord.backendSessionMode === undefined
      ? {}
      : { backendSessionMode: sessionRecord.backendSessionMode }),
    ...(sessionRecord.restartedFromNodeExecId === undefined
      ? {}
      : { restartedFromNodeExecId: sessionRecord.restartedFromNodeExecId }),
    artifactDir,
    output:
      runtimeExecution?.outputJson ??
      (await readOptionalText(path.join(artifactDir, "output.json"))),
    meta: await readOptionalText(path.join(artifactDir, "meta.json")),
    terminalMessage: findTerminalMessage(
      session,
      sessionRecord.nodeExecId,
      matchingLogs,
    ),
    recentLogs,
    llmMessages: matchingLlmMessages,
  };
}

async function buildNodeExecutionView(
  input: NodeExecutionLookupInput,
  context: GraphqlRequestContext,
): Promise<NodeExecutionView | null> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok || loaded.value.workflowId !== input.workflowId) {
    return null;
  }

  const session = loaded.value;
  const sessionRecord = session.nodeExecutions.find(
    (execution) =>
      execution.nodeId === input.nodeId &&
      execution.nodeExecId === input.nodeExecId,
  );
  if (sessionRecord === undefined) {
    return null;
  }

  const runtimeExecutions = await listRuntimeNodeExecutions(
    input.workflowExecutionId,
    context,
  );
  const runtimeExecution = runtimeExecutions.find(
    (execution) =>
      execution.nodeId === input.nodeId &&
      execution.nodeExecId === input.nodeExecId,
  );
  const runtimeLogs = await listRuntimeNodeLogs(
    input.workflowExecutionId,
    context,
  );
  const runtimeLlmMessages = await listRuntimeLlmSessionMessages(
    input.workflowExecutionId,
    context,
  );

  return buildNodeExecutionViewFromState(
    session,
    sessionRecord,
    runtimeExecution === undefined ? [] : [runtimeExecution],
    runtimeLogs,
    runtimeLlmMessages,
    input.recentLogLimit,
    input.llmMessages,
  );
}

function toWorkflowExecutionSummary(
  session: WorkflowSessionState,
  currentStepId: string | null = resolveCurrentStepId(session),
): WorkflowExecutionSummary {
  return {
    workflowExecutionId: session.sessionId,
    sessionId: session.sessionId,
    workflowName: session.workflowName,
    status: session.status,
    currentNodeId: session.currentNodeId ?? null,
    ...(currentStepId === null ? {} : { currentStepId }),
    nodeExecutionCounter: session.nodeExecutionCounter,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
  };
}

interface CurrentStepWorkflowView {
  readonly workflowId: string;
  readonly steps?: WorkflowJson["steps"];
}

async function resolveSessionCurrentStepId(input: {
  readonly session: WorkflowSessionState;
  readonly context: GraphqlRequestContext;
  readonly workflowCache?: Map<
    string,
    Promise<CurrentStepWorkflowView | undefined>
  >;
}): Promise<string | null> {
  const currentStepId = resolveCurrentStepId(input.session);
  if (currentStepId !== null) {
    return currentStepId;
  }

  const cache =
    input.workflowCache ??
    new Map<string, Promise<CurrentStepWorkflowView | undefined>>();
  const cacheKey = input.session.workflowName;
  const cached = cache.get(cacheKey);
  let pending: Promise<CurrentStepWorkflowView | undefined>;
  if (cached === undefined) {
    pending = loadWorkflowFromCatalog(cacheKey, input.context).then((loaded) =>
      loaded.ok
        ? {
            workflowId: loaded.value.bundle.workflow.workflowId,
            ...(loaded.value.bundle.workflow.steps === undefined
              ? {}
              : { steps: loaded.value.bundle.workflow.steps }),
          }
        : undefined,
    );
    cache.set(cacheKey, pending);
  } else {
    pending = cached;
  }
  const workflow = await pending;
  if (workflow?.workflowId !== input.session.workflowId) {
    return null;
  }

  return resolveCurrentStepIdFromWorkflow(
    input.session,
    workflow.steps === undefined ? undefined : { steps: workflow.steps },
  );
}

async function toWorkflowSessionView(
  session: WorkflowSessionState,
  context: GraphqlRequestContext,
): Promise<WorkflowSessionView> {
  return {
    ...session,
    fanoutGroups: session.fanoutGroups ?? [],
    currentStepId: await resolveSessionCurrentStepId({ session, context }),
    fanoutSummaries: buildFanoutGroupSummaries(session),
  };
}

async function buildWorkflowExecutionConnection(
  input: WorkflowExecutionsQueryInput,
  context: GraphqlRequestContext,
): Promise<WorkflowExecutionConnection> {
  const listed = await listSessions(context);
  if (!listed.ok) {
    throw new Error(listed.error.message);
  }

  const workflowCache = new Map<
    string,
    Promise<CurrentStepWorkflowView | undefined>
  >();
  const loadedSessions = await Promise.all(
    listed.value.map(async (workflowExecutionId) => {
      const loaded = await loadSession(workflowExecutionId, context);
      if (!loaded.ok) {
        return undefined;
      }
      const currentStepId = await resolveSessionCurrentStepId({
        session: loaded.value,
        context,
        workflowCache,
      });
      return toWorkflowExecutionSummary(loaded.value, currentStepId);
    }),
  );

  const filtered = loadedSessions
    .filter((entry): entry is WorkflowExecutionSummary => entry !== undefined)
    .filter((entry) =>
      input.workflowName === undefined
        ? true
        : entry.workflowName === input.workflowName,
    )
    .filter((entry) =>
      input.status === undefined ? true : entry.status === input.status,
    );

  const startIndex =
    input.afterWorkflowExecutionId === undefined
      ? 0
      : Math.max(
          filtered.findIndex(
            (entry) =>
              entry.workflowExecutionId === input.afterWorkflowExecutionId,
          ) + 1,
          0,
        );
  const totalCount = filtered.length;
  const pageSize =
    input.first === undefined || input.first <= 0
      ? filtered.length
      : input.first;
  const items = filtered.slice(startIndex, startIndex + pageSize);
  const nextCursor =
    startIndex + pageSize < filtered.length && items.length > 0
      ? items[items.length - 1]?.workflowExecutionId
      : undefined;

  return {
    items,
    totalCount,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

async function buildWorkflowExecutionView(
  input: WorkflowExecutionLookupInput,
  context: GraphqlRequestContext,
): Promise<WorkflowExecutionView | null> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok) {
    return null;
  }
  const [nodeExecutions, nodeLogs, llmMessages, hookEvents, replyDispatches] =
    await Promise.all([
      listRuntimeNodeExecutions(input.workflowExecutionId, context),
      listRuntimeNodeLogs(input.workflowExecutionId, context),
      listRuntimeLlmSessionMessages(input.workflowExecutionId, context),
      listRuntimeHookEvents(input.workflowExecutionId, context),
      listEventReplyDispatchesFromRuntimeDb(
        { workflowExecutionId: input.workflowExecutionId },
        context,
      ),
    ]);
  return {
    workflowExecutionId: input.workflowExecutionId,
    session: await toWorkflowSessionView(loaded.value, context),
    nodeExecutions,
    nodeLogs,
    llmMessages: selectGraphqlLlmSessionMessages(
      llmMessages,
      input.llmMessages,
    ),
    hookEvents,
    replyDispatches,
  };
}

async function buildWorkflowExecutionOverviewView(
  input: WorkflowExecutionOverviewLookupInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
): Promise<WorkflowExecutionOverviewView | null> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok) {
    return null;
  }

  const session = loaded.value;
  const [
    runtimeExecutions,
    runtimeLogs,
    runtimeLlmMessages,
    hookEvents,
    replyDispatches,
  ] = await Promise.all([
    listRuntimeNodeExecutions(input.workflowExecutionId, context),
    listRuntimeNodeLogs(input.workflowExecutionId, context),
    listRuntimeLlmSessionMessages(input.workflowExecutionId, context),
    listRuntimeHookEvents(input.workflowExecutionId, context),
    listEventReplyDispatchesFromRuntimeDb(
      { workflowExecutionId: input.workflowExecutionId },
      context,
    ),
  ]);
  const nodes = await Promise.all(
    session.nodeExecutions.map((execution) =>
      buildNodeExecutionViewFromState(
        session,
        execution,
        runtimeExecutions,
        runtimeLogs,
        runtimeLlmMessages,
        input.recentLogLimit,
        input.llmMessages,
      ),
    ),
  );

  const communications = await buildCommunicationConnection(
    {
      workflowId: session.workflowId,
      workflowExecutionId: input.workflowExecutionId,
      ...(input.firstCommunications === undefined
        ? {}
        : { first: input.firstCommunications }),
      ...(input.afterCommunicationId === undefined
        ? {}
        : { afterCommunicationId: input.afterCommunicationId }),
    },
    context,
    deps,
  );

  return {
    workflowExecutionId: input.workflowExecutionId,
    workflowId: session.workflowId,
    workflowName: session.workflowName,
    status: session.status,
    session: await toWorkflowSessionView(session, context),
    nodes,
    communications,
    nodeLogs: runtimeLogs,
    llmMessages: selectGraphqlLlmSessionMessages(
      runtimeLlmMessages,
      input.llmMessages,
    ),
    hookEvents,
    replyDispatches,
  };
}

async function buildCommunicationConnection(
  input: CommunicationsQueryInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
): Promise<CommunicationConnection> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok || loaded.value.workflowId !== input.workflowId) {
    return { items: [], totalCount: 0 };
  }

  let records = loaded.value.communications.filter((communication) => {
    if (communication.workflowId !== input.workflowId) {
      return false;
    }
    if (
      input.fromNodeId !== undefined &&
      communication.fromNodeId !== input.fromNodeId
    ) {
      return false;
    }
    if (
      input.toNodeId !== undefined &&
      communication.toNodeId !== input.toNodeId
    ) {
      return false;
    }
    if (input.status !== undefined && communication.status !== input.status) {
      return false;
    }
    return true;
  });

  if (input.afterCommunicationId !== undefined) {
    const cursorIndex = records.findIndex(
      (communication) =>
        communication.communicationId === input.afterCommunicationId,
    );
    if (cursorIndex >= 0) {
      records = records.slice(cursorIndex + 1);
    }
  }

  const first = input.first ?? 50;
  const selected = first <= 0 ? [] : records.slice(0, first);
  const service = resolveCommunicationService(context, deps);
  const items = (
    await Promise.all(
      selected.map((communication) =>
        service.getCommunication(
          {
            workflowId: input.workflowId,
            workflowExecutionId: input.workflowExecutionId,
            communicationId: communication.communicationId,
          },
          context,
        ),
      ),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const nextCursor =
    records.length > selected.length
      ? selected.at(-1)?.communicationId
      : undefined;
  return {
    items,
    totalCount: records.length,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

async function loadScopedCommunicationForManagerMutation(
  input: {
    readonly workflowId: string;
    readonly workflowExecutionId: string;
    readonly communicationId: string;
  },
  scope: GraphqlManagerScope,
  context: GraphqlRequestContext,
): Promise<CommunicationRecord> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  if (loaded.value.workflowId !== input.workflowId) {
    throw new Error(
      `workflow execution '${input.workflowExecutionId}' does not belong to workflow '${input.workflowId}'`,
    );
  }
  const communication = loaded.value.communications.find(
    (entry) => entry.communicationId === input.communicationId,
  );
  if (communication === undefined) {
    throw new Error(
      `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
    );
  }
  const loadedWorkflow = await loadWorkflowDefinitionForGraphql(
    loaded.value.workflowName,
    context,
  );
  if (loadedWorkflow === null) {
    throw new Error(`workflow '${loaded.value.workflowName}' was not found`);
  }
  assertCommunicationInManagerScope(
    communication,
    loadedWorkflow.bundle.workflow,
    {
      managerStepId: scope.session.managerStepId,
    },
    "GraphQL manager mutation",
  );
  return communication;
}

async function executeWorkflowMutation(
  input: ExecuteWorkflowInput,
  context: GraphqlRequestContext,
): Promise<ExecuteWorkflowPayload> {
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input, true);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    input.workflowName,
    context,
  );
  if (input.async === true) {
    const loadedWorkflow = await loadWorkflowFromCatalog(
      input.workflowName,
      workflowContext,
    );
    if (!loadedWorkflow.ok) {
      throw new Error(loadedWorkflow.error.message);
    }
    const workflowExecutionId = createSessionId({
      workflowId: loadedWorkflow.value.bundle.workflow.workflowId,
    });
    void runWorkflow(input.workflowName, {
      ...workflowContext,
      sessionId: workflowExecutionId,
      ...workflowRunOverrides.value,
      ...(input.runtimeVariables === undefined
        ? {}
        : { runtimeVariables: input.runtimeVariables }),
      ...(input.mockScenario === undefined
        ? {}
        : { mockScenario: input.mockScenario }),
    }).catch(() => undefined);
    return {
      workflowExecutionId,
      sessionId: workflowExecutionId,
      status: "running",
      accepted: true,
    };
  }

  const result = await runWorkflow(input.workflowName, {
    ...workflowContext,
    ...workflowRunOverrides.value,
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    workflowExecutionId: result.value.session.sessionId,
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

async function resumeWorkflowExecutionMutation(
  input: ResumeWorkflowExecutionInput,
  context: GraphqlRequestContext,
): Promise<ResumeWorkflowExecutionPayload> {
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const existing = await loadSession(input.workflowExecutionId, context);
  if (!existing.ok) {
    throw new Error(existing.error.message);
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.value.workflowName,
    context,
  );
  const result = await runWorkflow(existing.value.workflowName, {
    ...workflowContext,
    resumeSessionId: input.workflowExecutionId,
    ...workflowRunOverrides.value,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    workflowExecutionId: result.value.session.sessionId,
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

async function rerunWorkflowExecutionMutation(
  input: RerunWorkflowExecutionInput,
  context: GraphqlRequestContext,
): Promise<RerunWorkflowExecutionPayload> {
  const rerunFromStepId = input.stepId.trim();
  if (rerunFromStepId.length === 0) {
    throw new Error("stepId is required");
  }
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const existing = await loadSession(input.workflowExecutionId, context);
  if (!existing.ok) {
    throw new Error(existing.error.message);
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.value.workflowName,
    context,
  );
  const result = await runWorkflow(existing.value.workflowName, {
    ...workflowContext,
    rerunFromSessionId: input.workflowExecutionId,
    rerunFromStepId,
    ...workflowRunOverrides.value,
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    workflowExecutionId: result.value.session.sessionId,
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    rerunFromStepId,
    exitCode: result.value.exitCode,
  };
}

async function workflowExecutionStepRunsQuery(
  input: WorkflowExecutionStepRunsQueryInput,
  context: GraphqlRequestContext,
): Promise<WorkflowExecutionStepRunsPayload> {
  const workflowExecutionId = input.workflowExecutionId.trim();
  if (workflowExecutionId.length === 0) {
    throw new Error("workflowExecutionId is required");
  }
  const stepTrimmed = input.stepId?.trim();
  const filterStepId =
    stepTrimmed === undefined || stepTrimmed.length === 0
      ? undefined
      : stepTrimmed;
  const filterStatus = parseWorkflowExecutionStepRunsStatusFilter(input.status);
  const listed = await listMergedWorkflowExecutionStepRuns({
    workflowExecutionId,
    ...(filterStepId === undefined ? {} : { filterStepId }),
    ...(filterStatus === undefined ? {} : { filterStatus }),
    ...context,
  });
  return {
    workflowExecutionId: listed.workflowExecutionId,
    workflowId: listed.workflowId,
    workflowName: listed.workflowName,
    stepRuns: listed.stepRuns.map((row) => ({
      workflowExecutionId: listed.workflowExecutionId,
      timelineOrdinal: row.timelineOrdinal,
      executionOrdinal: row.executionOrdinal,
      stepRunId: row.stepRunId,
      ...(row.stepId === undefined ? {} : { stepId: row.stepId }),
      ...(row.nodeRegistryId === undefined
        ? {}
        : { nodeRegistryId: row.nodeRegistryId }),
      status: row.status,
      imported: row.imported,
      sourceWorkflowExecutionId: row.persistedWorkflowExecutionId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    })),
  };
}

async function continueWorkflowExecutionMutation(
  input: ContinueWorkflowExecutionInput,
  context: GraphqlRequestContext,
): Promise<ContinueWorkflowExecutionPayload> {
  if (context.readOnly === true) {
    throw new Error("read-only mode enabled");
  }
  const sourceWorkflowExecutionId = input.sourceWorkflowExecutionId.trim();
  const startStepId = input.startStepId.trim();
  const afterStepRunId = input.afterStepRunId.trim();
  if (sourceWorkflowExecutionId.length === 0) {
    throw new Error("sourceWorkflowExecutionId is required");
  }
  if (startStepId.length === 0) {
    throw new Error("startStepId is required");
  }
  if (afterStepRunId.length === 0) {
    throw new Error("afterStepRunId is required");
  }
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const existing = await loadSession(sourceWorkflowExecutionId, context);
  if (!existing.ok) {
    throw new Error(existing.error.message);
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.value.workflowName,
    context,
  );
  const result = await continueWorkflowFromHistory({
    ...workflowContext,
    ...workflowRunOverrides.value,
    sourceWorkflowExecutionId,
    startStepId,
    afterStepRunId,
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
  });
  return {
    workflowExecutionId: result.sessionId,
    sessionId: result.sessionId,
    status: result.status,
    exitCode: result.exitCode,
    continuedAfterStepRunId: result.continuedAfterStepRunId,
    continuedStartStepId: result.continuedStartStepId,
  };
}

const SUPERVISOR_ACTION_SET_FOR_GRAPHQL = EVENT_SUPERVISOR_ACTION_SET;

function assertJsonObjectForSupervisor(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireNonEmptySupervisorString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireOptionalSupervisorString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireNonEmptySupervisorString(value, label);
}

function requireOptionalSupervisorBoolean(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean when set`);
  }
  return value;
}

function requireOptionalSupervisorInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer when set`);
  }
  return value as number;
}

function parseEventBindingFromGraphql(value: unknown): EventBinding {
  const o = assertJsonObjectForSupervisor(value, "binding");
  requireNonEmptySupervisorString(o["id"], "binding.id");
  requireNonEmptySupervisorString(o["sourceId"], "binding.sourceId");
  const inputMap = o["inputMapping"];
  if (
    typeof inputMap !== "object" ||
    inputMap === null ||
    Array.isArray(inputMap)
  ) {
    throw new Error("binding.inputMapping must be a JSON object");
  }
  const execution = o["execution"];
  if (
    execution !== undefined &&
    execution !== null &&
    (typeof execution !== "object" || Array.isArray(execution))
  ) {
    throw new Error("binding.execution must be a JSON object when set");
  }
  const mode =
    execution !== undefined &&
    execution !== null &&
    typeof execution === "object" &&
    !Array.isArray(execution) &&
    typeof (execution as { readonly mode?: unknown }).mode === "string"
      ? (execution as { readonly mode: string }).mode
      : undefined;
  const wfRaw = o["workflowName"];
  if (mode === "supervisor-dispatch") {
    if (
      wfRaw !== undefined &&
      wfRaw !== null &&
      (typeof wfRaw !== "string" || wfRaw.length === 0)
    ) {
      throw new Error(
        "binding.workflowName must be a non-empty string when provided for supervisor-dispatch bindings",
      );
    }
  } else {
    requireNonEmptySupervisorString(o["workflowName"], "binding.workflowName");
  }
  return o as unknown as EventBinding;
}

function parseOptionalSupervisorRuntimeVariables(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return assertJsonObjectForSupervisor(value, label);
}

function parseExternalEventEnvelopeFromGraphql(
  value: unknown,
): ExternalEventEnvelope {
  const o = assertJsonObjectForSupervisor(value, "event");
  const input = assertJsonObjectForSupervisor(o["input"], "event.input");
  const actorRaw = o["actor"];
  const conversationRaw = o["conversation"];
  const rawRefRaw = o["rawRef"];
  const occurredAt = requireOptionalSupervisorString(
    o["occurredAt"],
    "event.occurredAt",
  );

  return {
    sourceId: requireNonEmptySupervisorString(o["sourceId"], "event.sourceId"),
    eventId: requireNonEmptySupervisorString(o["eventId"], "event.eventId"),
    provider: requireNonEmptySupervisorString(o["provider"], "event.provider"),
    eventType: requireNonEmptySupervisorString(
      o["eventType"],
      "event.eventType",
    ),
    receivedAt: requireNonEmptySupervisorString(
      o["receivedAt"],
      "event.receivedAt",
    ),
    dedupeKey: requireNonEmptySupervisorString(
      o["dedupeKey"],
      "event.dedupeKey",
    ),
    input,
    ...(occurredAt !== undefined ? { occurredAt } : {}),
    ...(actorRaw !== undefined && actorRaw !== null
      ? { actor: actorRaw as ExternalEventEnvelope["actor"] }
      : {}),
    ...(conversationRaw !== undefined && conversationRaw !== null
      ? {
          conversation:
            conversationRaw as ExternalEventEnvelope["conversation"],
        }
      : {}),
    ...(rawRefRaw !== undefined && rawRefRaw !== null
      ? { rawRef: rawRefRaw as ExternalEventEnvelope["rawRef"] }
      : {}),
  } as ExternalEventEnvelope;
}

type ParsedSupervisedWorkflowLookup =
  | { readonly kind: "id"; readonly supervisedRunId: string }
  | {
      readonly kind: "correlation";
      readonly sourceId: string;
      readonly bindingId: string;
      readonly correlationKey: string;
    };

const supervisorRunnerPoolsByContext = new WeakMap<
  object,
  ReturnType<typeof createSupervisorRunnerPool>
>();

function getGraphqlSupervisorRunnerPool(
  context: GraphqlRequestContext,
): ReturnType<typeof createSupervisorRunnerPool> {
  const key = context as object;
  const existing = supervisorRunnerPoolsByContext.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const pool = createSupervisorRunnerPool({
    client: createWorkflowSupervisorClient(context),
  });
  supervisorRunnerPoolsByContext.set(key, pool);
  return pool;
}

function parseSupervisedWorkflowLookupGraphqlInput(
  input: SupervisedWorkflowLookupGraphqlInput,
): ParsedSupervisedWorkflowLookup {
  const runIdRaw = input.supervisedRunId;
  const runId =
    typeof runIdRaw === "string" && runIdRaw.trim().length > 0
      ? runIdRaw.trim()
      : undefined;
  if (runId !== undefined) {
    return { kind: "id", supervisedRunId: runId };
  }
  const sourceId = requireNonEmptySupervisorString(
    input.sourceId,
    "input.sourceId",
  );
  const bindingId = requireNonEmptySupervisorString(
    input.bindingId,
    "input.bindingId",
  );
  const correlationKey = requireNonEmptySupervisorString(
    input.correlationKey,
    "input.correlationKey",
  );
  return { kind: "correlation", sourceId, bindingId, correlationKey };
}

function parseEventSupervisorCommandFromGraphql(
  raw: EventSupervisorCommandInput,
): EventSupervisorCommand {
  if (
    !SUPERVISOR_ACTION_SET_FOR_GRAPHQL.has(raw.action as EventSupervisorAction)
  ) {
    throw new Error(`invalid supervisor action '${raw.action}'`);
  }
  const reason = requireOptionalSupervisorString(raw.reason, "command.reason");
  const runtimeVariables = parseOptionalSupervisorRuntimeVariables(
    raw.runtimeVariables,
    "command.runtimeVariables",
  );
  const rawArgs = (raw as { readonly args?: unknown }).args;
  const args =
    rawArgs === undefined || rawArgs === null
      ? undefined
      : Array.isArray(rawArgs) &&
          rawArgs.every((entry) => typeof entry === "string")
        ? (rawArgs as readonly string[])
        : undefined;
  if (rawArgs !== undefined && rawArgs !== null && args === undefined) {
    throw new Error("command.args must be a string array when set");
  }
  const supervisedRunIdRaw = (raw as { readonly supervisedRunId?: unknown })
    .supervisedRunId;
  const supervisedRunId =
    typeof supervisedRunIdRaw === "string" &&
    supervisedRunIdRaw.trim().length > 0
      ? supervisedRunIdRaw.trim()
      : undefined;
  return {
    commandId: requireNonEmptySupervisorString(
      raw.commandId,
      "command.commandId",
    ),
    sourceId: requireNonEmptySupervisorString(raw.sourceId, "command.sourceId"),
    bindingId: requireNonEmptySupervisorString(
      raw.bindingId,
      "command.bindingId",
    ),
    correlationKey: requireNonEmptySupervisorString(
      raw.correlationKey,
      "command.correlationKey",
    ),
    action: raw.action as EventSupervisorAction,
    ...(args === undefined || args.length === 0 ? {} : { args }),
    targetWorkflowName: requireNonEmptySupervisorString(
      raw.targetWorkflowName,
      "command.targetWorkflowName",
    ),
    ...(supervisedRunId === undefined ? {} : { supervisedRunId }),
    ...(raw.targetWorkflowExecutionId === undefined ||
    typeof raw.targetWorkflowExecutionId !== "string" ||
    raw.targetWorkflowExecutionId.length === 0
      ? {}
      : {
          targetWorkflowExecutionId: raw.targetWorkflowExecutionId,
        }),
    ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
    ...(reason === undefined ? {} : { reason }),
    receivedEventReceiptId: requireNonEmptySupervisorString(
      raw.receivedEventReceiptId,
      "command.receivedEventReceiptId",
    ),
  };
}

async function supervisedWorkflowRunQuery(
  input: SupervisedWorkflowLookupGraphqlInput,
  context: GraphqlRequestContext,
): Promise<SupervisedWorkflowGraphqlPayload> {
  const parsed = parseSupervisedWorkflowLookupGraphqlInput(input);
  const repo = createEventSupervisedRunRepository(context);
  let record: EventSupervisedRunRecord | null = null;
  if (parsed.kind === "id") {
    record = await repo.loadById(parsed.supervisedRunId);
  } else {
    await reconcileTerminalSupervisedRunForCorrelation(
      {
        sourceId: parsed.sourceId,
        bindingId: parsed.bindingId,
        correlationKey: parsed.correlationKey,
      },
      repo,
      context,
    );
    record = await repo.findLatestByCorrelation({
      sourceId: parsed.sourceId,
      bindingId: parsed.bindingId,
      correlationKey: parsed.correlationKey,
    });
  }
  if (record === null) {
    throw new Error("no supervised run matches the lookup");
  }
  record = await reconcileTerminalSupervisedRunRecord(record, repo, context);
  let activeTargetStatus: WorkflowSessionState["status"] | undefined;
  const targetId = record.activeTargetExecutionId;
  if (targetId !== undefined) {
    const loaded = await loadSession(targetId, context);
    if (loaded.ok) {
      activeTargetStatus = loaded.value.status;
    }
  }
  return {
    supervisedRun: record,
    ...(activeTargetStatus === undefined ? {} : { activeTargetStatus }),
  };
}

async function dispatchSupervisedWorkflowCommandMutation(
  input: DispatchSupervisedWorkflowCommandInput,
  context: GraphqlRequestContext,
): Promise<SupervisedWorkflowGraphqlPayload> {
  const binding = parseEventBindingFromGraphql(input.binding);
  if (binding.execution?.mode !== "supervised") {
    throw new Error(
      'dispatchSupervisedWorkflowCommand requires binding.execution.mode to be "supervised"',
    );
  }
  assertSupervisedBindingGraphqlPolicy(binding);
  const command = parseEventSupervisorCommandFromGraphql(input.command);
  const runtimeVariables =
    parseOptionalSupervisorRuntimeVariables(
      input.runtimeVariables,
      "runtimeVariables",
    ) ?? {};
  const dryRun = requireOptionalSupervisorBoolean(input.dryRun, "dryRun");
  const maxSteps = requireOptionalSupervisorInteger(input.maxSteps, "maxSteps");
  const maxLoopIterations = requireOptionalSupervisorInteger(
    input.maxLoopIterations,
    "maxLoopIterations",
  );
  const defaultTimeoutMs = requireOptionalSupervisorInteger(
    input.defaultTimeoutMs,
    "defaultTimeoutMs",
  );
  const maxConcurrency = requireOptionalSupervisorInteger(
    input.maxConcurrency,
    "maxConcurrency",
  );
  const engine =
    input.mockScenario === undefined &&
    dryRun === undefined &&
    maxSteps === undefined &&
    maxLoopIterations === undefined &&
    defaultTimeoutMs === undefined &&
    maxConcurrency === undefined
      ? undefined
      : {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(dryRun === undefined ? {} : { dryRun }),
          ...(maxSteps === undefined ? {} : { maxSteps }),
          ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
          ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
          ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
        };
  const view = await getGraphqlSupervisorRunnerPool(context).dispatch({
    command,
    binding,
    runtimeVariables,
    ...(engine === undefined ? {} : { engine }),
  });
  return {
    supervisedRun: view.supervisedRun,
    ...(view.activeTargetStatus === undefined
      ? {}
      : { activeTargetStatus: view.activeTargetStatus }),
    ...(view.commandResult === undefined
      ? {}
      : {
          commandResult: view.commandResult as unknown as Readonly<
            Record<string, unknown>
          >,
        }),
  };
}

async function supervisorDispatchConversationQuery(
  input: SupervisorDispatchConversationLookupGraphqlInput,
  context: GraphqlRequestContext,
): Promise<SupervisorDispatchConversationGraphqlPayload> {
  const id = requireNonEmptySupervisorString(
    input.supervisorConversationId,
    "input.supervisorConversationId",
  );
  const repo = createRuntimeSupervisorConversationRepository(context);
  const conversation = await repo.loadConversation(id);
  if (conversation === null) {
    throw new Error("no supervisor dispatch conversation matches the lookup");
  }
  const managedRuns = await repo.listManagedRuns(id);
  return { conversation, managedRuns };
}

async function dispatchSupervisorConversationMutation(
  input: DispatchSupervisorConversationGraphqlInput,
  context: GraphqlRequestContext,
): Promise<DispatchSupervisorConversationPayload> {
  const binding = parseEventBindingFromGraphql(input.binding);
  if (binding.execution?.mode !== "supervisor-dispatch") {
    throw new Error(
      'dispatchSupervisorConversation requires binding.execution.mode "supervisor-dispatch"',
    );
  }
  const supervisorProfileId = requireNonEmptySupervisorString(
    input.supervisorProfileId,
    "input.supervisorProfileId",
  );
  const correlationKey = requireNonEmptySupervisorString(
    input.correlationKey,
    "input.correlationKey",
  );
  const sourceMessageId = requireNonEmptySupervisorString(
    input.sourceMessageId,
    "input.sourceMessageId",
  );
  const event = parseExternalEventEnvelopeFromGraphql(input.event);
  const eventRoot = resolveEventRoot(context);
  const dryRun = requireOptionalSupervisorBoolean(input.dryRun, "dryRun");
  const maxSteps = requireOptionalSupervisorInteger(input.maxSteps, "maxSteps");
  const maxLoopIterations = requireOptionalSupervisorInteger(
    input.maxLoopIterations,
    "maxLoopIterations",
  );
  const defaultTimeoutMs = requireOptionalSupervisorInteger(
    input.defaultTimeoutMs,
    "defaultTimeoutMs",
  );
  const maxConcurrency = requireOptionalSupervisorInteger(
    input.maxConcurrency,
    "maxConcurrency",
  );
  const engine =
    input.mockScenario === undefined &&
    dryRun === undefined &&
    maxSteps === undefined &&
    maxLoopIterations === undefined &&
    defaultTimeoutMs === undefined &&
    maxConcurrency === undefined
      ? undefined
      : {
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
          ...(dryRun === undefined ? {} : { dryRun }),
          ...(maxSteps === undefined ? {} : { maxSteps }),
          ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
          ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
          ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
        };
  const client = createWorkflowSupervisorDispatchClient(context);
  const view = await client.dispatchExternalInput({
    ...context,
    eventRoot,
    binding,
    event,
    supervisorProfileId,
    correlationKey,
    sourceMessageId,
    ...(context.eventReplyDispatcher === undefined
      ? {}
      : { eventReplyDispatcher: context.eventReplyDispatcher }),
    ...(engine === undefined ? {} : engine),
  });
  return {
    conversation: view.conversation,
    managedRuns: view.managedRuns,
    decision: view.decision,
    proposal: view.proposal,
    applied: view.applied,
    ...(view.validationIssues === undefined ||
    view.validationIssues.length === 0
      ? {}
      : { validationIssues: view.validationIssues }),
  };
}

async function dispatchSupervisorChatMutation(
  input: DispatchSupervisorChatGraphqlInput,
  context: GraphqlRequestContext,
): Promise<DispatchSupervisorChatPayload> {
  if (
    typeof input.sourceId !== "string" ||
    input.sourceId.trim().length === 0
  ) {
    throw new Error("dispatchSupervisorChat requires sourceId");
  }
  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("dispatchSupervisorChat requires non-empty text");
  }
  const rows = await dispatchSupervisorChat({
    ...context,
    sourceId: input.sourceId,
    text: input.text,
    ...(input.conversationId === undefined
      ? {}
      : { conversationId: input.conversationId }),
    ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  });
  return {
    results: rows.map((row) => ({
      receiptId: row.receipt.receiptId,
      status: row.receipt.status,
      duplicate: row.duplicate,
      ...(row.receipt.bindingId === undefined
        ? {}
        : { bindingId: row.receipt.bindingId }),
      ...(row.receipt.workflowName === undefined
        ? {}
        : { workflowName: row.receipt.workflowName }),
      ...(row.receipt.workflowExecutionId === undefined
        ? {}
        : { workflowExecutionId: row.receipt.workflowExecutionId }),
      ...(row.receipt.supervisedRunId === undefined
        ? {}
        : { supervisedRunId: row.receipt.supervisedRunId }),
      ...(row.receipt.supervisorExecutionId === undefined &&
      row.supervisorExecutionId === undefined
        ? {}
        : {
            supervisorExecutionId:
              row.receipt.supervisorExecutionId ?? row.supervisorExecutionId,
          }),
      ...(row.receipt.error === undefined ? {} : { error: row.receipt.error }),
    })),
  };
}

async function cancelWorkflowExecutionMutation(
  input: CancelWorkflowExecutionInput,
  context: GraphqlRequestContext,
): Promise<CancelWorkflowExecutionPayload> {
  const loaded = await loadSession(input.workflowExecutionId, context);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }

  if (
    loaded.value.status === "completed" ||
    loaded.value.status === "failed" ||
    loaded.value.status === "cancelled"
  ) {
    return {
      accepted: false,
      workflowExecutionId: loaded.value.sessionId,
      sessionId: loaded.value.sessionId,
      status: loaded.value.status,
    };
  }

  const cancelled: WorkflowSessionState = {
    ...loaded.value,
    status: "cancelled",
    endedAt: nowIso(),
    lastError: "cancelled by GraphQL mutation",
  };
  const saved = await saveSession(cancelled, context);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
  return {
    accepted: true,
    workflowExecutionId: cancelled.sessionId,
    sessionId: cancelled.sessionId,
    status: cancelled.status,
  };
}

export function createGraphqlSchema(
  deps: GraphqlSchemaDependencies = {},
): GraphqlSchema {
  const managerLookupInput = (
    managerSessionId: string | undefined,
  ): ManagerSessionLookupInput =>
    managerSessionId === undefined ? {} : { managerSessionId };

  return {
    query: {
      async workflows(
        _input: Record<string, never> = {},
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowDefinitionsView> {
        return listWorkflowDefinitionNames(context);
      },

      async workflow(
        input: WorkflowLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowView | null> {
        const loaded = await loadWorkflowDefinitionForGraphql(
          input.workflowName,
          context,
        );
        if (loaded === null) {
          return null;
        }
        return buildInspectionSummary(
          loaded,
          optionsForLoadedWorkflow(loaded, context),
        );
      },

      async workflowDefinition(
        input: WorkflowDefinitionLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowDefinitionView | null> {
        return buildWorkflowDefinitionView(input.workflowName, context);
      },

      async workflowExecution(
        input: WorkflowExecutionLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowExecutionView | null> {
        return buildWorkflowExecutionView(input, context);
      },

      async workflowExecutionOverview(
        input: WorkflowExecutionOverviewLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowExecutionOverviewView | null> {
        return buildWorkflowExecutionOverviewView(input, context, deps);
      },

      async workflowExecutions(
        input: WorkflowExecutionsQueryInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowExecutionConnection> {
        return buildWorkflowExecutionConnection(input, context);
      },

      async workflowCatalogOverview(
        input: WorkflowCatalogOverviewGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowCatalogOverview> {
        return workflowCatalogOverviewQuery(input, context);
      },

      async workflowStatusOverview(
        input: WorkflowStatusOverviewGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowStatusOverview | null> {
        return workflowStatusOverviewQuery(input, context);
      },

      async communications(
        input: CommunicationsQueryInput,
        context: GraphqlRequestContext = {},
      ): Promise<CommunicationConnection> {
        return buildCommunicationConnection(input, context, deps);
      },

      async communication(
        input: CommunicationLookupInput,
        context: GraphqlRequestContext = {},
      ) {
        return resolveCommunicationService(context, deps).getCommunication(
          input,
          context,
        );
      },

      async nodeExecution(
        input: NodeExecutionLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<NodeExecutionView | null> {
        return buildNodeExecutionView(input, context);
      },

      async managerSession(
        input: ManagerSessionLookupInput,
        context: GraphqlRequestContext = {},
      ): Promise<ManagerSessionView | null> {
        const scope = await authenticateManagerScope(input, context, deps);
        const managerStore = resolveManagerStore(context, deps);
        const messages = await managerStore.listMessages(
          scope.session.managerSessionId,
        );
        return {
          session: scope.session,
          messages,
        };
      },

      async supervisedWorkflowRun(
        input: SupervisedWorkflowLookupGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<SupervisedWorkflowGraphqlPayload> {
        return supervisedWorkflowRunQuery(input, context);
      },

      async supervisorDispatchConversation(
        input: SupervisorDispatchConversationLookupGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<SupervisorDispatchConversationGraphqlPayload> {
        return supervisorDispatchConversationQuery(input, context);
      },

      async workflowExecutionStepRuns(
        input: WorkflowExecutionStepRunsQueryInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowExecutionStepRunsPayload> {
        return workflowExecutionStepRunsQuery(input, context);
      },
    },

    mutation: {
      async createWorkflowDefinition(
        input: CreateWorkflowDefinitionInput,
        context: GraphqlRequestContext = {},
      ): Promise<WorkflowDefinitionView> {
        return createWorkflowDefinitionMutation(input, context);
      },

      async saveWorkflowDefinition(
        input: SaveWorkflowDefinitionInput,
        context: GraphqlRequestContext = {},
      ): Promise<SaveWorkflowDefinitionPayload> {
        return saveWorkflowDefinitionMutation(input, context);
      },

      async validateWorkflowDefinition(
        input: ValidateWorkflowDefinitionInput,
        context: GraphqlRequestContext = {},
      ): Promise<ValidateWorkflowDefinitionPayload> {
        return validateWorkflowDefinitionMutation(input, context);
      },

      async executeWorkflow(
        input: ExecuteWorkflowInput,
        context: GraphqlRequestContext = {},
      ): Promise<ExecuteWorkflowPayload> {
        return executeWorkflowMutation(input, context);
      },

      async resumeWorkflowExecution(
        input: ResumeWorkflowExecutionInput,
        context: GraphqlRequestContext = {},
      ): Promise<ResumeWorkflowExecutionPayload> {
        return resumeWorkflowExecutionMutation(input, context);
      },

      async rerunWorkflowExecution(
        input: RerunWorkflowExecutionInput,
        context: GraphqlRequestContext = {},
      ): Promise<RerunWorkflowExecutionPayload> {
        return rerunWorkflowExecutionMutation(input, context);
      },

      async continueWorkflowExecution(
        input: ContinueWorkflowExecutionInput,
        context: GraphqlRequestContext = {},
      ): Promise<ContinueWorkflowExecutionPayload> {
        return continueWorkflowExecutionMutation(input, context);
      },

      async sendManagerMessage(
        input: SendManagerMessageInput,
        context: GraphqlRequestContext = {},
      ): Promise<SendManagerMessagePayload> {
        const scope = await authenticateManagerScope(
          managerLookupInput(input.managerSessionId),
          context,
          deps,
        );
        assertWorkflowExecutionScope(
          input.workflowId,
          input.workflowExecutionId,
          scope,
        );
        assertManagerIdentity(input, scope);

        const payloadInput: ServiceSendManagerMessageInput = {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          managerSessionId: scope.session.managerSessionId,
          ...(input.message === undefined ? {} : { message: input.message }),
          ...(input.actions === undefined ? {} : { actions: input.actions }),
          ...(input.attachments === undefined
            ? {}
            : { attachments: input.attachments }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        };
        const result = await resolveManagerMessageService(
          context,
          deps,
        ).sendManagerMessage(payloadInput, context);
        return {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          managerSessionId: scope.session.managerSessionId,
          ...result,
        };
      },

      async retryCommunicationDelivery(
        input: RetryCommunicationDeliveryInput,
        context: GraphqlRequestContext = {},
      ): Promise<RetryCommunicationDeliveryPayload> {
        const scope = await authenticateManagerScope(
          managerLookupInput(input.managerSessionId),
          context,
          deps,
        );
        assertWorkflowExecutionScope(
          input.workflowId,
          input.workflowExecutionId,
          scope,
        );
        await loadScopedCommunicationForManagerMutation(input, scope, context);

        const payloadInput: ServiceRetryCommunicationInput = {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          communicationId: input.communicationId,
          managerSessionId: scope.session.managerSessionId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        };
        return resolveCommunicationService(
          context,
          deps,
        ).retryCommunicationDelivery(payloadInput, context);
      },

      async replayCommunication(
        input: ReplayCommunicationInput,
        context: GraphqlRequestContext = {},
      ): Promise<ReplayCommunicationPayload> {
        const scope = await authenticateManagerScope(
          managerLookupInput(input.managerSessionId),
          context,
          deps,
        );
        assertWorkflowExecutionScope(
          input.workflowId,
          input.workflowExecutionId,
          scope,
        );
        await loadScopedCommunicationForManagerMutation(input, scope, context);

        const payloadInput: ServiceReplayCommunicationInput = {
          workflowId: input.workflowId,
          workflowExecutionId: input.workflowExecutionId,
          communicationId: input.communicationId,
          managerSessionId: scope.session.managerSessionId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: input.idempotencyKey }),
        };
        return resolveCommunicationService(context, deps).replayCommunication(
          payloadInput,
          context,
        );
      },

      async cancelWorkflowExecution(
        input: CancelWorkflowExecutionInput,
        context: GraphqlRequestContext = {},
      ): Promise<CancelWorkflowExecutionPayload> {
        return cancelWorkflowExecutionMutation(input, context);
      },

      async dispatchSupervisedWorkflowCommand(
        input: DispatchSupervisedWorkflowCommandInput,
        context: GraphqlRequestContext = {},
      ): Promise<SupervisedWorkflowGraphqlPayload> {
        return dispatchSupervisedWorkflowCommandMutation(input, context);
      },

      async dispatchSupervisorChat(
        input: DispatchSupervisorChatGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<DispatchSupervisorChatPayload> {
        return dispatchSupervisorChatMutation(input, context);
      },

      async dispatchSupervisorConversation(
        input: DispatchSupervisorConversationGraphqlInput,
        context: GraphqlRequestContext = {},
      ): Promise<DispatchSupervisorConversationPayload> {
        return dispatchSupervisorConversationMutation(input, context);
      },
    },
  };
}
