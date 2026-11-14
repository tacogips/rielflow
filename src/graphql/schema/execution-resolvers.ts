import { EVENT_SUPERVISOR_ACTION_SET } from "../../events/supervisor-command-contract";
import type { EventBinding } from "../../events/types";
import type { WorkflowControlPlaneSession } from "divedra-graphql";
import type { WorkflowExecutionSummary } from "../../shared/ui-contract";
import { buildFanoutGroupSummaries } from "../../workflow/inspect";
import { loadWorkflowFromCatalog } from "../../workflow/load";
import { assertCommunicationInManagerScope } from "../../workflow/manager-control";
import {
  executeWorkflowSelfImprove,
  getWorkflowSelfImproveReport,
  listWorkflowSelfImproveReports,
} from "../../workflow/self-improve";
import {
  createSessionId,
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type CommunicationRecord,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "../../workflow/session";
import type { WorkflowJson } from "../../workflow/types";
import type {
  CommunicationConnection,
  CommunicationsQueryInput,
  ContinueWorkflowExecutionInput,
  ContinueWorkflowExecutionPayload,
  ExecuteWorkflowSelfImproveGraphqlInput,
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
  WorkflowSelfImproveReportConnection,
  WorkflowSelfImproveReportGraphqlInput,
  WorkflowSelfImproveReportsGraphqlInput,
  WorkflowSessionView,
} from "../types";
import { resolveWorkflowControlPlaneService } from "./llm-run-overrides";
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
  deps: GraphqlSchemaDependencies = {},
): Promise<NodeExecutionView | null> {
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const session = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (session === null || session.workflowId !== input.workflowId) {
    return null;
  }

  const sessionRecord = session.nodeExecutions.find(
    (execution) =>
      execution.nodeId === input.nodeId &&
      execution.nodeExecId === input.nodeExecId,
  );
  if (sessionRecord === undefined) {
    return null;
  }

  const runtimeExecutions = await controlPlane.listNodeExecutions(
    input.workflowExecutionId,
    context,
  );
  const runtimeExecution = runtimeExecutions.find(
    (execution) =>
      execution.nodeId === input.nodeId &&
      execution.nodeExecId === input.nodeExecId,
  );
  const runtimeLogs = await controlPlane.listNodeLogs(
    input.workflowExecutionId,
    context,
  );
  const runtimeLlmMessages = await controlPlane.listLlmSessionMessages(
    input.workflowExecutionId,
    context,
  );

  return buildNodeExecutionViewFromState(
    toWorkflowSessionState(session),
    toNodeExecutionRecord(sessionRecord),
    runtimeExecution === undefined ? [] : [runtimeExecution],
    runtimeLogs,
    runtimeLlmMessages,
    input.recentLogLimit,
    input.llmMessages,
  );
}

function toWorkflowSessionState(
  session: WorkflowControlPlaneSession,
): WorkflowSessionState {
  return session as unknown as WorkflowSessionState;
}

function toNodeExecutionRecord(
  record: WorkflowControlPlaneSession["nodeExecutions"][number],
): NodeExecutionRecord {
  return record as unknown as NodeExecutionRecord;
}

export function toWorkflowExecutionSummary(
  session: WorkflowControlPlaneSession,
  currentStepId: string | null = resolveCurrentStepId(
    toWorkflowSessionState(session),
  ),
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
  readonly session: WorkflowControlPlaneSession;
  readonly context: GraphqlRequestContext;
  readonly workflowCache?: Map<
    string,
    Promise<CurrentStepWorkflowView | undefined>
  >;
}): Promise<string | null> {
  const currentStepId = resolveCurrentStepId(
    toWorkflowSessionState(input.session),
  );
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
    toWorkflowSessionState(input.session),
    workflow.steps === undefined ? undefined : { steps: workflow.steps },
  );
}
export async function toWorkflowSessionView(
  session: WorkflowControlPlaneSession,
  context: GraphqlRequestContext,
): Promise<WorkflowSessionView> {
  return {
    ...session,
    fanoutGroups: session.fanoutGroups ?? [],
    currentStepId: await resolveSessionCurrentStepId({ session, context }),
    fanoutSummaries: buildFanoutGroupSummaries(toWorkflowSessionState(session)),
  };
}

export async function executeWorkflowSelfImproveMutation(
  input: ExecuteWorkflowSelfImproveGraphqlInput,
  context: GraphqlRequestContext,
) {
  if (context.readOnly === true) {
    throw new Error(
      "serve --read-only rejects workflow self-improve execution",
    );
  }
  if (context.noExec === true) {
    throw new Error("serve --no-exec rejects workflow self-improve execution");
  }
  return executeWorkflowSelfImprove({ ...context, ...input });
}

