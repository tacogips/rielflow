import { resolveEventRoot } from "../../events/config";
import { dispatchSupervisorChat } from "../../events/dispatch-supervisor-chat";
import { createRuntimeSupervisorConversationRepository } from "../../events/supervisor-conversations";
import type {
  EventSupervisorAction,
  EventSupervisorCommand,
  ExternalEventEnvelope,
} from "../../events/types";
import { assertSupervisedBindingGraphqlPolicy } from "../../events/validate";
import type { WorkflowSessionState } from "../../workflow/session";
import { loadSession, saveSession } from "../../workflow/session-store";
import { createWorkflowSupervisorClient } from "../../workflow/supervisor-client";
import { createWorkflowSupervisorDispatchClient } from "../../workflow/supervisor-dispatch-client";
import { createSupervisorRunnerPool } from "../../workflow/supervisor-runner-pool";
import type {
  CancelWorkflowExecutionInput,
  CancelWorkflowExecutionPayload,
  DispatchSupervisedWorkflowCommandInput,
  DispatchSupervisorChatGraphqlInput,
  DispatchSupervisorChatPayload,
  DispatchSupervisorConversationGraphqlInput,
  DispatchSupervisorConversationPayload,
  EventSupervisorCommandInput,
  GraphqlRequestContext,
  SupervisedWorkflowGraphqlPayload,
  SupervisedWorkflowLookupGraphqlInput,
  SupervisorDispatchConversationGraphqlPayload,
  SupervisorDispatchConversationLookupGraphqlInput,
} from "../types";
import { nowIso } from "./llm-run-overrides";
import {
  SUPERVISOR_ACTION_SET_FOR_GRAPHQL,
  assertJsonObjectForSupervisor,
  parseEventBindingFromGraphql,
  requireNonEmptySupervisorString,
  requireOptionalSupervisorBoolean,
  requireOptionalSupervisorInteger,
  requireOptionalSupervisorString,
} from "./execution-resolvers";

