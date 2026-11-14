import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkflowControlPlaneService } from "divedra-graphql";
import type {
  SaveWorkflowResponse,
  ValidationResponse,
  WorkflowResponse,
} from "../../shared/ui-contract";
import { createWorkflowControlPlaneService } from "../control-plane-service";
import { collectWorkflowAddonSourceSummaries } from "../../workflow/addon-source-summary";
import { normalizeAutoImprovePolicy } from "../../workflow/auto-improve-policy";
import {
  listWorkflowCatalogSources,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "../../workflow/catalog";
import { createCommunicationService } from "../../workflow/communication-service";
import {
  createWorkflowTemplate,
  type CreateWorkflowTemplateMode,
} from "../../workflow/create";
import type { WorkflowRunOptions } from "../../workflow/engine";
import {
  loadWorkflowFromCatalog,
  type LoadedWorkflow,
} from "../../workflow/load";
import { createManagerMessageService } from "../../workflow/manager-message-service";
import {
  createManagerSessionStore,
  resolveAmbientManagerExecutionContext,
  type ManagerSessionStore,
} from "../../workflow/manager-session-store";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  type WorkflowCatalogOverview,
  type WorkflowStatusOverview,
} from "../../workflow/overview";
import { isSafeWorkflowName } from "../../workflow/paths";
import { err, ok, type Result } from "../../workflow/result";
import {
  collectPromptTemplateFiles,
  collectWorkflowRevisionNodeFiles,
  computeWorkflowRevisionFromFiles,
} from "../../workflow/revision";
import type {
  RuntimeLlmSessionMessageRecord,
  RuntimeNodeExecutionSummary,
  RuntimeNodeLogEntry,
} from "../../workflow/runtime-db";
import { saveWorkflowToDisk } from "../../workflow/save";
import type {
  NodeExecutionRecord,
  WorkflowSessionState,
} from "../../workflow/session";
import {
  hasInvalidNodeValidationResult,
  validateWorkflowBundleDetailedAsync,
} from "../../workflow/validate";
import { deriveWorkflowVisualization } from "../../workflow/visualization";
import { parseWorkflowBundleInput } from "../../workflow/workflow-bundle-input";
import { normalizeWorkflowWorkingDirectoryOverride } from "../../workflow/working-directory";
import type {
  CreateWorkflowDefinitionInput,
  ExecuteWorkflowInput,
  GraphqlManagerScope,
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
  LlmSessionMessageOrder,
  LlmSessionMessagesSelectionInput,
  ManagerSessionLookupInput,
  NodeExecutionView,
  SaveWorkflowDefinitionInput,
  SaveWorkflowDefinitionPayload,
  SendManagerMessageInput,
  ValidateWorkflowDefinitionInput,
  ValidateWorkflowDefinitionPayload,
  WorkflowCatalogOverviewGraphqlInput,
  WorkflowDefinitionView,
  WorkflowDefinitionsView,
  WorkflowStatusOverviewGraphqlInput,
} from "../types";

