import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runWorkflow } from "./engine";
import {
  listWorkflowCatalogSources,
  withResolvedWorkflowSourceOptions,
} from "./catalog";
import { loadWorkflowFromCatalog } from "./load";
import { resolveRootDataDir } from "./paths";
import { loadSession, saveSession } from "./session-store";
import type { WorkflowSessionState } from "./session";
import {
  getNormalizedNodePayload,
  resolveWorkflowManagerStepId,
  type LoadOptions,
} from "./types";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "../events/types";
import {
  createRuntimeSupervisorConversationRepository,
  type ManagedWorkflowRunRecord,
  type SupervisorDispatchDecisionRecord,
  type WorkflowSupervisorConversationRecord,
  type WorkflowSupervisorConversationRepository,
} from "../events/supervisor-conversations";
import {
  loadSupervisorProfilesFromEventRoot,
  type ManagedWorkflowDefinition,
  type WorkflowSupervisorProfile,
} from "../events/supervisor-profiles";
import {
  parseSupervisorDispatchProposal,
  validateSupervisorDispatchProposalAgainstContext,
  type DispatchProposalValidationIssue,
  type ManagedWorkflowRunRecordLight,
  type SupervisorDispatchProposal,
  type SupervisorDispatchTarget,
} from "../events/supervisor-dispatch-contract";
import { runSupervisorDispatchLlmResolver } from "../events/supervisor-llm-resolver";
import type { WorkflowTriggerRunnerOptions } from "../events/workflow-trigger-runner-options";

const dispatchCorrelationQueues = new Map<string, Promise<unknown>>();

export function supervisorDispatchInProcessCorrelationQueueSize(): number {
  return dispatchCorrelationQueues.size;
}

