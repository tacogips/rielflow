import { runWorkflow, type WorkflowRunOptions } from "./workflow/engine";
import { callStep, type CallStepInput } from "./workflow/call-step";
import {
  executeGraphqlRequest,
  type GraphqlClientRequest,
  type GraphqlClientResponse,
  type GraphqlResponseError,
} from "./graphql/client";
import { createGraphqlSchema } from "./graphql/schema";
import type {
  GraphqlRequestContext,
  GraphqlSchema,
  GraphqlSchemaDependencies,
} from "./graphql/types";
import {
  buildInspectionSummary,
  getSupervisionSummary,
  type WorkflowInspectionSummary,
} from "./workflow/inspect";
import { loadWorkflowFromCatalog } from "./workflow/load";
import { withResolvedWorkflowSourceOptions } from "./workflow/catalog";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
} from "./workflow/runtime-db";
import {
  loadSession,
  listSessions as listStoredSessions,
  saveSession,
  type SessionStoreOptions,
} from "./workflow/session-store";
import {
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type WorkflowSessionState,
} from "./workflow/session";
import type { MockNodeScenario } from "./workflow/adapter";
import type { WorkflowExecutionSummary } from "./shared/ui-contract";
import type {
  AutoImprovePolicy,
  ChatReplyDispatcher,
  LoadOptions,
  WorkflowJson,
} from "./workflow/types";
import { normalizeWorkflowWorkingDirectoryOverride } from "./workflow/working-directory";

export type DivedraOptions = LoadOptions & SessionStoreOptions;

export interface ExecuteWorkflowInput extends DivedraOptions {
  readonly workflowName: string;
  readonly workflowWorkingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  /**
   * Supervised execution: on a new run (not resume/rerun from library), the engine
   * seeds {@link WorkflowSessionState.supervision} and runs the supervision loop
   * (retry on terminal target failure) until success or `maxSupervisedAttempts`.
   */
  readonly autoImprove?: AutoImprovePolicy;
  /**
   * Phase-2: run the configured superviser workflow as a nested session (requires
   * `autoImprove`; see engine `runWorkflow` option `nestedSuperviserDriver`).
   * CLI: prefer `--supervisor-workflow` / `--nested-supervisor` (aliases for legacy
   * `--superviser-workflow` / `--nested-superviser`).
   */
  readonly nestedSuperviserDriver?: boolean;
}

export interface ResumeWorkflowInput extends DivedraOptions {
  readonly sessionId: string;
  readonly workflowWorkingDirectory?: string;
  readonly mockScenario?: MockNodeScenario;
  /** Merges into persisted supervision policy when the session was started with `autoImprove`. */
  readonly autoImprove?: AutoImprovePolicy;
  /**
   * When the session was started with `nestedSuperviserDriver`, pass `true` to continue the
   * nested superviser workflow (requires the same `autoImprove` policy shape as the original run).
   */
  readonly nestedSuperviserDriver?: boolean;
}

export interface RerunWorkflowInput extends DivedraOptions {
  readonly sourceSessionId: string;
  /** Rerun target as an authored step id. */
  readonly fromStepId: string;
  readonly workflowWorkingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly autoImprove?: AutoImprovePolicy;
}

export interface RuntimeSessionView {
  readonly session: WorkflowSessionState & {
    readonly currentStepId: string | null;
  };
  readonly nodeExecutions: ReturnType<
    typeof listRuntimeNodeExecutions
  > extends Promise<infer T>
    ? T
    : never;
  readonly nodeLogs: ReturnType<typeof listRuntimeNodeLogs> extends Promise<
    infer T
  >
    ? T
    : never;
  readonly hookEvents?: ReturnType<
    typeof listRuntimeHookEvents
  > extends Promise<infer T>
    ? T
    : never;
  readonly replyDispatches?: ReturnType<
    typeof listEventReplyDispatchesFromRuntimeDb
  > extends Promise<infer T>
    ? T
    : never;
}

export interface CallWorkflowStepInput extends CallStepInput {}

