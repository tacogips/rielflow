import { randomUUID } from "node:crypto";
import type {
  ManagedWorkflowRunRecord,
  SupervisorDispatchDecisionRecord,
  WorkflowSupervisorConversationRecord,
  WorkflowSupervisorConversationRepository,
} from "../../events/supervisor-conversations";
import type {
  DispatchProposalValidationIssue,
  ManagedWorkflowRunRecordLight,
  SupervisorDispatchProposal,
  SupervisorDispatchTarget,
} from "../../events/supervisor-dispatch-contract";
import type {
  ManagedWorkflowDefinition,
  WorkflowSupervisorProfile,
} from "../../events/supervisor-profiles";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "../../events/types";
import type { WorkflowTriggerRunnerOptions } from "../../events/workflow-trigger-runner-options";
import { withResolvedWorkflowSourceOptions } from "../catalog";
import { runWorkflow } from "../engine";
import { loadWorkflowFromCatalog } from "../load";
import type { WorkflowSessionState } from "../session";
import { loadSession, saveSession } from "../session-store";
import type { LoadOptions } from "../types";
import { dispatchExternalInputLocked } from "./external-input-dispatch";

export const dispatchCorrelationQueues = new Map<string, Promise<unknown>>();
export function supervisorDispatchInProcessCorrelationQueueSize(): number {
  return dispatchCorrelationQueues.size;
}
export async function withSupervisorDispatchCorrelationQueue<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = dispatchCorrelationQueues.get(key) ?? Promise.resolve();
  const current = previous.then(() => work());
  const chainTail = current.then(
    () => undefined,
    () => undefined,
  );
  dispatchCorrelationQueues.set(key, chainTail);
  try {
    return await current;
  } finally {
    if (dispatchCorrelationQueues.get(key) === chainTail) {
      dispatchCorrelationQueues.delete(key);
    }
  }
}
export function nowIso(): string {
  return new Date().toISOString();
}
export function isTerminalTargetStatus(
  status: WorkflowSessionState["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
export function isTerminalManagedRunStatus(
  status: ManagedWorkflowRunRecord["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}
export function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of nodeIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
export async function cancelTargetSession(
  sessionId: string,
  options: LoadOptions,
): Promise<void> {
  const loaded = await loadSession(sessionId, options);
  if (!loaded.ok) {
    return;
  }
  if (isTerminalTargetStatus(loaded.value.status)) {
    return;
  }
  const cancelled: WorkflowSessionState = {
    ...loaded.value,
    status: "cancelled",
    endedAt: nowIso(),
    lastError: "cancelled by supervisor dispatch",
  };
  const saved = await saveSession(cancelled, options);
  if (!saved.ok) {
    throw new Error(saved.error.message);
  }
}
export async function persistStoppedManagedRun(
  repo: WorkflowSupervisorConversationRepository,
  run: ManagedWorkflowRunRecord,
  baseOptions: LoadOptions,
): Promise<void> {
  if (run.activeTargetExecutionId !== undefined) {
    await cancelTargetSession(run.activeTargetExecutionId, baseOptions);
  }
  const { activeTargetExecutionId: _omit, ...restRun } = run;
  const stopped: ManagedWorkflowRunRecord = {
    ...restRun,
    status: "stopped",
    updatedAt: nowIso(),
  };
  await repo.upsertManagedRun(stopped);
}
export function toLightRuns(
  runs: readonly ManagedWorkflowRunRecord[],
): ManagedWorkflowRunRecordLight[] {
  return runs.map((r) => ({
    managedRunId: r.managedRunId,
    supervisorConversationId: r.supervisorConversationId,
    managedWorkflowKey: r.managedWorkflowKey,
    ...(r.runAlias === undefined ? {} : { runAlias: r.runAlias }),
    status: r.status,
  }));
}
export function readDispatchLlmIntent(binding: EventBinding): {
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly inputPath?: string;
} {
  const intent = binding.execution?.control?.intentMapping;
  if (intent === undefined || intent.mode !== "llm-command") {
    throw new Error(
      'supervisor-dispatch requires execution.control.intentMapping with mode "llm-command"',
    );
  }
  const resolverWorkflowName = intent.resolverWorkflowName?.trim();
  const resolverNodeId = intent.resolverNodeId?.trim();
  if (
    resolverWorkflowName === undefined ||
    resolverWorkflowName.length === 0 ||
    resolverNodeId === undefined ||
    resolverNodeId.length === 0
  ) {
    throw new Error(
      "llm-command intent requires non-empty resolverWorkflowName and resolverNodeId",
    );
  }
  return {
    resolverWorkflowName,
    resolverNodeId,
    ...(intent.inputPath === undefined || intent.inputPath.length === 0
      ? {}
      : { inputPath: intent.inputPath }),
  };
}
export function assertDispatchBinding(
  binding: EventBinding,
  supervisorProfileId: string,
): void {
  if (binding.execution?.mode !== "supervisor-dispatch") {
    throw new Error(
      'dispatch client requires binding.execution.mode "supervisor-dispatch"',
    );
  }
  const pid = binding.execution.supervisorProfileId?.trim();
  if (pid !== supervisorProfileId.trim()) {
    throw new Error(
      "supervisorProfileId does not match binding.execution.supervisorProfileId",
    );
  }
}
export function assertCorrelationMatchesBinding(
  binding: EventBinding,
  event: ExternalEventEnvelope,
  correlationKey: string,
): void {
  if (binding.sourceId !== event.sourceId) {
    throw new Error("binding.sourceId does not match event.sourceId");
  }
  if (binding.id.trim().length === 0) {
    throw new Error("binding.id must be non-empty");
  }
  if (correlationKey.trim().length === 0) {
    throw new Error("correlationKey must be non-empty");
  }
}
export function mergeDispatchLoadOptions(
  base: LoadOptions,
  input: DispatchSupervisorConversationInput,
): LoadOptions {
  const {
    eventRoot: _e,
    binding: _b,
    source: _s,
    sourceMessageId: _sm,
    supervisorProfileId: _sp,
    event: _ev,
    correlationKey: _c,
    mockScenario,
    dryRun,
    maxSteps,
    maxLoopIterations,
    defaultTimeoutMs,
    endpoint: _ep,
    authToken: _at,
    fetchImpl: _fi,
    readOnly: _ro,
    eventReplyDispatcher: _erd,
    supervisorClient: _sc,
    ...rest
  } = input;
  return {
    ...base,
    ...rest,
    ...(mockScenario === undefined ? {} : { mockScenario }),
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(maxLoopIterations === undefined ? {} : { maxLoopIterations }),
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
  };
}
export function mergeTriggerRunnerOptions(
  mergedLoad: LoadOptions,
  input: DispatchSupervisorConversationInput,
): WorkflowTriggerRunnerOptions {
  return {
    ...mergedLoad,
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
    ...(input.authToken === undefined ? {} : { authToken: input.authToken }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    ...(input.readOnly === undefined ? {} : { readOnly: input.readOnly }),
    ...(input.eventReplyDispatcher === undefined
      ? {}
      : { eventReplyDispatcher: input.eventReplyDispatcher }),
    ...(input.supervisorClient === undefined
      ? {}
      : { supervisorClient: input.supervisorClient }),
  };
}
export function newSupervisorConversationId(): string {
  return `sc-${randomUUID()}`;
}
export function newManagedRunId(): string {
  return `mr-${randomUUID()}`;
}
export function newDispatchDecisionId(): string {
  return `sd-${randomUUID()}`;
}
export function primaryTarget(
  proposal: SupervisorDispatchProposal,
): SupervisorDispatchTarget | undefined {
  const targets = proposal.targets;
  if (targets === undefined || targets.length === 0) {
    return undefined;
  }
  return targets[0];
}
export function findRunForTarget(
  target: SupervisorDispatchTarget | undefined,
  runs: readonly ManagedWorkflowRunRecord[],
  conv: WorkflowSupervisorConversationRecord,
): ManagedWorkflowRunRecord | undefined {
  if (target === undefined) {
    return undefined;
  }
  if (target.managedRunId !== undefined) {
    return runs.find((r) => r.managedRunId === target.managedRunId);
  }
  const sameKey = runs.filter(
    (r) => r.managedWorkflowKey === target.managedWorkflowKey,
  );
  if (target.runAlias !== undefined) {
    return sameKey.find((r) => r.runAlias === target.runAlias);
  }
  const selected =
    conv.selectedManagedRunIdsByWorkflowKey?.[target.managedWorkflowKey];
  if (selected !== undefined) {
    return runs.find((r) => r.managedRunId === selected);
  }
  return sameKey.find((r) => r.status === "running" || r.status === "starting");
}
export function normalizeTerminalSubmitProposal(
  proposal: SupervisorDispatchProposal,
  profile: WorkflowSupervisorProfile,
  conv: WorkflowSupervisorConversationRecord,
  runs: readonly ManagedWorkflowRunRecord[],
): SupervisorDispatchProposal {
  if (proposal.action !== "submit-input") {
    return proposal;
  }
  const target = primaryTarget(proposal);
  const run = findRunForTarget(target, runs, conv);
  if (run === undefined || !isTerminalManagedRunStatus(run.status)) {
    return proposal;
  }
  const def = lookupManagedWorkflowDefinition(profile, run.managedWorkflowKey);
  const behavior = def?.lifecycle?.terminalInputBehavior ?? "clarify";
  if (behavior === "clarify") {
    return {
      action: "clarify",
      reason: `managed run '${run.managedRunId}' is terminal (${run.status}); refusing submit-input`,
      confidence: 1,
    };
  }
  if (behavior === "restart") {
    return {
      action: "restart-workflow",
      reason: `terminal managed run '${run.managedRunId}' (${run.status}); normalized restart`,
      confidence: proposal.confidence ?? 1,
      targets: [
        {
          managedWorkflowKey: run.managedWorkflowKey,
          managedRunId: run.managedRunId,
        },
      ],
    };
  }
  return {
    action: "start-workflow",
    reason: `terminal managed run '${run.managedRunId}' (${run.status}); normalized fork as new start`,
    confidence: proposal.confidence ?? 1,
    targets: [
      {
        managedWorkflowKey: run.managedWorkflowKey,
        ...(target?.input === undefined ? {} : { input: target.input }),
      },
    ],
  };
}
export async function resolveWorkflowOptionsForName(
  workflowName: string,
  loadOptions: LoadOptions,
): Promise<LoadOptions> {
  const loaded = await loadWorkflowFromCatalog(workflowName, loadOptions);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const src = loaded.value.source;
  return src === undefined
    ? loadOptions
    : withResolvedWorkflowSourceOptions(src, loadOptions);
}
export interface DispatchSupervisorConversationInput extends LoadOptions {
  readonly eventRoot: string;
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly supervisorProfileId: string;
  readonly sourceMessageId: string;
  readonly correlationKey: string;
  readonly mockScenario?: WorkflowTriggerRunnerOptions["mockScenario"];
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly readOnly?: boolean;
  readonly eventReplyDispatcher?: WorkflowTriggerRunnerOptions["eventReplyDispatcher"];
  readonly supervisorClient?: WorkflowTriggerRunnerOptions["supervisorClient"];
}
export interface WorkflowSupervisorDispatchView {
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
  readonly decision: SupervisorDispatchDecisionRecord;
  readonly proposal: SupervisorDispatchProposal;
  readonly applied: boolean;
  readonly validationIssues?: readonly DispatchProposalValidationIssue[];
}
export interface WorkflowSupervisorDispatchClient {
  dispatchExternalInput(
    input: DispatchSupervisorConversationInput,
  ): Promise<WorkflowSupervisorDispatchView>;
}
export interface StartManagedWorkflowInput {
  readonly supervisorConversationId: string;
  readonly managedWorkflowKey: string;
  readonly runAlias?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}
export interface SubmitManagedWorkflowInput {
  readonly supervisorConversationId: string;
  readonly managedRunId: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}
export interface StopManagedWorkflowInput {
  readonly supervisorConversationId: string;
  readonly managedRunId: string;
  readonly reason?: string;
}
export interface SupervisorRuntimeCapabilitySet {
  startManagedWorkflow(
    input: StartManagedWorkflowInput,
  ): Promise<ManagedWorkflowRunRecord>;
  submitManagedInput(
    input: SubmitManagedWorkflowInput,
  ): Promise<ManagedWorkflowRunRecord>;
  stopManagedWorkflow(
    input: StopManagedWorkflowInput,
  ): Promise<ManagedWorkflowRunRecord>;
}
export function dispatchCorrelationKey(input: {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
}): string {
  return `${input.sourceId}:${input.bindingId}:${input.correlationKey}`;
}
export type WorkflowEngineOverrides = Pick<
  WorkflowTriggerRunnerOptions,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
>;
export function lookupManagedWorkflowDefinition(
  profile: WorkflowSupervisorProfile,
  key: string,
): ManagedWorkflowDefinition | undefined {
  return profile.managedWorkflows.find((m) => m.key === key);
}
export async function buildView(
  repo: WorkflowSupervisorConversationRepository,
  convId: string,
  decision: SupervisorDispatchDecisionRecord,
  proposal: SupervisorDispatchProposal,
  applied: boolean,
  validationIssues?: readonly DispatchProposalValidationIssue[],
): Promise<WorkflowSupervisorDispatchView> {
  const conversation = await repo.loadConversation(convId);
  if (conversation === null) {
    throw new Error("conversation missing after dispatch");
  }
  const managedRuns = await repo.listManagedRuns(convId);
  return {
    conversation,
    managedRuns,
    decision,
    proposal,
    applied,
    ...(validationIssues === undefined || validationIssues.length === 0
      ? {}
      : { validationIssues }),
  };
}
export async function insertDecisionRow(
  repo: WorkflowSupervisorConversationRepository,
  row: SupervisorDispatchDecisionRecord,
): Promise<"inserted" | "duplicate"> {
  return repo.insertDispatchDecisionIfAbsent(row);
}
export const DISPATCH_CLAIM_PROPOSAL_JSON =
  '{"action":"no-op","reason":"__dispatch_claim__","confidence":1}';
export async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
export async function waitForDispatchDecisionSettled(
  repo: WorkflowSupervisorConversationRepository,
  supervisorConversationId: string,
  sourceMessageId: string,
): Promise<SupervisorDispatchDecisionRecord> {
  const maxWaitMs = 30_000;
  const pollMs = 25;
  for (let waited = 0; waited < maxWaitMs; waited += pollMs) {
    const row = await repo.loadDispatchDecisionBySourceMessage({
      supervisorConversationId,
      sourceMessageId,
    });
    if (row === null) {
      throw new Error("dispatch decision row missing during concurrent wait");
    }
    if (row.status !== "proposed") {
      return row;
    }
    await sleepMs(pollMs);
  }
  throw new Error(
    "supervisor dispatch timed out waiting for another worker to finish the same source message",
  );
}
export async function finalizeDispatchDecisionFromProposed(
  repo: WorkflowSupervisorConversationRepository,
  input: {
    readonly decisionId: string;
    readonly nextStatus: "applied" | "rejected";
    readonly proposal: SupervisorDispatchProposal;
    readonly revisionAtProposal: number;
    readonly profileRevision: string;
    readonly resultSummaryJson?: string | null;
  },
): Promise<void> {
  const updated = await repo.updateDispatchDecisionFromProposed({
    decisionId: input.decisionId,
    nextStatus: input.nextStatus,
    proposalJson: JSON.stringify(input.proposal),
    resultSummaryJson: input.resultSummaryJson ?? null,
    conversationRevision: input.revisionAtProposal,
    profileRevision: input.profileRevision,
    updatedAt: nowIso(),
  });
  if (!updated) {
    throw new Error(
      "failed to finalize supervisor dispatch decision (row missing or not in proposed state)",
    );
  }
}
export async function startManagedWorkflowRun(input: {
  readonly repo: WorkflowSupervisorConversationRepository;
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly def: ManagedWorkflowDefinition;
  readonly target: SupervisorDispatchTarget;
  readonly baseOptions: LoadOptions;
  readonly engineOverrides: WorkflowEngineOverrides;
}): Promise<{
  readonly managedRunId: string;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
}> {
  const managedRunId = newManagedRunId();
  const startedAt = nowIso();
  const starting: ManagedWorkflowRunRecord = {
    managedRunId,
    supervisorConversationId: input.conversation.supervisorConversationId,
    managedWorkflowKey: input.def.key,
    targetWorkflowName: input.def.workflowName,
    ...(input.target.runAlias === undefined
      ? {}
      : { runAlias: input.target.runAlias }),
    status: "starting",
    restartCount: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
  };
  await input.repo.upsertManagedRun(starting);

  const wfOptions = await resolveWorkflowOptionsForName(
    input.def.workflowName,
    input.baseOptions,
  );
  const started = await runWorkflow(input.def.workflowName, {
    ...wfOptions,
    ...input.engineOverrides,
    runtimeVariables: input.target.input ?? {},
  });
  if (!started.ok) {
    const failed: ManagedWorkflowRunRecord = {
      ...starting,
      status: "failed",
      updatedAt: nowIso(),
    };
    await input.repo.upsertManagedRun(failed);
    throw new Error(started.error.message);
  }

  const running: ManagedWorkflowRunRecord = {
    ...starting,
    status: "running",
    activeTargetExecutionId: started.value.session.sessionId,
    updatedAt: nowIso(),
  };
  await input.repo.upsertManagedRun(running);

  return {
    managedRunId,
    managedRuns: await input.repo.listManagedRuns(
      input.conversation.supervisorConversationId,
    ),
  };
}
export function createWorkflowSupervisorDispatchClient(
  baseOptions: LoadOptions = {},
): WorkflowSupervisorDispatchClient {
  return {
    async dispatchExternalInput(
      input: DispatchSupervisorConversationInput,
    ): Promise<WorkflowSupervisorDispatchView> {
      const mergedLoad = mergeDispatchLoadOptions(baseOptions, input);
      const resolverOptions = mergeTriggerRunnerOptions(mergedLoad, input);
      const sourceId = input.binding.sourceId.trim();
      const bindingId = input.binding.id.trim();
      const correlationKey = input.correlationKey.trim();
      const key = dispatchCorrelationKey({
        sourceId,
        bindingId,
        correlationKey,
      });
      return withSupervisorDispatchCorrelationQueue(key, async () =>
        dispatchExternalInputLocked({
          baseOptions: mergedLoad,
          resolverOptions,
          input,
        }),
      );
    },
  };
}