async function withSupervisorDispatchCorrelationQueue<T>(
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

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalTargetStatus(
  status: WorkflowSessionState["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function isTerminalManagedRunStatus(
  status: ManagedWorkflowRunRecord["status"],
): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
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

async function cancelTargetSession(
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

async function persistStoppedManagedRun(
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

function toLightRuns(
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

function readDispatchLlmIntent(binding: EventBinding): {
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

function assertDispatchBinding(
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

function assertCorrelationMatchesBinding(
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

function mergeDispatchLoadOptions(
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

function mergeTriggerRunnerOptions(
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

function newSupervisorConversationId(): string {
  return `sc-${randomUUID()}`;
}

function newManagedRunId(): string {
  return `mr-${randomUUID()}`;
}

function newDispatchDecisionId(): string {
  return `sd-${randomUUID()}`;
}

function primaryTarget(
  proposal: SupervisorDispatchProposal,
): SupervisorDispatchTarget | undefined {
  const targets = proposal.targets;
  if (targets === undefined || targets.length === 0) {
    return undefined;
  }
  return targets[0];
}

function findRunForTarget(
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

function normalizeTerminalSubmitProposal(
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

async function resolveWorkflowOptionsForName(
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

function dispatchCorrelationKey(input: {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
}): string {
  return `${input.sourceId}:${input.bindingId}:${input.correlationKey}`;
}

type WorkflowEngineOverrides = Pick<
  WorkflowTriggerRunnerOptions,
  | "mockScenario"
  | "dryRun"
  | "maxSteps"
  | "maxLoopIterations"
  | "defaultTimeoutMs"
>;

function lookupManagedWorkflowDefinition(
  profile: WorkflowSupervisorProfile,
  key: string,
): ManagedWorkflowDefinition | undefined {
  return profile.managedWorkflows.find((m) => m.key === key);
}

async function buildView(
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

async function insertDecisionRow(
  repo: WorkflowSupervisorConversationRepository,
  row: SupervisorDispatchDecisionRecord,
): Promise<"inserted" | "duplicate"> {
  return repo.insertDispatchDecisionIfAbsent(row);
}

const DISPATCH_CLAIM_PROPOSAL_JSON =
  '{"action":"no-op","reason":"__dispatch_claim__","confidence":1}';

async function sleepMs(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForDispatchDecisionSettled(
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

async function finalizeDispatchDecisionFromProposed(
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

async function startManagedWorkflowRun(input: {
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

async function dispatchExternalInputLocked(input: {
  readonly baseOptions: LoadOptions;
  readonly resolverOptions: WorkflowTriggerRunnerOptions;
  readonly input: DispatchSupervisorConversationInput;
}): Promise<WorkflowSupervisorDispatchView> {
  const { baseOptions, resolverOptions, input: req } = input;
  const sourceId = req.binding.sourceId.trim();
  const bindingId = req.binding.id.trim();
  const correlationKey = req.correlationKey.trim();
  assertDispatchBinding(req.binding, req.supervisorProfileId);
  assertCorrelationMatchesBinding(req.binding, req.event, req.correlationKey);

  const catalog = await listWorkflowCatalogSources(baseOptions);
  if (!catalog.ok) {
    throw new Error(catalog.error.message);
  }
  const workflowNames = new Set(
    catalog.value.map((entry) => entry.workflowName),
  );
  const profileLoad = await loadSupervisorProfilesFromEventRoot(
    req.eventRoot,
    workflowNames,
  );
  const profile = profileLoad.profilesById.get(req.supervisorProfileId.trim());
  if (profile === undefined) {
    throw new Error(
      `unknown supervisor profile '${req.supervisorProfileId}' under eventRoot (expected supervisors/*.json)`,
    );
  }

  const repo = createRuntimeSupervisorConversationRepository(baseOptions);
  const rootDataDir = resolveRootDataDir(baseOptions);
  const now = nowIso();

  let conversation =
    (await repo.findConversationByCorrelation({
      sourceId,
      bindingId,
      correlationKey,
    })) ?? null;

  if (conversation === null) {
    const supervisorConversationId = newSupervisorConversationId();
    const artifactDir = path.join(
      rootDataDir,
      "supervisor-conversations",
      supervisorConversationId,
    );
    await mkdir(artifactDir, { recursive: true });
    const row: WorkflowSupervisorConversationRecord = {
      supervisorConversationId,
      supervisorProfileId: profile.supervisorProfileId,
      profileRevision: profile.profileRevision,
      supervisorWorkflowName: profile.supervisorWorkflowName,
      sourceId,
      bindingId,
      correlationKey,
      conversationRevision: 1,
      status: "active",
      artifactDir,
      createdAt: now,
      updatedAt: now,
    };
    const ins = await repo.insertConversation(row);
    if (ins === "duplicate") {
      conversation = await repo.findConversationByCorrelation({
        sourceId,
        bindingId,
        correlationKey,
      });
    } else {
      conversation = row;
    }
  }
  if (conversation === null) {
    throw new Error("failed to resolve supervisor conversation row");
  }
  if (conversation.profileRevision !== profile.profileRevision) {
    throw new Error(
      "supervisor profile revision changed since conversation was created; stop and recreate the conversation",
    );
  }

  const priorDecision = await repo.loadDispatchDecisionBySourceMessage({
    supervisorConversationId: conversation.supervisorConversationId,
    sourceMessageId: req.sourceMessageId,
  });
  if (priorDecision !== null) {
    const settled =
      priorDecision.status === "proposed"
        ? await waitForDispatchDecisionSettled(
            repo,
            conversation.supervisorConversationId,
            req.sourceMessageId,
          )
        : priorDecision;
    const parsed = parseSupervisorDispatchProposal(
      JSON.parse(settled.proposalJson) as unknown,
    );
    if (!parsed.ok) {
      throw new Error(
        `stored dispatch decision proposal is invalid: ${parsed.error}`,
      );
    }
    return buildView(
      repo,
      conversation.supervisorConversationId,
      settled,
      parsed.value,
      settled.status === "applied",
    );
  }

  let managedRuns = await repo.listManagedRuns(
    conversation.supervisorConversationId,
  );

  const decisionId = newDispatchDecisionId();
  const claimTs = nowIso();
  const claimInsert = await insertDecisionRow(repo, {
    decisionId,
    supervisorConversationId: conversation.supervisorConversationId,
    sourceMessageId: req.sourceMessageId,
    profileRevision: profile.profileRevision,
    conversationRevision: conversation.conversationRevision,
    status: "proposed",
    proposalJson: DISPATCH_CLAIM_PROPOSAL_JSON,
    createdAt: claimTs,
    updatedAt: claimTs,
  });
  if (claimInsert === "duplicate") {
    const concurrent = await waitForDispatchDecisionSettled(
      repo,
      conversation.supervisorConversationId,
      req.sourceMessageId,
    );
    const parsedConcurrent = parseSupervisorDispatchProposal(
      JSON.parse(concurrent.proposalJson) as unknown,
    );
    if (!parsedConcurrent.ok) {
      throw new Error(
        `stored dispatch decision proposal is invalid: ${parsedConcurrent.error}`,
      );
    }
    return buildView(
      repo,
      conversation.supervisorConversationId,
      concurrent,
      parsedConcurrent.value,
      concurrent.status === "applied",
    );
  }

  const revisionAtProposal = conversation.conversationRevision;

  try {
    const llmIntent = readDispatchLlmIntent(req.binding);
    const resolverResult = await runSupervisorDispatchLlmResolver({
      binding: req.binding,
      event: req.event,
      ...(req.source === undefined ? {} : { source: req.source }),
      resolverWorkflowName: llmIntent.resolverWorkflowName,
      resolverNodeId: llmIntent.resolverNodeId,
      ...(llmIntent.inputPath === undefined
        ? {}
        : { inputPath: llmIntent.inputPath }),
      profile,
      supervisorConversationId: conversation.supervisorConversationId,
      sourceMessageId: req.sourceMessageId,
      conversationRevision: conversation.conversationRevision,
      managedRuns: toLightRuns(managedRuns),
      options: resolverOptions,
    });

    if (!resolverResult.ok) {
      await finalizeDispatchDecisionFromProposed(repo, {
        decisionId,
        nextStatus: "rejected",
        proposal: {
          action: "clarify",
          reason: resolverResult.error,
          confidence: 1,
        },
        revisionAtProposal,
        profileRevision: profile.profileRevision,
        resultSummaryJson: JSON.stringify({ error: resolverResult.error }),
      });
      throw new Error(resolverResult.error);
    }

    let proposal = normalizeTerminalSubmitProposal(
      resolverResult.proposal,
      profile,
      conversation,
      managedRuns,
    );

    const validationIssues = validateSupervisorDispatchProposalAgainstContext(
      proposal,
      {
        supervisorConversationId: conversation.supervisorConversationId,
        profile,
        sourceMessageId: req.sourceMessageId,
        conversationRevision: conversation.conversationRevision,
        managedRuns: toLightRuns(managedRuns),
        ...(conversation.selectedManagedRunIdsByWorkflowKey === undefined
          ? {}
          : {
              selectedManagedRunIdsByWorkflowKey:
                conversation.selectedManagedRunIdsByWorkflowKey,
            }),
        ...(conversation.selectedManagedRunId === undefined
          ? {}
          : { selectedManagedRunId: conversation.selectedManagedRunId }),
      },
    );

    if (validationIssues.length > 0) {
      await finalizeDispatchDecisionFromProposed(repo, {
        decisionId,
        nextStatus: "rejected",
        proposal,
        revisionAtProposal,
        profileRevision: profile.profileRevision,
        resultSummaryJson: JSON.stringify({ issues: validationIssues }),
      });
      const rejectedRow = await repo.loadDispatchDecisionBySourceMessage({
        supervisorConversationId: conversation.supervisorConversationId,
        sourceMessageId: req.sourceMessageId,
      });
      if (rejectedRow === null) {
        throw new Error("dispatch decision row missing after rejection");
      }
      return buildView(
        repo,
        conversation.supervisorConversationId,
        rejectedRow,
        proposal,
        false,
        validationIssues,
      );
    }

    const applied = await applyDispatchProposal({
      repo,
      baseOptions,
      resolverOptions,
      profile,
      conversation,
      proposal,
      managedRuns,
    });
    conversation = applied.conversation;
    managedRuns = applied.managedRuns;
    proposal = applied.effectiveProposal;

    await finalizeDispatchDecisionFromProposed(repo, {
      decisionId,
      nextStatus: "applied",
      proposal,
      revisionAtProposal,
      profileRevision: profile.profileRevision,
    });
    const appliedRow = await repo.loadDispatchDecisionBySourceMessage({
      supervisorConversationId: conversation.supervisorConversationId,
      sourceMessageId: req.sourceMessageId,
    });
    if (appliedRow === null) {
      throw new Error("dispatch decision row missing after apply");
    }
    return buildView(
      repo,
      conversation.supervisorConversationId,
      appliedRow,
      proposal,
      true,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await finalizeDispatchDecisionFromProposed(repo, {
        decisionId,
        nextStatus: "rejected",
        proposal: {
          action: "clarify",
          reason: msg,
          confidence: 1,
        },
        revisionAtProposal,
        profileRevision: profile.profileRevision,
        resultSummaryJson: JSON.stringify({ error: msg }),
      });
    } catch {
      // Best-effort: claim row may already be finalized or DB unavailable.
    }
    throw err;
  }
}

async function applyDispatchProposal(input: {
  readonly repo: WorkflowSupervisorConversationRepository;
  readonly baseOptions: LoadOptions;
  readonly resolverOptions: WorkflowTriggerRunnerOptions;
  readonly profile: WorkflowSupervisorProfile;
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly proposal: SupervisorDispatchProposal;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
}): Promise<{
  readonly conversation: WorkflowSupervisorConversationRecord;
  readonly managedRuns: readonly ManagedWorkflowRunRecord[];
  readonly effectiveProposal: SupervisorDispatchProposal;
}> {
  const { repo, baseOptions, resolverOptions, profile } = input;
  let conversation = input.conversation;
  let managedRuns = [...input.managedRuns];
  let proposal = input.proposal;

  const bumpConversation = async (
    patch: Partial<WorkflowSupervisorConversationRecord>,
  ): Promise<void> => {
    const next: WorkflowSupervisorConversationRecord = {
      ...conversation,
      ...patch,
      conversationRevision: conversation.conversationRevision + 1,
      updatedAt: nowIso(),
    };
    const updated = await repo.updateConversationCas({
      expectedConversationRevision: conversation.conversationRevision,
      next,
    });
    if (updated === null) {
      throw new Error(
        "supervisor conversation changed concurrently; retry dispatch",
      );
    }
    conversation = updated;
    managedRuns = [
      ...(await repo.listManagedRuns(conversation.supervisorConversationId)),
    ];
  };

  const engineOverrides: WorkflowEngineOverrides = {
    ...(resolverOptions.mockScenario === undefined
      ? {}
      : { mockScenario: resolverOptions.mockScenario }),
    ...(resolverOptions.dryRun === undefined
      ? {}
      : { dryRun: resolverOptions.dryRun }),
    ...(resolverOptions.maxSteps === undefined
      ? {}
      : { maxSteps: resolverOptions.maxSteps }),
    ...(resolverOptions.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: resolverOptions.maxLoopIterations }),
    ...(resolverOptions.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: resolverOptions.defaultTimeoutMs }),
  };

  switch (proposal.action) {
    case "no-op":
    case "clarify":
    case "answer-directly":
    case "status": {
      await bumpConversation({});
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    case "switch-workflow": {
      const target = primaryTarget(proposal);
      if (target === undefined) {
        throw new Error("switch-workflow requires at least one target");
      }
      const def = lookupManagedWorkflowDefinition(
        profile,
        target.managedWorkflowKey,
      );
      if (def === undefined) {
        throw new Error(
          `unknown managed workflow key '${target.managedWorkflowKey}'`,
        );
      }

      const maybeStopPreviousSelectedRunForSwitch = async (
        nextPrimaryManagedRunId: string | undefined,
      ): Promise<void> => {
        const prevId = conversation.selectedManagedRunId;
        if (prevId === undefined) {
          return;
        }
        if (
          nextPrimaryManagedRunId !== undefined &&
          prevId === nextPrimaryManagedRunId
        ) {
          return;
        }
        const prevRun = managedRuns.find((r) => r.managedRunId === prevId);
        if (prevRun === undefined) {
          return;
        }
        const prevDef = lookupManagedWorkflowDefinition(
          profile,
          prevRun.managedWorkflowKey,
        );
        if (prevDef?.lifecycle?.stopOnSwitch !== true) {
          return;
        }
        await persistStoppedManagedRun(repo, prevRun, baseOptions);
        managedRuns = [
          ...(await repo.listManagedRuns(
            conversation.supervisorConversationId,
          )),
        ];
      };

      const applySwitchSelection = async (
        run: ManagedWorkflowRunRecord,
      ): Promise<{
        readonly conversation: WorkflowSupervisorConversationRecord;
        readonly managedRuns: readonly ManagedWorkflowRunRecord[];
        readonly effectiveProposal: SupervisorDispatchProposal;
      }> => {
        await maybeStopPreviousSelectedRunForSwitch(run.managedRunId);
        const nextSel: Record<string, string> = {
          ...(conversation.selectedManagedRunIdsByWorkflowKey ?? {}),
          [run.managedWorkflowKey]: run.managedRunId,
        };
        await bumpConversation({
          selectedManagedRunIdsByWorkflowKey: nextSel,
          selectedManagedRunId: run.managedRunId,
        });
        return { conversation, managedRuns, effectiveProposal: proposal };
      };

      const explicitRunId = target.managedRunId?.trim();
      if (explicitRunId !== undefined && explicitRunId.length > 0) {
        const run = managedRuns.find((r) => r.managedRunId === explicitRunId);
        if (run === undefined) {
          throw new Error("switch-workflow target run not found");
        }
        if (run.managedWorkflowKey !== target.managedWorkflowKey) {
          throw new Error("switch-workflow managedRunId key mismatch");
        }
        return await applySwitchSelection(run);
      }

      if (def.lifecycle?.startOnSwitch !== true) {
        throw new Error(
          "switch-workflow requires a target with managedRunId unless the managed workflow enables lifecycle.startOnSwitch",
        );
      }

      const key = def.key;
      const activeForSwitch = managedRuns.filter(
        (r) =>
          r.managedWorkflowKey === key &&
          (r.status === "running" || r.status === "starting"),
      );
      if (activeForSwitch.length > 1) {
        throw new Error(
          "switch-workflow without managedRunId is ambiguous when multiple active runs exist for the key",
        );
      }
      if (activeForSwitch.length === 1) {
        return await applySwitchSelection(activeForSwitch[0]!);
      }

      enforceConcurrencyForStart(def, managedRuns, target);
      const startedRun = await startManagedWorkflowRun({
        repo,
        conversation,
        def,
        target,
        baseOptions,
        engineOverrides,
      });
      const managedRunId = startedRun.managedRunId;
      managedRuns = [...startedRun.managedRuns];
      await maybeStopPreviousSelectedRunForSwitch(managedRunId);

      const nextSel: Record<string, string> = {
        ...(conversation.selectedManagedRunIdsByWorkflowKey ?? {}),
        [def.key]: managedRunId,
      };
      await bumpConversation({
        selectedManagedRunIdsByWorkflowKey: nextSel,
        selectedManagedRunId: managedRunId,
      });
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    case "stop-workflow": {
      const target = primaryTarget(proposal);
      const run = findRunForTarget(target, managedRuns, conversation);
      if (run === undefined) {
        throw new Error(
          "stop-workflow requires a resolvable managed run target",
        );
      }
      await persistStoppedManagedRun(repo, run, baseOptions);
      await bumpConversation({});
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    case "restart-workflow": {
      const target = primaryTarget(proposal);
      const run = findRunForTarget(target, managedRuns, conversation);
      if (run === undefined) {
        throw new Error(
          "restart-workflow requires a resolvable managed run target",
        );
      }
      const def = lookupManagedWorkflowDefinition(
        profile,
        run.managedWorkflowKey,
      );
      if (def === undefined) {
        throw new Error("unknown managed workflow key for restart");
      }
      if (run.activeTargetExecutionId !== undefined) {
        await cancelTargetSession(run.activeTargetExecutionId, baseOptions);
      }
      const wfOptions = await resolveWorkflowOptionsForName(
        def.workflowName,
        baseOptions,
      );
      const started = await runWorkflow(def.workflowName, {
        ...wfOptions,
        ...engineOverrides,
      });
      if (!started.ok) {
        throw new Error(started.error.message);
      }
      const restarted: ManagedWorkflowRunRecord = {
        ...run,
        status: "running",
        activeTargetExecutionId: started.value.session.sessionId,
        restartCount: run.restartCount + 1,
        updatedAt: nowIso(),
      };
      await repo.upsertManagedRun(restarted);
      await bumpConversation({});
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    case "start-workflow": {
      const target = primaryTarget(proposal);
      if (target === undefined) {
        throw new Error("start-workflow requires at least one target");
      }
      const def = lookupManagedWorkflowDefinition(
        profile,
        target.managedWorkflowKey,
      );
      if (def === undefined) {
        throw new Error(
          `unknown managed workflow key '${target.managedWorkflowKey}'`,
        );
      }
      enforceConcurrencyForStart(def, managedRuns, target);
      const startedRun = await startManagedWorkflowRun({
        repo,
        conversation,
        def,
        target,
        baseOptions,
        engineOverrides,
      });
      const managedRunId = startedRun.managedRunId;
      managedRuns = [...startedRun.managedRuns];

      const mode = def.concurrency?.mode ?? "multiple-active";
      const nextSel: Record<string, string> = {
        ...(conversation.selectedManagedRunIdsByWorkflowKey ?? {}),
        [def.key]: managedRunId,
      };
      await bumpConversation({
        ...(mode === "single-selected" || mode === "single-active"
          ? {
              selectedManagedRunIdsByWorkflowKey: nextSel,
              selectedManagedRunId: managedRunId,
            }
          : {}),
      });
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    case "submit-input": {
      const target = primaryTarget(proposal);
      const run = findRunForTarget(target, managedRuns, conversation);
      if (run === undefined) {
        throw new Error(
          "submit-input requires a resolvable managed run target",
        );
      }
      if (run.activeTargetExecutionId === undefined) {
        throw new Error(
          "submit-input requires a managed run with an active target session",
        );
      }
      const def = lookupManagedWorkflowDefinition(
        profile,
        run.managedWorkflowKey,
      );
      if (def === undefined) {
        throw new Error("unknown managed workflow key for submit-input");
      }
      const loadedWf = await loadWorkflowFromCatalog(
        run.targetWorkflowName,
        baseOptions,
      );
      if (!loadedWf.ok) {
        throw new Error(loadedWf.error.message);
      }
      const managerStepId = resolveWorkflowManagerStepId(
        loadedWf.value.bundle.workflow,
      );
      const managerNode = getNormalizedNodePayload(
        loadedWf.value.bundle,
        managerStepId,
      );
      const sessionId = run.activeTargetExecutionId;
      const existing = await loadSession(sessionId, baseOptions);
      if (!existing.ok) {
        throw new Error(existing.error.message);
      }
      const wfBase =
        loadedWf.value.source === undefined
          ? baseOptions
          : withResolvedWorkflowSourceOptions(
              loadedWf.value.source,
              baseOptions,
            );
      const runVars = target?.input ?? {};
      if (managerNode?.sessionPolicy?.mode === "reuse") {
        const { endedAt: _e, lastError: _l, ...resumable } = existing.value;
        const merged: WorkflowSessionState = {
          ...resumable,
          status: "running",
          queue: dedupeNodeIds([managerStepId, ...existing.value.queue]),
          currentNodeId: managerStepId,
          runtimeVariables: {
            ...existing.value.runtimeVariables,
            ...runVars,
          },
        };
        const saved = await saveSession(merged, baseOptions);
        if (!saved.ok) {
          throw new Error(saved.error.message);
        }
        const runAgain = await runWorkflow(run.targetWorkflowName, {
          ...wfBase,
          resumeSessionId: merged.sessionId,
          ...engineOverrides,
        });
        if (!runAgain.ok) {
          throw new Error(runAgain.error.message);
        }
        const nextRecord: ManagedWorkflowRunRecord = {
          ...run,
          activeTargetExecutionId: runAgain.value.session.sessionId,
          updatedAt: nowIso(),
        };
        await repo.upsertManagedRun(nextRecord);
      } else {
        const resumed = await runWorkflow(run.targetWorkflowName, {
          ...wfBase,
          resumeSessionId: sessionId,
          ...engineOverrides,
          ...(Object.keys(runVars).length === 0
            ? {}
            : { runtimeVariables: runVars }),
        });
        if (!resumed.ok) {
          throw new Error(resumed.error.message);
        }
        const nextRecord: ManagedWorkflowRunRecord = {
          ...run,
          activeTargetExecutionId: resumed.value.session.sessionId,
          updatedAt: nowIso(),
        };
        await repo.upsertManagedRun(nextRecord);
      }
      await bumpConversation({});
      return { conversation, managedRuns, effectiveProposal: proposal };
    }
    default: {
      throw new Error(
        `dispatch action '${proposal.action}' is not supported by the runtime client yet`,
      );
    }
  }
}

function enforceConcurrencyForStart(
  def: ManagedWorkflowDefinition,
  runs: readonly ManagedWorkflowRunRecord[],
  target: SupervisorDispatchTarget,
): void {
  const mode = def.concurrency?.mode ?? "multiple-active";
  if (mode === "multiple-active") {
    return;
  }
  const activeForKey = runs.filter(
    (r) =>
      r.managedWorkflowKey === def.key &&
      (r.status === "running" ||
        r.status === "starting" ||
        r.status === "stopping"),
  );
  if (mode === "single-active" && activeForKey.length > 0) {
    throw new Error(
      `managed workflow '${def.key}' is single-active and already has an active run`,
    );
  }
  if (mode === "single-selected" && activeForKey.length > 0) {
    throw new Error(
      `managed workflow '${def.key}' is single-selected and already has an active run`,
    );
  }
  if (def.concurrency?.requiresAliasForParallelRuns === true) {
    const alias = target.runAlias?.trim();
    if (alias === undefined || alias.length === 0) {
      const parallelPeers = runs.filter(
        (r) =>
          r.managedWorkflowKey === def.key &&
          r.runAlias !== undefined &&
          r.runAlias.trim().length > 0,
      );
      if (parallelPeers.length > 0) {
        throw new Error(
          `managed workflow '${def.key}' requires runAlias for parallel runs`,
        );
      }
    }
  }
}