interface CurrentStepWorkflowView {
  readonly workflowId: string;
  readonly steps?: WorkflowJson["steps"];
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

async function resolveSessionCurrentStepId(input: {
  readonly session: WorkflowSessionState;
  readonly options: DivedraOptions;
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
    pending = loadWorkflowFromCatalog(cacheKey, input.options).then((loaded) =>
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

export interface WorkflowExecutionClientOptions extends DivedraOptions {
  readonly workflowName: string;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly managerSessionId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
}

export interface WorkflowExecutionClientRequest {
  readonly input?: Readonly<Record<string, unknown>>;
  readonly workingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly async?: boolean;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface WorkflowExecutionClientResult {
  readonly workflowName: string;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly accepted?: boolean;
  readonly exitCode?: number;
}

export interface WorkflowExecutionClient {
  readonly workflowName: string;
  execute(
    request?: WorkflowExecutionClientRequest,
  ): Promise<WorkflowExecutionClientResult>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectField(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireStringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalBooleanField(
  value: unknown,
  label: string,
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function optionalNumberField(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function resolveRuntimeVariables(
  request: WorkflowExecutionClientRequest | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (request?.input !== undefined && request.runtimeVariables !== undefined) {
    throw new Error("use only one of input or runtimeVariables");
  }
  return request?.runtimeVariables ?? request?.input;
}

async function resolveWorkflowCatalogOptions<T extends DivedraOptions>(
  workflowName: string,
  options: T,
): Promise<T> {
  const loaded = await loadWorkflowFromCatalog(workflowName, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value.source === undefined
    ? options
    : withResolvedWorkflowSourceOptions(loaded.value.source, options);
}

async function executeWorkflowThroughGraphqlClient(
  options: WorkflowExecutionClientOptions,
  request: WorkflowExecutionClientRequest | undefined,
): Promise<WorkflowExecutionClientResult> {
  if (options.endpoint === undefined) {
    throw new Error("endpoint is required for GraphQL execution");
  }
  const runtimeVariables = resolveRuntimeVariables(request);
  const workingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    request?.workingDirectory,
  );
  const response = await executeGraphqlRequest({
    endpoint: options.endpoint,
    document: `
      mutation ExecuteWorkflow($input: ExecuteWorkflowInput!) {
        executeWorkflow(input: $input) {
          workflowExecutionId
          sessionId
          status
          accepted
          exitCode
        }
      }
    `,
    variables: {
      input: {
        workflowName: options.workflowName,
        ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
        ...(workingDirectory === undefined ? {} : { workingDirectory }),
        ...(request?.mockScenario === undefined
          ? {}
          : { mockScenario: request.mockScenario }),
        ...(request?.async === undefined ? {} : { async: request.async }),
        ...(request?.dryRun === undefined ? {} : { dryRun: request.dryRun }),
        ...(request?.maxSteps === undefined
          ? {}
          : { maxSteps: request.maxSteps }),
        ...(request?.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: request.maxLoopIterations }),
        ...(request?.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: request.defaultTimeoutMs }),
      },
    },
    ...(options.authToken === undefined
      ? {}
      : { authToken: options.authToken }),
    ...(options.managerSessionId === undefined
      ? {}
      : { managerSessionId: options.managerSessionId }),
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(response.errors.map((entry) => entry.message).join("; "));
  }

  const data = requireObjectField(response.data, "GraphQL response.data");
  const payload = requireObjectField(
    data["executeWorkflow"],
    "executeWorkflow",
  );
  const accepted = optionalBooleanField(
    payload["accepted"],
    "executeWorkflow.accepted",
  );
  const exitCode = optionalNumberField(
    payload["exitCode"],
    "executeWorkflow.exitCode",
  );
  return {
    workflowName: options.workflowName,
    workflowExecutionId: requireStringField(
      payload["workflowExecutionId"],
      "executeWorkflow.workflowExecutionId",
    ),
    sessionId: requireStringField(
      payload["sessionId"],
      "executeWorkflow.sessionId",
    ),
    status: requireStringField(payload["status"], "executeWorkflow.status"),
    ...(accepted === undefined ? {} : { accepted }),
    ...(exitCode === undefined ? {} : { exitCode }),
  };
}

async function executeWorkflowThroughLibraryClient(
  options: WorkflowExecutionClientOptions,
  request: WorkflowExecutionClientRequest | undefined,
): Promise<WorkflowExecutionClientResult> {
  const runtimeVariables = resolveRuntimeVariables(request);
  const workingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    request?.workingDirectory,
  );
  if (request?.async === true) {
    const schema = createGraphqlSchema();
    const executionOptions = await resolveWorkflowCatalogOptions(
      options.workflowName,
      options,
    );
    const payload = await schema.mutation.executeWorkflow(
      {
        workflowName: options.workflowName,
        ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
        ...(workingDirectory === undefined ? {} : { workingDirectory }),
        ...(request.mockScenario === undefined
          ? {}
          : { mockScenario: request.mockScenario }),
        async: true,
        ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
        ...(request.maxSteps === undefined
          ? {}
          : { maxSteps: request.maxSteps }),
        ...(request.maxLoopIterations === undefined
          ? {}
          : { maxLoopIterations: request.maxLoopIterations }),
        ...(request.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: request.defaultTimeoutMs }),
      },
      executionOptions,
    );
    return {
      workflowName: options.workflowName,
      workflowExecutionId: payload.workflowExecutionId,
      sessionId: payload.sessionId,
      status: payload.status,
      ...(payload.accepted === undefined ? {} : { accepted: payload.accepted }),
      ...(payload.exitCode === undefined ? {} : { exitCode: payload.exitCode }),
    };
  }

  const result = await executeWorkflow({
    ...options,
    workflowName: options.workflowName,
    ...(workingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory: workingDirectory }),
    ...(runtimeVariables === undefined ? {} : { runtimeVariables }),
    ...(request?.mockScenario === undefined
      ? {}
      : { mockScenario: request.mockScenario }),
    ...(request?.dryRun === undefined ? {} : { dryRun: request.dryRun }),
    ...(request?.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request?.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: request.maxLoopIterations }),
    ...(request?.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: request.defaultTimeoutMs }),
  });
  return {
    workflowName: options.workflowName,
    workflowExecutionId: result.sessionId,
    sessionId: result.sessionId,
    status: result.status,
    exitCode: result.exitCode,
  };
}

export function createWorkflowExecutionClient(
  options: WorkflowExecutionClientOptions,
): WorkflowExecutionClient {
  return {
    workflowName: options.workflowName,
    async execute(
      request: WorkflowExecutionClientRequest = {},
    ): Promise<WorkflowExecutionClientResult> {
      if (options.endpoint !== undefined) {
        return executeWorkflowThroughGraphqlClient(options, request);
      }
      return executeWorkflowThroughLibraryClient(options, request);
    },
  };
}

export async function inspectWorkflow(
  workflowName: string,
  options: DivedraOptions = {},
): Promise<WorkflowInspectionSummary> {
  const loaded = await loadWorkflowFromCatalog(workflowName, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const inspectionOptions =
    loaded.value.source === undefined
      ? options
      : withResolvedWorkflowSourceOptions(loaded.value.source, options);
  return await buildInspectionSummary(loaded.value, inspectionOptions);
}

export async function executeWorkflow(input: ExecuteWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workflowWorkingDirectory,
  );
  const options: WorkflowRunOptions = {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.workflowScope === undefined
      ? {}
      : { workflowScope: input.workflowScope }),
    ...(input.userRoot === undefined ? {} : { userRoot: input.userRoot }),
    ...(input.projectRoot === undefined
      ? {}
      : { projectRoot: input.projectRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined
      ? {}
      : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.nodeAddons === undefined ? {} : { nodeAddons: input.nodeAddons }),
    ...(input.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: input.asyncNodeAddonResolvers }),
    ...(input.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: input.nodeAddonResolvers }),
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.eventReplyDispatcher === undefined
      ? {}
      : { eventReplyDispatcher: input.eventReplyDispatcher }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.autoImprove === undefined
      ? {}
      : { autoImprove: input.autoImprove }),
    ...(input.nestedSuperviserDriver === true
      ? { nestedSuperviserDriver: true as const }
      : {}),
  };
  const executionOptions = await resolveWorkflowCatalogOptions(
    input.workflowName,
    options,
  );
  const result = await runWorkflow(input.workflowName, executionOptions);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

export async function resumeWorkflow(input: ResumeWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly exitCode: number;
}> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workflowWorkingDirectory,
  );
  const existing = await loadSession(input.sessionId, input);
  if (!existing.ok) {
    throw new Error(existing.error.message);
  }
  const result = await runWorkflow(existing.value.workflowName, {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined
      ? {}
      : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.nodeAddons === undefined ? {} : { nodeAddons: input.nodeAddons }),
    ...(input.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: input.asyncNodeAddonResolvers }),
    ...(input.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: input.nodeAddonResolvers }),
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.autoImprove === undefined
      ? {}
      : { autoImprove: input.autoImprove }),
    ...(input.nestedSuperviserDriver === true
      ? { nestedSuperviserDriver: true as const }
      : {}),
    resumeSessionId: existing.value.sessionId,
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    exitCode: result.value.exitCode,
  };
}

