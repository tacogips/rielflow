import { callStep, type CallStepInput } from "./workflow/call-step";
import {
  buildFanoutGroupSummaries,
  type FanoutGroupSummary,
} from "./workflow/inspect";
import { loadWorkflowFromCatalog } from "./workflow/load";
import {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  listRuntimeLlmSessionMessages,
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
import type { WorkflowExecutionSummary } from "./shared/ui-contract";
import type { LoadOptions, WorkflowJson } from "./workflow/types";

export type DivedraSessionOptions = LoadOptions & SessionStoreOptions;

export interface RuntimeSessionView {
  readonly session: WorkflowSessionState & {
    readonly currentStepId: string | null;
    readonly fanoutSummaries: readonly FanoutGroupSummary[];
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
  readonly llmMessages: ReturnType<
    typeof listRuntimeLlmSessionMessages
  > extends Promise<infer T>
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
  readonly options: DivedraSessionOptions;
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

export async function cancelWorkflowExecution(
  input: {
    readonly workflowExecutionId: string;
  } & DivedraSessionOptions,
): Promise<{
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
  options: DivedraSessionOptions = {},
): Promise<WorkflowSessionState> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

export async function listSessions(options: DivedraSessionOptions = {}) {
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
  options: DivedraSessionOptions = {},
): Promise<RuntimeSessionView> {
  const session = await getSession(sessionId, options);
  const currentStepId = await resolveSessionCurrentStepId({
    session,
    options,
  });
  const [nodeExecutions, nodeLogs, llmMessages, hookEvents, replyDispatches] =
    await Promise.all([
      listRuntimeNodeExecutions(sessionId, options),
      listRuntimeNodeLogs(sessionId, options),
      listRuntimeLlmSessionMessages(sessionId, options),
      listRuntimeHookEvents(sessionId, options),
      listEventReplyDispatchesFromRuntimeDb(
        { workflowExecutionId: sessionId },
        options,
      ),
    ]);
  return {
    session: {
      ...session,
      fanoutGroups: session.fanoutGroups ?? [],
      currentStepId,
      fanoutSummaries: buildFanoutGroupSummaries(session),
    },
    nodeExecutions,
    nodeLogs,
    llmMessages,
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