export function parseOptionalSupervisorRuntimeVariables(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return assertJsonObjectForSupervisor(value, label);
}
export function parseExternalEventEnvelopeFromGraphql(
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
export type ParsedSupervisedWorkflowLookup =
  | { readonly kind: "runner-pool"; readonly runnerPoolRunId: string }
  | { readonly kind: "id"; readonly supervisedRunId: string }
  | {
      readonly kind: "workflow-execution";
      readonly workflowExecutionId: string;
    }
  | { readonly kind: "workflow-key"; readonly workflowKey: string }
  | { readonly kind: "alias"; readonly alias: string }
  | {
      readonly kind: "correlation";
      readonly sourceId: string;
      readonly bindingId: string;
      readonly correlationKey: string;
    }
  | { readonly kind: "idempotency"; readonly idempotencyKey: string };
export const supervisorRunnerPoolsByRuntimeKey = new Map<
  string,
  ReturnType<typeof createSupervisorRunnerPool>
>();
export function graphqlSupervisorRunnerPoolKey(
  context: GraphqlRequestContext,
): string {
  return JSON.stringify({
    workflowRoot: context.workflowRoot ?? null,
    artifactRoot: context.artifactRoot ?? null,
    rootDataDir: context.rootDataDir ?? null,
    sessionStoreRoot: context.sessionStoreRoot ?? null,
    cwd: context.cwd ?? null,
    eventRoot: context.eventRoot ?? null,
    fixedWorkflowName: context.fixedWorkflowName ?? null,
    fixedResolvedWorkflowSource: context.fixedResolvedWorkflowSource ?? null,
  });
}
export function getGraphqlSupervisorRunnerPool(
  context: GraphqlRequestContext,
): ReturnType<typeof createSupervisorRunnerPool> {
  const key = graphqlSupervisorRunnerPoolKey(context);
  const existing = supervisorRunnerPoolsByRuntimeKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const pool = createSupervisorRunnerPool({
    client: createWorkflowSupervisorClient(context),
  });
  supervisorRunnerPoolsByRuntimeKey.set(key, pool);
  return pool;
}
export function parseSupervisedWorkflowLookupGraphqlInput(
  input: SupervisedWorkflowLookupGraphqlInput,
): ParsedSupervisedWorkflowLookup {
  const lookup = parseSupervisedWorkflowLookupForRunnerPool(input);
  if (lookup.runnerPoolRunId !== undefined) {
    return { kind: "runner-pool", runnerPoolRunId: lookup.runnerPoolRunId };
  }
  if (lookup.supervisedRunId !== undefined) {
    return { kind: "id", supervisedRunId: lookup.supervisedRunId };
  }
  if (lookup.workflowExecutionId !== undefined) {
    return {
      kind: "workflow-execution",
      workflowExecutionId: lookup.workflowExecutionId,
    };
  }
  if (lookup.workflowKey !== undefined) {
    return { kind: "workflow-key", workflowKey: lookup.workflowKey };
  }
  if (lookup.alias !== undefined) {
    return { kind: "alias", alias: lookup.alias };
  }
  if (
    lookup.sourceId !== undefined &&
    lookup.bindingId !== undefined &&
    lookup.correlationKey !== undefined
  ) {
    return {
      kind: "correlation",
      sourceId: lookup.sourceId,
      bindingId: lookup.bindingId,
      correlationKey: lookup.correlationKey,
    };
  }
  if (lookup.idempotencyKey !== undefined) {
    return { kind: "idempotency", idempotencyKey: lookup.idempotencyKey };
  }
  throw new Error(
    "supervised workflow lookup requires supervisedRunId or sourceId+bindingId+correlationKey",
  );
}
function parseSupervisedWorkflowLookupForRunnerPool(
  input: SupervisedWorkflowLookupGraphqlInput,
): SupervisedWorkflowLookupGraphqlInput {
  const runnerPoolRunId = requireOptionalSupervisorString(
    input.runnerPoolRunId,
    "input.runnerPoolRunId",
  );
  const runIdRaw = input.supervisedRunId;
  const supervisedRunId =
    typeof runIdRaw === "string" && runIdRaw.trim().length > 0
      ? runIdRaw.trim()
      : undefined;
  const workflowExecutionId = requireOptionalSupervisorString(
    input.workflowExecutionId,
    "input.workflowExecutionId",
  );
  const workflowKey = requireOptionalSupervisorString(
    input.workflowKey,
    "input.workflowKey",
  );
  const alias = requireOptionalSupervisorString(input.alias, "input.alias");
  const hasCorrelationLookup =
    input.sourceId !== undefined ||
    input.bindingId !== undefined ||
    input.correlationKey !== undefined;
  const hasLookupBeforeCorrelation =
    runnerPoolRunId !== undefined ||
    supervisedRunId !== undefined ||
    workflowExecutionId !== undefined ||
    workflowKey !== undefined ||
    alias !== undefined;
  let sourceId: string | undefined;
  let bindingId: string | undefined;
  let correlationKey: string | undefined;
  if (
    hasCorrelationLookup &&
    (input.sourceId === undefined ||
      input.bindingId === undefined ||
      input.correlationKey === undefined) &&
    !hasLookupBeforeCorrelation
  ) {
    sourceId = requireNonEmptySupervisorString(
      input.sourceId,
      "input.sourceId",
    );
    bindingId = requireNonEmptySupervisorString(
      input.bindingId,
      "input.bindingId",
    );
    correlationKey = requireNonEmptySupervisorString(
      input.correlationKey,
      "input.correlationKey",
    );
  }
  if (
    hasCorrelationLookup &&
    input.sourceId !== undefined &&
    input.bindingId !== undefined &&
    input.correlationKey !== undefined
  ) {
    sourceId = requireNonEmptySupervisorString(
      input.sourceId,
      "input.sourceId",
    );
    bindingId = requireNonEmptySupervisorString(
      input.bindingId,
      "input.bindingId",
    );
    correlationKey = requireNonEmptySupervisorString(
      input.correlationKey,
      "input.correlationKey",
    );
  }
  const idempotencyKey = requireOptionalSupervisorString(
    input.idempotencyKey,
    "input.idempotencyKey",
  );
  if (
    hasLookupBeforeCorrelation ||
    sourceId !== undefined ||
    idempotencyKey !== undefined
  ) {
    return {
      ...(runnerPoolRunId === undefined ? {} : { runnerPoolRunId }),
      ...(supervisedRunId === undefined ? {} : { supervisedRunId }),
      ...(workflowExecutionId === undefined ? {} : { workflowExecutionId }),
      ...(workflowKey === undefined ? {} : { workflowKey }),
      ...(alias === undefined ? {} : { alias }),
      ...(sourceId === undefined ? {} : { sourceId }),
      ...(bindingId === undefined ? {} : { bindingId }),
      ...(correlationKey === undefined ? {} : { correlationKey }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    };
  }
  sourceId = requireNonEmptySupervisorString(input.sourceId, "input.sourceId");
  bindingId = requireNonEmptySupervisorString(
    input.bindingId,
    "input.bindingId",
  );
  correlationKey = requireNonEmptySupervisorString(
    input.correlationKey,
    "input.correlationKey",
  );
  return { sourceId, bindingId, correlationKey };
}
export function parseEventSupervisorCommandFromGraphql(
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
export async function supervisedWorkflowRunQuery(
  input: SupervisedWorkflowLookupGraphqlInput,
  context: GraphqlRequestContext,
): Promise<SupervisedWorkflowGraphqlPayload> {
  const lookup = parseSupervisedWorkflowLookupForRunnerPool(input);
  const pool = getGraphqlSupervisorRunnerPool(context);
  const view = await pool.lookup(lookup);
  const handle = pool.lookupHandle(lookup);
  return {
    supervisedRun: view.supervisedRun,
    ...(handle === undefined
      ? {}
      : { runnerPoolRunId: handle.runnerPoolRunId }),
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
export async function dispatchSupervisedWorkflowCommandMutation(
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
  const pool = getGraphqlSupervisorRunnerPool(context);
  const view = await pool.dispatch({
    command,
    binding,
    runtimeVariables,
    ...(engine === undefined ? {} : { engine }),
  });
  const handle = pool.lookupHandle({
    supervisedRunId: view.supervisedRun.supervisedRunId,
  });
  return {
    supervisedRun: view.supervisedRun,
    ...(handle === undefined
      ? {}
      : { runnerPoolRunId: handle.runnerPoolRunId }),
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
export async function supervisorDispatchConversationQuery(
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
export async function dispatchSupervisorConversationMutation(
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
export async function dispatchSupervisorChatMutation(
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
export async function cancelWorkflowExecutionMutation(
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