export async function rerunWorkflow(input: RerunWorkflowInput): Promise<{
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
  readonly rerunFromStepId: string;
  readonly exitCode: number;
}> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workflowWorkingDirectory,
  );
  const source = await loadSession(input.sourceSessionId, input);
  if (!source.ok) {
    throw new Error(source.error.message);
  }
  const result = await runWorkflow(source.value.workflowName, {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined
      ? {}
      : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.nodeAddons === undefined ? {} : { nodeAddons: input.nodeAddons }),
    ...(input.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: input.asyncNodeAddonResolvers }),
    ...(input.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: input.nodeAddonResolvers }),
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(input.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: input.runtimeVariables }),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    rerunFromSessionId: source.value.sessionId,
    rerunFromStepId: input.fromStepId,
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.autoImprove === undefined
      ? {}
      : { autoImprove: input.autoImprove }),
  });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    status: result.value.session.status,
    rerunFromStepId: input.fromStepId,
    exitCode: result.value.exitCode,
  };
}

export async function cancelWorkflowExecution(input: {
  readonly workflowExecutionId: string;
} & DivedraOptions): Promise<{
  readonly accepted: boolean;
  readonly workflowExecutionId: string;
  readonly sessionId: string;
  readonly status: WorkflowSessionState["status"];
}> {
  const loaded = await loadSession(input.workflowExecutionId, input);
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
    endedAt: new Date().toISOString(),
    lastError: "cancelled via cancelWorkflowExecution",
  };
  const saved = await saveSession(cancelled, input);
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