export async function workflowSelfImproveReportQuery(
  input: WorkflowSelfImproveReportGraphqlInput,
  context: GraphqlRequestContext,
) {
  try {
    return await getWorkflowSelfImproveReport({ ...context, ...input });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      return null;
    }
    throw error;
  }
}

export async function workflowSelfImproveReportsQuery(
  input: WorkflowSelfImproveReportsGraphqlInput,
  context: GraphqlRequestContext,
): Promise<WorkflowSelfImproveReportConnection> {
  const items = await listWorkflowSelfImproveReports({ ...context, ...input });
  return { items, totalCount: items.length };
}
export async function buildWorkflowExecutionConnection(
  input: WorkflowExecutionsQueryInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
): Promise<WorkflowExecutionConnection> {
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const listed = await controlPlane.listSessionIds(context);

  const workflowCache = new Map<
    string,
    Promise<CurrentStepWorkflowView | undefined>
  >();
  const loadedSessions = await Promise.all(
    listed.map(async (workflowExecutionId) => {
      const session = await controlPlane.loadSession(
        workflowExecutionId,
        context,
      );
      if (session === null) {
        return undefined;
      }
      const currentStepId = await resolveSessionCurrentStepId({
        session,
        context,
        workflowCache,
      });
      return toWorkflowExecutionSummary(session, currentStepId);
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
  deps: GraphqlSchemaDependencies = {},
): Promise<WorkflowExecutionView | null> {
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const session = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (session === null) {
    return null;
  }
  const [nodeExecutions, nodeLogs, llmMessages, hookEvents, replyDispatches] =
    await Promise.all([
      controlPlane.listNodeExecutions(input.workflowExecutionId, context),
      controlPlane.listNodeLogs(input.workflowExecutionId, context),
      controlPlane.listLlmSessionMessages(input.workflowExecutionId, context),
      controlPlane.listHookEvents(input.workflowExecutionId, context),
      controlPlane.listReplyDispatches(input.workflowExecutionId, context),
    ]);
  return {
    workflowExecutionId: input.workflowExecutionId,
    session: await toWorkflowSessionView(session, context),
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
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const session = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (session === null) {
    return null;
  }

  const [
    runtimeExecutions,
    runtimeLogs,
    runtimeLlmMessages,
    hookEvents,
    replyDispatches,
  ] = await Promise.all([
    controlPlane.listNodeExecutions(input.workflowExecutionId, context),
    controlPlane.listNodeLogs(input.workflowExecutionId, context),
    controlPlane.listLlmSessionMessages(input.workflowExecutionId, context),
    controlPlane.listHookEvents(input.workflowExecutionId, context),
    controlPlane.listReplyDispatches(input.workflowExecutionId, context),
  ]);
  const nodes = await Promise.all(
    session.nodeExecutions.map((execution) =>
      buildNodeExecutionViewFromState(
        toWorkflowSessionState(session),
        toNodeExecutionRecord(execution),
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
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const session = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (session === null || session.workflowId !== input.workflowId) {
    return { items: [], totalCount: 0 };
  }

  let records = session.communications.filter((communication) => {
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
  deps: GraphqlSchemaDependencies = {},
): Promise<CommunicationRecord> {
  const loaded = await resolveWorkflowControlPlaneService(deps).loadSession(
    input.workflowExecutionId,
    context,
  );
  if (loaded === null) {
    throw new Error(
      `workflow execution '${input.workflowExecutionId}' was not found`,
    );
  }
  if (loaded.workflowId !== input.workflowId) {
    throw new Error(
      `workflow execution '${input.workflowExecutionId}' does not belong to workflow '${input.workflowId}'`,
    );
  }
  const communication = loaded.communications.find(
    (entry) => entry.communicationId === input.communicationId,
  );
  if (communication === undefined) {
    throw new Error(
      `communication '${input.communicationId}' was not found in workflow execution '${input.workflowExecutionId}'`,
    );
  }
  const loadedWorkflow = await loadWorkflowDefinitionForGraphql(
    loaded.workflowName,
    context,
  );
  if (loadedWorkflow === null) {
    throw new Error(`workflow '${loaded.workflowName}' was not found`);
  }
  assertCommunicationInManagerScope(
    communication as unknown as CommunicationRecord,
    loadedWorkflow.bundle.workflow,
    {
      managerStepId: scope.session.managerStepId,
    },
    "GraphQL manager mutation",
  );
  return communication as unknown as CommunicationRecord;
}

function formatWorkflowLoadFailure(error: {
  readonly message: string;
  readonly issues?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}): string {
  const firstIssue = error.issues?.[0];
  if (firstIssue === undefined) {
    return error.message;
  }
  return `${error.message}: ${firstIssue.path}: ${firstIssue.message}`;
}

export async function executeWorkflowMutation(
  input: ExecuteWorkflowInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
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
    const loadedWorkflow = await loadWorkflowFromCatalog(input.workflowName, {
      ...workflowContext,
      ...workflowRunOverrides.value,
    });
    if (!loadedWorkflow.ok) {
      throw new Error(formatWorkflowLoadFailure(loadedWorkflow.error));
    }
    const workflowExecutionId = createSessionId({
      workflowId: loadedWorkflow.value.bundle.workflow.workflowId,
    });
    void resolveWorkflowControlPlaneService(deps)
      .runWorkflow({
        workflowName: input.workflowName,
        options: {
          ...workflowContext,
          sessionId: workflowExecutionId,
          ...workflowRunOverrides.value,
          ...(input.runtimeVariables === undefined
            ? {}
            : { runtimeVariables: input.runtimeVariables }),
          ...(input.mockScenario === undefined
            ? {}
            : { mockScenario: input.mockScenario }),
        },
      })
      .catch(() => undefined);
    return {
      workflowExecutionId,
      sessionId: workflowExecutionId,
      status: "running",
      accepted: true,
    };
  }

  const result = await resolveWorkflowControlPlaneService(deps).runWorkflow({
    workflowName: input.workflowName,
    options: {
      ...workflowContext,
      ...workflowRunOverrides.value,
      ...(input.runtimeVariables === undefined
        ? {}
        : { runtimeVariables: input.runtimeVariables }),
      ...(input.mockScenario === undefined
        ? {}
        : { mockScenario: input.mockScenario }),
    },
  });
  return {
    workflowExecutionId: result.workflowExecutionId,
    sessionId: result.sessionId,
    status: result.status,
    exitCode: result.exitCode,
  };
}
export async function resumeWorkflowExecutionMutation(
  input: ResumeWorkflowExecutionInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
): Promise<ResumeWorkflowExecutionPayload> {
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const existing = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (existing === null) {
    throw new Error(
      `workflow execution '${input.workflowExecutionId}' was not found`,
    );
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.workflowName,
    context,
  );
  const result = await controlPlane.runWorkflow({
    workflowName: existing.workflowName,
    options: {
      ...workflowContext,
      resumeSessionId: input.workflowExecutionId,
      ...workflowRunOverrides.value,
    },
  });
  return {
    workflowExecutionId: result.workflowExecutionId,
    sessionId: result.sessionId,
    status: result.status,
    exitCode: result.exitCode,
  };
}
export async function rerunWorkflowExecutionMutation(
  input: RerunWorkflowExecutionInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
): Promise<RerunWorkflowExecutionPayload> {
  const rerunFromStepId = input.stepId.trim();
  if (rerunFromStepId.length === 0) {
    throw new Error("stepId is required");
  }
  const workflowRunOverrides = buildGraphqlWorkflowRunOverrides(input);
  if (!workflowRunOverrides.ok) {
    throw new Error(workflowRunOverrides.error);
  }
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const existing = await controlPlane.loadSession(
    input.workflowExecutionId,
    context,
  );
  if (existing === null) {
    throw new Error(
      `workflow execution '${input.workflowExecutionId}' was not found`,
    );
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.workflowName,
    context,
  );
  const result = await controlPlane.runWorkflow({
    workflowName: existing.workflowName,
    options: {
      ...workflowContext,
      rerunFromSessionId: input.workflowExecutionId,
      rerunFromStepId,
      ...workflowRunOverrides.value,
      ...(input.runtimeVariables === undefined
        ? {}
        : { runtimeVariables: input.runtimeVariables }),
    },
  });
  return {
    workflowExecutionId: result.workflowExecutionId,
    sessionId: result.sessionId,
    status: result.status,
    rerunFromStepId,
    exitCode: result.exitCode,
  };
}
export async function workflowExecutionStepRunsQuery(
  input: WorkflowExecutionStepRunsQueryInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
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
  const listed = await resolveWorkflowControlPlaneService(
    deps,
  ).listWorkflowExecutionStepRuns({
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
      sourceWorkflowExecutionId: row.sourceWorkflowExecutionId,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
    })),
  };
}
export async function continueWorkflowExecutionMutation(
  input: ContinueWorkflowExecutionInput,
  context: GraphqlRequestContext,
  deps: GraphqlSchemaDependencies = {},
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
  const controlPlane = resolveWorkflowControlPlaneService(deps);
  const existing = await controlPlane.loadSession(
    sourceWorkflowExecutionId,
    context,
  );
  if (existing === null) {
    throw new Error(
      `workflow execution '${sourceWorkflowExecutionId}' was not found`,
    );
  }
  const workflowContext = await resolveWorkflowContextForGraphql(
    existing.workflowName,
    context,
  );
  const result = await controlPlane.continueWorkflowFromHistory({
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
    workflowExecutionId: result.workflowExecutionId,
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