export function nowIso(): string {
  return new Date().toISOString();
}
export const DEFAULT_LLM_SESSION_MESSAGE_LIMIT = 1;
export const DEFAULT_LLM_SESSION_MESSAGE_ORDER: LlmSessionMessageOrder = "DESC";
export interface GraphqlLlmSessionMessagesArgs {
  readonly order?: LlmSessionMessageOrder | null;
  readonly limit?: number | null;
}
export function parseLlmSessionMessageOrder(
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
export function normalizeLlmSessionMessageLimit(
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
export function compareLlmSessionMessagesByAge(
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
export interface GraphqlWorkflowRunOverridesInput {
  readonly autoImprove?: ExecuteWorkflowInput["autoImprove"];
  readonly nestedSuperviser?: boolean;
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
}
export function buildGraphqlWorkflowRunOverrides(
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
export function parseWorkflowExecutionStepRunsStatusFilter(
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
export async function readOptionalText(
  filePath: string,
): Promise<string | null> {
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
export function resolveManagerStore(
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies,
): ManagerSessionStore {
  return deps.managerSessionStore ?? createManagerSessionStore(context);
}
export function resolveCommunicationService(
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
export function resolveManagerMessageService(
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
export function resolveWorkflowControlPlaneService(
  deps: GraphqlSchemaDependencies,
): WorkflowControlPlaneService<GraphqlRequestContext> {
  return (
    deps.workflowControlPlaneService ?? createWorkflowControlPlaneService()
  );
}
export function resolveScopedManagerSessionId(
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
export function resolveScopedAuthToken(
  context: GraphqlRequestContext,
): string | undefined {
  if (context.authToken !== undefined) {
    return context.authToken;
  }
  return resolveAmbientManagerExecutionContext(context.env)?.authToken;
}
export async function listWorkflowDefinitionNames(
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
export function assertWorkflowDefinitionAccess(
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
export function isOverviewWorkflowCatalogNotFound(error: {
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
export async function workflowCatalogOverviewQuery(
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
export function workflowStatusOverviewInputForFixedMode(
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
export async function workflowStatusOverviewQuery(
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
export function assertWorkflowDefinitionWritable(
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
export function optionsForLoadedWorkflow(
  loadedWorkflow: LoadedWorkflow,
  context: GraphqlRequestContext,
): GraphqlRequestContext {
  return loadedWorkflow.source === undefined
    ? context
    : withResolvedWorkflowSourceOptions(loadedWorkflow.source, context);
}
export async function loadWorkflowDefinitionForGraphql(
  workflowName: string,
  context: GraphqlRequestContext,
): Promise<LoadedWorkflow | null> {
  assertWorkflowDefinitionAccess(workflowName, context);
  const loaded = await loadWorkflowFromCatalog(workflowName, context);
  return loaded.ok ? loaded.value : null;
}
export async function resolveWorkflowContextForGraphql(
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
export async function buildWorkflowDefinitionView(
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
  const workflow = {
    ...loaded.bundle.workflow,
    hasManagerNode:
      loaded.bundle.workflow.hasManagerNode ??
      loaded.bundle.workflow.managerStepId !== undefined,
  };
  return {
    workflowName: loaded.workflowName,
    workflowDirectory: loaded.workflowDirectory,
    artifactWorkflowRoot: loaded.artifactWorkflowRoot,
    revision: revision.ok ? revision.value : null,
    bundle: { ...loaded.bundle, workflow },
    derivedVisualization: deriveWorkflowVisualization({
      workflow,
    }),
  } satisfies WorkflowResponse;
}
export async function createWorkflowDefinitionMutation(
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
export function normalizeCreateWorkflowTemplateMode(
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
export async function saveWorkflowDefinitionMutation(
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
export async function validateWorkflowDefinitionMutation(
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
      {
        ...context,
        executablePreflight: input.executablePreflight === true,
      },
    );
    if (!validation.ok) {
      return {
        valid: false,
        issues: validation.error,
      } satisfies ValidationResponse;
    }
    const executableInvalid =
      input.executablePreflight === true &&
      hasInvalidNodeValidationResult(validation.value.nodeValidationResults);
    const addonSources = await collectWorkflowAddonSourceSummaries({
      workflow: validation.value.bundle.workflow,
      options: context,
    });
    return {
      valid: !executableInvalid,
      workflowId: validation.value.bundle.workflow.workflowId,
      addonSources,
      nodeValidationResults: validation.value.nodeValidationResults,
      warnings: validation.value.issues.filter(
        (issue) => issue.severity === "warning",
      ),
      issues: validation.value.issues,
    } satisfies ValidationResponse;
  }

  assertWorkflowDefinitionAccess(input.workflowName, context);
  const validationContext = {
    ...context,
    executablePreflight: input.executablePreflight === true,
  };
  const loaded = await loadWorkflowFromCatalog(
    input.workflowName,
    validationContext,
  );
  if (!loaded.ok) {
    return {
      valid: false,
      error: loaded.error.message,
      issues: loaded.error.issues ?? [],
    } satisfies ValidationResponse;
  }
  const workflowContext = optionsForLoadedWorkflow(
    loaded.value,
    validationContext,
  );
  const nodeValidationResults = loaded.value.nodeValidationResults;
  const executableInvalid =
    input.executablePreflight === true &&
    hasInvalidNodeValidationResult(nodeValidationResults);
  return {
    valid: !executableInvalid,
    workflowId: loaded.value.bundle.workflow.workflowId,
    addonSources: await collectWorkflowAddonSourceSummaries({
      workflow: loaded.value.bundle.workflow,
      options: workflowContext,
      ...(loaded.value.source === undefined
        ? {}
        : { workflowSource: loaded.value.source }),
    }),
    nodeValidationResults,
    warnings: loaded.value.validationIssues.filter(
      (issue) => issue.severity === "warning",
    ),
    issues: loaded.value.validationIssues,
  } satisfies ValidationResponse;
}
export async function authenticateManagerScope(
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
export function assertWorkflowExecutionScope(
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
export function assertManagerIdentity(
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
export function findTerminalMessage(
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
export async function buildNodeExecutionViewFromState(
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
