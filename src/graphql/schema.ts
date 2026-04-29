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
import { buildInspectionSummary } from "../workflow/inspect";
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
  type WorkflowSessionState,
} from "../workflow/session";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  type RuntimeNodeExecutionSummary,
  type RuntimeNodeLogEntry,
} from "../workflow/runtime-db";
import { loadSession, saveSession } from "../workflow/session-store";
import { listSessions } from "../workflow/session-store";
import type { WorkflowExecutionSummary } from "../shared/ui-contract";
import { err, ok, type Result } from "../workflow/result";
import { validateWorkflowBundleDetailedAsync } from "../workflow/validate";
import { deriveWorkflowVisualization } from "../workflow/visualization";
import { normalizeWorkflowWorkingDirectoryOverride } from "../workflow/working-directory";
import { parseWorkflowBundleInput } from "../workflow/workflow-bundle-input";
import type { WorkflowJson } from "../workflow/types";
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
  WorkflowLookupInput,
  WorkflowSessionView,
  WorkflowView,
  CommunicationsQueryInput,
  CancelWorkflowExecutionInput,
  CancelWorkflowExecutionPayload,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

interface GraphqlWorkflowRunOverridesInput {
  readonly autoImprove?: ExecuteWorkflowInput["autoImprove"];
  readonly nestedSuperviser?: boolean;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

function buildGraphqlWorkflowRunOverrides(
  input: GraphqlWorkflowRunOverridesInput,
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
  >,
  string
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  const normalizedAutoImprove =
    input.autoImprove === undefined
      ? { ok: true as const, value: undefined }
      : normalizeAutoImprovePolicy(input.autoImprove);
  if (!normalizedAutoImprove.ok) {
    return err(`invalid autoImprove policy: ${normalizedAutoImprove.error}`);
  }
  if (
    input.nestedSuperviser === true &&
    normalizedAutoImprove.value === undefined
  ) {
    return err("nestedSuperviser requires autoImprove");
  }
  return ok({
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(normalizedAutoImprove.value === undefined
      ? {}
      : { autoImprove: normalizedAutoImprove.value }),
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
  });
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
  recentLogLimit: number | undefined,
): Promise<NodeExecutionView> {
  const runtimeExecution = runtimeExecutions.find(
    (execution) =>
      execution.nodeId === sessionRecord.nodeId &&
      execution.nodeExecId === sessionRecord.nodeExecId,
  );
  const matchingLogs = runtimeLogs.filter(
    (entry) => entry.nodeExecId === sessionRecord.nodeExecId,
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

  return buildNodeExecutionViewFromState(
    session,
    sessionRecord,
    runtimeExecution === undefined ? [] : [runtimeExecution],
    runtimeLogs,
    input.recentLogLimit,
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
    currentStepId: await resolveSessionCurrentStepId({ session, context }),
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
  const [nodeExecutions, nodeLogs, hookEvents, replyDispatches] =
    await Promise.all([
      listRuntimeNodeExecutions(input.workflowExecutionId, context),
      listRuntimeNodeLogs(input.workflowExecutionId, context),
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
  const [runtimeExecutions, runtimeLogs, hookEvents, replyDispatches] =
    await Promise.all([
      listRuntimeNodeExecutions(input.workflowExecutionId, context),
      listRuntimeNodeLogs(input.workflowExecutionId, context),
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
        input.recentLogLimit,
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
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
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
    },
  };
}