export async function getSession(
  sessionId: string,
  options: DivedraOptions = {},
): Promise<WorkflowSessionState> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

export async function listSessions(options: DivedraOptions = {}) {
  const listed = await listStoredSessions(options);
  if (!listed.ok) {
    throw new Error(listed.error.message);
  }

  const workflowCache = new Map<
    string,
    Promise<CurrentStepWorkflowView | undefined>
  >();
  const loadedSessions = await Promise.all(
    listed.value.map(async (sessionId) => {
      const loaded = await loadSession(sessionId, options);
      if (!loaded.ok) {
        return undefined;
      }
      const currentStepId = await resolveSessionCurrentStepId({
        session: loaded.value,
        options,
        workflowCache,
      });
      return toWorkflowExecutionSummary(loaded.value, currentStepId);
    }),
  );

  return loadedSessions
    .filter((entry): entry is WorkflowExecutionSummary => entry !== undefined)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function getRuntimeSessionView(
  sessionId: string,
  options: DivedraOptions = {},
): Promise<RuntimeSessionView> {
  const session = await getSession(sessionId, options);
  const currentStepId = await resolveSessionCurrentStepId({
    session,
    options,
  });
  const [nodeExecutions, nodeLogs, hookEvents, replyDispatches] =
    await Promise.all([
      listRuntimeNodeExecutions(sessionId, options),
      listRuntimeNodeLogs(sessionId, options),
      listRuntimeHookEvents(sessionId, options),
      listEventReplyDispatchesFromRuntimeDb(
        { workflowExecutionId: sessionId },
        options,
      ),
    ]);
  return {
    session: {
      ...session,
      currentStepId,
    },
    nodeExecutions,
    nodeLogs,
    hookEvents,
    replyDispatches,
  };
}

export async function callWorkflowStep(input: CallWorkflowStepInput): Promise<{
  readonly sessionId: string;
  readonly stepId: string;
  readonly nodeExecId: string;
  readonly status: "succeeded";
  readonly exitCode: number;
  readonly output: Readonly<Record<string, unknown>>;
}> {
  const result = await callStep(input);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return {
    sessionId: result.value.session.sessionId,
    stepId: result.value.stepId,
    nodeExecId: result.value.nodeExecution.nodeExecId,
    status: "succeeded",
    exitCode: result.value.exitCode,
    output: result.value.output,
  };
}

export { runCli } from "./cli";
export { startServe } from "./server/serve";
export { handleApiRequest } from "./server/api";
export { handleGraphqlRequest, executeGraphqlDocument } from "./server/graphql";
export { createGraphqlSchema, executeGraphqlRequest };
export {
  resolveRuntimeDbPath,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listRuntimeSessions,
} from "./workflow/runtime-db";
export {
  createCommunicationService,
  type CommunicationArtifactSnapshot,
  type CommunicationAttemptSnapshot,
  type CommunicationGraphqlView,
  type CommunicationLookupInput,
  type ReplayCommunicationInput,
  type ReplayCommunicationResult,
  type RetryCommunicationDeliveryInput,
  type RetryCommunicationDeliveryResult,
} from "./workflow/communication-service";
export {
  createManagerSessionStore,
  hashManagerAuthToken,
  verifyManagerAuthToken,
  resolveAmbientManagerExecutionContext,
  type AmbientManagerExecutionContext,
  type IdempotentMutationLookup,
  type IdempotentMutationRecord,
  type ManagerControlMode,
  type ManagerIntentSummary,
  type ManagerMessageRecord,
  type ManagerSessionRecord,
  type ManagerSessionStore,
} from "./workflow/manager-session-store";
export {
  createManagerMessageService,
  type DataDirFileRef,
  type ManagerMessageService,
  type SendManagerMessageInput,
  type SendManagerMessageResult,
} from "./workflow/manager-message-service";
export {
  parseManagerControlActions,
  parseManagerControlPayload,
  type ManagerControlAction,
  type ManagerControlActionType,
  type ParsedManagerControl,
} from "./workflow/manager-control";
export type {
  GraphqlClientRequest,
  GraphqlClientResponse,
  GraphqlResponseError,
  GraphqlRequestContext,
  GraphqlSchema,
  GraphqlSchemaDependencies,
};
export type {
  AsyncNodeAddonPayloadResolver,
  AutoImprovePolicy,
  LoadOptions,
  MutableWorkflowWorkspace,
  NodeAddonDefinition,
  NodeAddonDefinitionResolver,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  NodePayload,
  ResolvedWorkflowSource,
  SupervisionIncident,
  SupervisionRemediationAction,
  SupervisionRemediationRecord,
  SupervisionRunState,
  SupervisionRunStatus,
  SupervisionStallWatch,
  SupervisionSummary,
  ValidationIssue,
  WorkflowPatchRevisionInput,
  WorkflowPatchRevisionRecord,
  WorkflowNodeAddonRef,
  WorkflowScopeSelector,
  WorkflowSourceScope,
} from "./workflow/types";
export {
  createAsyncNodeAddonPayloadResolver,
  createAsyncNodeAddonRegistry,
  createNodeAddonPayloadResolver,
  createNodeAddonRegistry,
} from "./workflow/node-addons";
export {
  loadWorkflowFromCatalog,
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "./workflow/load";
export {
  listWorkflowCatalogSources,
  resolveWorkflowCreateSource,
  resolveWorkflowScopeSelector,
  resolveWorkflowSource,
} from "./workflow/catalog";
export { runWorkflow } from "./workflow/engine";
export {
  createWorkflowSupervisorGraphqlClient,
  type WorkflowSupervisorGraphqlClientOptions,
} from "./workflow/supervisor-graphql-client";
export {
  createWorkflowSupervisorClient,
  type SupervisedWorkflowView,
  type SupervisorEngineOverrides,
  type WorkflowSupervisorClient,
  type StartSupervisedWorkflowInput,
  type StopSupervisedWorkflowInput,
  type RestartSupervisedWorkflowInput,
  type SupervisedWorkflowLookup,
  type SubmitSupervisedWorkflowInput,
} from "./workflow/supervisor-client";
export {
  buildSupervisorChatConversation,
  dispatchSupervisorChat,
  type DispatchSupervisorChatInput,
} from "./events/dispatch-supervisor-chat";
/**
 * Direct single-step execution for step-addressed workflow bundles. Failures
 * are rewritten to step-oriented messages at this boundary. For a
 * throw-on-error wrapper, use {@link callWorkflowStep}.
 */
export { callStep } from "./workflow/call-step";
export type {
  CallStepFailure,
  CallStepInput,
  CallStepOverrides,
  CallStepSuccess,
} from "./workflow/call-step";
export { deriveWorkflowVisualization } from "./workflow/visualization";
export { getSupervisionSummary };
export {
  buildMutableWorkflowWorkspace,
  createExecutionCopyMutableWorkspace,
  readWorkflowPatchRevisionsFromArtifact,
  recordWorkflowPatchRevision,
  type MutableWorkspaceFailure,
} from "./workflow/mutable-workspace";
export {
  buildSupervisionStallWatch,
  getEngineSupervisionPatcherId,
  isSupervisionStallLastError,
  planSupervisionRemediation,
  resolveSupervisionRerunAnchor,
  resolveSupervisionRerunTarget,
  SUPERVISION_STALL_ERROR_PREFIX,
  type StartSupervisedRunInput,
  type SupervisionRemediationDecision,
  type SupervisionRemediationPlan,
} from "./workflow/superviser";
export type { SuperviserRuntimeControl } from "./workflow/superviser-control";
export type {
  WorkflowInspectionCounts,
  WorkflowInspectionSummary,
} from "./workflow/inspect";
