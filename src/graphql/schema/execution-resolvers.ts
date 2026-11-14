import { EVENT_SUPERVISOR_ACTION_SET } from "../../events/supervisor-command-contract";
import type { EventBinding } from "../../events/types";
import {
  continueWorkflowFromHistory,
  listMergedWorkflowExecutionStepRuns,
} from "../../lib";
import type { WorkflowExecutionSummary } from "../../shared/ui-contract";
import { runWorkflow } from "../../workflow/engine";
import { buildFanoutGroupSummaries } from "../../workflow/inspect";
import { loadWorkflowFromCatalog } from "../../workflow/load";
import { assertCommunicationInManagerScope } from "../../workflow/manager-control";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeLlmSessionMessages,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
} from "../../workflow/runtime-db";
import {
  createSessionId,
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type CommunicationRecord,
  type WorkflowSessionState,
} from "../../workflow/session";
import { listSessions, loadSession } from "../../workflow/session-store";
import type { WorkflowJson } from "../../workflow/types";
import type {
  CommunicationConnection,
  CommunicationsQueryInput,
  ContinueWorkflowExecutionInput,
  ContinueWorkflowExecutionPayload,
  ExecuteWorkflowInput,
  ExecuteWorkflowPayload,
  GraphqlManagerScope,
  GraphqlRequestContext,
  GraphqlSchemaDependencies,
  NodeExecutionLookupInput,
  NodeExecutionView,
  RerunWorkflowExecutionInput,
  RerunWorkflowExecutionPayload,
  ResumeWorkflowExecutionInput,
  ResumeWorkflowExecutionPayload,
  WorkflowExecutionConnection,
  WorkflowExecutionLookupInput,
  WorkflowExecutionOverviewLookupInput,
  WorkflowExecutionOverviewView,
  WorkflowExecutionStepRunsPayload,
  WorkflowExecutionStepRunsQueryInput,
  WorkflowExecutionView,
  WorkflowExecutionsQueryInput,
  WorkflowSessionView,
} from "../types";
import {
  buildGraphqlWorkflowRunOverrides,
  buildNodeExecutionViewFromState,
  loadWorkflowDefinitionForGraphql,
  parseWorkflowExecutionStepRunsStatusFilter,
  resolveCommunicationService,
  resolveWorkflowContextForGraphql,
  selectGraphqlLlmSessionMessages,
} from "./llm-run-overrides";

export async function buildNodeExecutionView(
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
export function toWorkflowExecutionSummary(
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
export interface CurrentStepWorkflowView {
  readonly workflowId: string;
  readonly steps?: WorkflowJson["steps"];
}
export async function resolveSessionCurrentStepId(input: {
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
export async function toWorkflowSessionView(
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
export async function buildWorkflowExecutionConnection(
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
export async function buildWorkflowExecutionView(
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
export async function buildWorkflowExecutionOverviewView(
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
export async function buildCommunicationConnection(
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
export async function loadScopedCommunicationForManagerMutation(
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
export async function executeWorkflowMutation(
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
export async function resumeWorkflowExecutionMutation(
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
export async function rerunWorkflowExecutionMutation(
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
export async function workflowExecutionStepRunsQuery(
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
export async function continueWorkflowExecutionMutation(
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
export const SUPERVISOR_ACTION_SET_FOR_GRAPHQL = EVENT_SUPERVISOR_ACTION_SET;
export function assertJsonObjectForSupervisor(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Readonly<Record<string, unknown>>;
}
export function requireNonEmptySupervisorString(
  value: unknown,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}
export function requireOptionalSupervisorString(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireNonEmptySupervisorString(value, label);
}
export function requireOptionalSupervisorBoolean(
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
export function requireOptionalSupervisorInteger(
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
export function parseEventBindingFromGraphql(value: unknown): EventBinding {
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
