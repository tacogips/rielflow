import { mkdir, readFile, rm } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../shared/fs";
import {
  buildAdapterDivedraHookContext,
  ScenarioNodeAdapter,
  type AdapterAmbientManagerContext,
  type AdapterExecutionOutput,
  type AdapterProcessLog,
  type MockNodeScenario,
  type NodeAdapter,
} from "./adapter";
import {
  DEFAULT_SUPERVISER_WORKFLOW_ID,
  normalizeAutoImprovePolicy,
  resolveSuperviserWorkflowId,
} from "./auto-improve-policy";
import {
  executeAdapterWithTimeout,
  executeNativeNodeWithTimeout,
} from "./adapter-execution";
import { DispatchingNodeAdapter } from "./adapters/dispatch";
import { assembleNodeInput } from "./input-assembly";
import { normalizeExternalMailboxBusinessPayload } from "./json-boundary";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "./json-schema";
import {
  loadWorkflowByIdFromDisk,
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
  type LoadedWorkflow,
} from "./load";
import {
  createExecutionCopyMutableWorkspace,
  recordWorkflowPatchRevision,
} from "./mutable-workspace";
import { resolveEffectiveRoots } from "./paths";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "./node-execution-mailbox";
import {
  crossWorkflowDispatchesForExecutionMatch,
  type CrossWorkflowExecutionDispatch,
} from "./cross-workflow-from-steps";
import { composeExecutionPrompts } from "./prompt-composition";
import {
  parseManagerControlPayload,
  type ParsedManagerControl,
} from "./manager-control";
import { describeWorkflowNodeKind, isManagerNodeRef } from "./node-role";
import { err, ok, type Result } from "./result";
import {
  saveCommunicationEventToRuntimeDb,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
} from "./runtime-db";
import {
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveStepExecutionAddress,
  toStepIdentityFields,
} from "./runtime-addressing";
import { inspectWorkflowRuntimeReadiness } from "./runtime-readiness";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
} from "./manager-session-store";
import {
  evaluateBranch,
  evaluateCompletion,
  resolveLoopTransition,
} from "./semantics";
import {
  buildOutputRefForExecution,
  createSessionId,
  createSessionState,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
  type CommunicationRecord,
  type NodeExecutionRecord,
  type OutputRef,
  type PendingOptionalNodeDecision,
  type WorkflowSessionState,
} from "./session";
import {
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "./session-store";
import {
  buildSupervisionStallWatch,
  getEngineSupervisionPatcherId,
  isSupervisionStallLastError,
  planSupervisionRemediation,
  toStepAddressedWorkflowForSupervision,
} from "./superviser";
import {
  buildSuperviserRuntimeControl,
  workflowRunBaseForSuperviserControl,
} from "./superviser-runtime-control-impl";
import type { SuperviserRuntimeControl } from "./superviser-control";
import {
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
} from "./working-directory";
import type {
  AgentNodePayload,
  AutoImprovePolicy,
  ChatReplyDispatcher,
  JsonObject,
  LoadOptions,
  LoopRule,
  NodePayload,
  SupervisionIncident,
  SupervisionRemediationRecord,
  SupervisionRunState,
  WorkflowEdge,
  WorkflowJson,
  WorkflowTimeoutPolicy,
} from "./types";
import {
  asAgentNodePayload,
  getStructuralEdges,
  getStructuralLoops,
  resolveWorkflowManagerRuntimeId,
} from "./types";

export interface WorkflowRunOptions extends LoadOptions, SessionStoreOptions {
  readonly sessionId?: string;
  readonly workflowWorkingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  /**
   * Phase-2 nested superviser: passed to native add-on execution so
   * `divedra/*` superviser control nodes can operate on the paired target session.
   */
  readonly superviserControl?: SuperviserRuntimeControl;
  readonly mockScenario?: MockNodeScenario;
  /** When set on a new run (not resume), seeds {@link WorkflowSessionState.supervision} and, unless {@link supervisionLoopExecution} is set, runs the supervision retry loop. */
  readonly autoImprove?: AutoImprovePolicy;
  /**
   * When true, execute the workflow directly without wrapping in the auto-improve outer retry loop
   * (the loop uses this for inner attempts and for resume/rerun entry points).
   * @internal
   */
  readonly supervisionLoopExecution?: boolean;
  /**
   * Phase-2: after seeding a supervised target session, run `superviserWorkflowId` as a nested
   * step-addressed workflow with {@link superviserControl} instead of the engine-only
   * `runAutoImproveLoop`. Ignored for resume and rerun entry points.
   */
  readonly nestedSuperviserDriver?: boolean;
  readonly resumeSessionId?: string;
  readonly rerunFromSessionId?: string;
  /**
   * Rerun entry id: step id (and, for legacy node-registry-only bundles without `steps[]`,
   * the same value may be a node id that identifies the node registry entry to restart from).
   * Required with {@link rerunFromSessionId} for rerun entry.
   */
  readonly rerunFromStepId?: string;
  readonly restartOnStuck?: boolean;
  readonly maxStuckRestarts?: number;
  readonly stuckRestartBackoffMs?: number;
}

export interface WorkflowRunResult {
  readonly session: WorkflowSessionState;
  readonly exitCode: number;
}

export interface WorkflowRunFailure {
  readonly exitCode: number;
  readonly message: string;
  /**
   * Populated when a persisted session exists at the point of failure (e.g. terminal failure
   * after save) so the auto-improve supervision loop can load state for remediation.
   */
  readonly sessionId?: string;
}

function workflowRunFailure(
  code: number,
  message: string,
  session?: Pick<WorkflowSessionState, "sessionId">,
): WorkflowRunFailure {
  return {
    exitCode: code,
    message,
    ...(session === undefined ? {} : { sessionId: session.sessionId }),
  };
}

export interface CancellationProbe {
  isCancelled(sessionId: string): Promise<boolean>;
}

export interface EngineExecutionGuards {
  readonly cancellationProbe: CancellationProbe;
}

function mergeVariables(
  nodeVariables: Readonly<Record<string, unknown>>,
  runtimeVariables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { ...nodeVariables, ...runtimeVariables };
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function addMillisecondsToIso(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

interface UpstreamOutputRef extends OutputRef {
  readonly fromNodeId: string;
  readonly transitionWhen: string;
  readonly status:
    | NodeExecutionRecord["status"]
    | CommunicationRecord["status"];
  readonly communicationId: string;
}

interface UpstreamInput extends UpstreamOutputRef {
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw: string;
}

interface OutputArtifact {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly raw: string;
}

function nextNodeExecId(counter: number): string {
  return `exec-${String(counter).padStart(6, "0")}`;
}

function nextManagerSessionId(nodeExecId: string): string {
  return `mgrsess-${nodeExecId}`;
}

function nextCommunicationId(counter: number): string {
  return `comm-${String(counter).padStart(6, "0")}`;
}

function initialDeliveryAttemptId(): string {
  return "attempt-000001";
}

function resolveTimeoutMs(input: {
  readonly node: NodePayload;
  readonly stepTimeoutMs?: number;
  readonly workflowTimeoutMs: number;
}): {
  readonly timeoutMs: number;
  readonly source: "step" | "node" | "workflow-default";
} {
  if (input.stepTimeoutMs !== undefined) {
    return {
      timeoutMs: input.stepTimeoutMs,
      source: "step",
    };
  }
  if (input.node.timeoutMs !== undefined) {
    return {
      timeoutMs: input.node.timeoutMs,
      source: "node",
    };
  }
  return {
    timeoutMs: input.workflowTimeoutMs,
    source: "workflow-default",
  };
}

function resolveTimeoutRestartBudget(
  timeoutPolicy: WorkflowTimeoutPolicy | undefined,
  options: WorkflowRunOptions,
  restartAttempt: number,
): { readonly allowRestart: boolean; readonly maxRestarts: number } {
  if (options.restartOnStuck === false) {
    return { allowRestart: false, maxRestarts: 0 };
  }
  const optRestart = options.restartOnStuck ?? true;
  const optMax = options.maxStuckRestarts ?? 2;
  if (timeoutPolicy === undefined) {
    return { allowRestart: optRestart, maxRestarts: optMax };
  }
  switch (timeoutPolicy.onTimeout) {
    case "fail":
      return { allowRestart: false, maxRestarts: 0 };
    case "retry-same-step":
      return {
        allowRestart: true,
        maxRestarts: timeoutPolicy.maxRetries ?? optMax,
      };
    case "jump-to-step": {
      const retriesBeforeJump = timeoutPolicy.maxRetries ?? 0;
      return {
        allowRestart: restartAttempt < retriesBeforeJump,
        maxRestarts: retriesBeforeJump,
      };
    }
    default:
      return { allowRestart: optRestart, maxRestarts: optMax };
  }
}

function evaluateEdge(
  edge: WorkflowEdge,
  output: Readonly<Record<string, unknown>>,
): boolean {
  return evaluateBranch({ when: edge.when, output });
}

async function persistTerminalSessionState(
  session: WorkflowSessionState,
  options: SessionStoreOptions,
  contextMessage: string,
): Promise<Result<void, string>> {
  const saved = await saveSession(session, options);
  if (!saved.ok) {
    return err(
      `${contextMessage}; additionally failed to persist terminal session state: ${saved.error.message}`,
    );
  }
  return ok(undefined);
}

async function persistCompletedSessionState(
  session: WorkflowSessionState,
  options: SessionStoreOptions,
): Promise<Result<void, string>> {
  const saved = await saveSession(session, options);
  if (!saved.ok) {
    return err(
      `failed to persist completed workflow session state: ${saved.error.message}`,
    );
  }
  return ok(undefined);
}

async function failTerminalSession(
  session: WorkflowSessionState,
  options: SessionStoreOptions,
  message: string,
): Promise<Result<never, WorkflowRunFailure>> {
  const failed: WorkflowSessionState = {
    ...session,
    status: "failed",
    lastError: message,
  };
  const persisted = await persistTerminalSessionState(failed, options, message);
  return err(
    workflowRunFailure(1, persisted.ok ? message : persisted.error, session),
  );
}

function stableJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function outputArtifactJsonText(payload: unknown): string {
  return `${stableJson(payload)}\n`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function resolveOutputValidationAttempts(node: NodePayload): number {
  if (node.output === undefined) {
    return 1;
  }
  if (node.output.maxValidationAttempts !== undefined) {
    return Math.max(1, node.output.maxValidationAttempts);
  }
  return node.output.jsonSchema === undefined ? 1 : 3;
}

function buildOutputPublicationPolicy(): {
  readonly owner: "runtime";
  readonly finalArtifactWrite: "runtime-only";
  readonly mailboxWrite: "runtime-only-after-validation";
  readonly candidateSubmission: "inline-json-or-reserved-candidate-file";
  readonly futureCommunicationIdsExposed: false;
} {
  return {
    owner: "runtime",
    finalArtifactWrite: "runtime-only",
    mailboxWrite: "runtime-only-after-validation",
    candidateSubmission: "inline-json-or-reserved-candidate-file",
    futureCommunicationIdsExposed: false,
  };
}

function nextOutputAttemptId(counter: number): string {
  return `attempt-${String(counter).padStart(6, "0")}`;
}

function buildReservedCandidateSubmissionPath(input: {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly outputAttemptId: string;
}): string {
  return path.join(
    os.tmpdir(),
    "divedra-output-candidates",
    input.workflowId,
    input.workflowExecutionId,
    input.nodeId,
    input.nodeExecId,
    input.outputAttemptId,
    "candidate.json",
  );
}

async function cleanupReservedCandidateSubmissionPath(
  candidatePath: string,
): Promise<void> {
  await rm(path.dirname(candidatePath), { recursive: true, force: true });
}

function buildOutputPromptText(input: {
  readonly basePromptText: string;
  readonly node: NodePayload;
  readonly candidatePath: string;
  readonly validationErrors: readonly JsonSchemaValidationError[];
}): string {
  const contract = input.node.output;
  if (contract === undefined) {
    return input.basePromptText;
  }

  const sections = [
    input.basePromptText.trimEnd(),
    "",
    "Output contract:",
    "Return only the business JSON object for output.payload.",
    "Final output.json publication and mailbox delivery are runtime-owned.",
    "Do not write mailbox files, output.json, or invent communication ids.",
    "If you write a file, write only to the reserved Candidate-Path.",
  ];
  if (contract.description !== undefined) {
    sections.push(`Description: ${contract.description}`);
  }
  sections.push(`Candidate-Path: ${input.candidatePath}`);
  if (contract.jsonSchema !== undefined) {
    sections.push("JSON-Schema:");
    sections.push(stableJson(contract.jsonSchema));
  }
  if (input.validationErrors.length > 0) {
    sections.push("Previous output was rejected:");
    formatOutputValidationErrors(input.validationErrors).forEach((entry) => {
      sections.push(`- ${entry.path}: ${entry.message}`);
    });
    if (input.validationErrors.length > MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS) {
      sections.push(
        `- $: ${input.validationErrors.length - MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS} additional validation errors omitted; fix the schema violations above first.`,
      );
    }
    sections.push(
      contract.jsonSchema === undefined
        ? "Return a corrected JSON object."
        : "Return a corrected JSON object that satisfies the schema.",
    );
  }
  return sections.join("\n");
}

const MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS = 8;
const MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH = 240;
const NON_CONTRACT_CANDIDATE_FILE_ERROR =
  "adapter output.candidateFilePath is only supported when node.output is configured";
const WORKFLOW_EXTERNAL_INPUT_NODE_ID = "__workflow-input-mailbox__";
const WORKFLOW_EXTERNAL_OUTPUT_NODE_ID = "__workflow-output-mailbox__";

function formatOutputValidationErrors(
  errors: readonly JsonSchemaValidationError[],
): readonly JsonSchemaValidationError[] {
  return errors
    .slice(0, MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS)
    .map((entry) => ({
      path: entry.path,
      message:
        entry.message.length <= MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH
          ? entry.message
          : `${entry.message.slice(0, MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH - 3)}...`,
    }));
}

function buildRetryValidationFeedback(
  errors: readonly JsonSchemaValidationError[],
): readonly JsonSchemaValidationError[] {
  if (errors.length === 0) {
    return [];
  }
  return formatOutputValidationErrors(errors);
}

interface CandidatePayloadResolutionError {
  readonly message: string;
  readonly retryable: boolean;
}

async function readCandidatePayloadFromFile(
  filePath: string,
): Promise<
  Result<Readonly<Record<string, unknown>>, CandidatePayloadResolutionError>
> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return err({
        message: `candidate file '${filePath}' must contain a JSON object`,
        retryable: true,
      });
    }
    return ok(parsed as Readonly<Record<string, unknown>>);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      message: `unable to read candidate file '${filePath}': ${message}`,
      retryable: true,
    });
  }
}

async function resolveCandidatePayload(input: {
  readonly expectedCandidatePath: string;
  readonly execution: AdapterExecutionOutput;
}): Promise<
  Result<Readonly<Record<string, unknown>>, CandidatePayloadResolutionError>
> {
  if (input.execution.candidateFilePath === undefined) {
    return ok(input.execution.payload);
  }

  const resolvedPath = path.isAbsolute(input.execution.candidateFilePath)
    ? input.execution.candidateFilePath
    : path.resolve(
        path.dirname(input.expectedCandidatePath),
        input.execution.candidateFilePath,
      );
  if (
    path.resolve(resolvedPath) !== path.resolve(input.expectedCandidatePath)
  ) {
    return err({
      message: `candidate file path must resolve to the reserved candidate path '${input.expectedCandidatePath}'`,
      retryable: false,
    });
  }
  return readCandidatePayloadFromFile(resolvedPath);
}

async function readOutputPayloadArtifact(
  artifactDir: string,
): Promise<Result<OutputArtifact, string>> {
  const outputPath = path.join(artifactDir, "output.json");

  try {
    const outputRaw = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(outputRaw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return err(`output artifact '${outputPath}' must contain a JSON object`);
    }
    return ok({
      payload: parsed as Readonly<Record<string, unknown>>,
      raw: outputRaw,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(`unable to read output artifact '${outputPath}': ${message}`);
  }
}

function findNodeRef(workflow: WorkflowJson, nodeId: string) {
  return workflow.nodes.find((entry) => entry.id === nodeId);
}

function isOptionalNode(workflow: WorkflowJson, nodeId: string): boolean {
  return findNodeRef(workflow, nodeId)?.execution?.mode === "optional";
}

function findOwningManagerNodeId(
  workflow: WorkflowJson,
  _nodeId: string,
): string {
  return resolveWorkflowManagerRuntimeId(workflow);
}

function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
  return nodeIds.filter((value, index, all) => all.indexOf(value) === index);
}

function upsertPendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  decision: PendingOptionalNodeDecision,
): readonly PendingOptionalNodeDecision[] {
  return [
    ...decisions.filter((entry) => entry.nodeId !== decision.nodeId),
    decision,
  ];
}

function removePendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  nodeId: string,
): readonly PendingOptionalNodeDecision[] {
  return decisions.filter((entry) => entry.nodeId !== nodeId);
}

function findPendingOptionalNodeDecision(
  session: WorkflowSessionState,
  nodeId: string,
): PendingOptionalNodeDecision | undefined {
  return session.pendingOptionalNodeDecisions?.find(
    (entry) => entry.nodeId === nodeId,
  );
}

function buildOptionalSkipOutput(
  reason = "manager judged unnecessary",
): Readonly<Record<string, unknown>> {
  return {
    provider: "runtime-optional-skip",
    completionPassed: true,
    when: {
      always: true,
      skipped: true,
    },
    payload: {
      optionalNodeSkipped: true,
      reason,
    },
  };
}

function applyOptionalManagerDecisions(input: {
  readonly managerControl: ParsedManagerControl | null;
  readonly session: WorkflowSessionState;
  readonly workflow: WorkflowJson;
  readonly managerRuntimeId: string;
  readonly managerNodeExecId: string;
  readonly decidedAt: string;
}): Result<
  {
    readonly pendingOptionalNodeDecisions: readonly PendingOptionalNodeDecision[];
    readonly queuedNodeIds: readonly string[];
  },
  string
> {
  const optionalTargetNoun =
    input.workflow.steps !== undefined ? "step" : "node";
  const managerControl = input.managerControl;
  if (managerControl === null) {
    return ok({
      pendingOptionalNodeDecisions:
        input.session.pendingOptionalNodeDecisions ?? [],
      queuedNodeIds: [],
    });
  }

  const actionsByNodeId = new Map<
    string,
    { readonly status: "execute" | "skip"; readonly reason?: string }
  >();
  for (const action of managerControl.actions) {
    if (
      action.type !== "execute-optional-step" &&
      action.type !== "skip-optional-step"
    ) {
      continue;
    }
    const nextStatus =
      action.type === "execute-optional-step" ? "execute" : "skip";
    const existingAction = actionsByNodeId.get(action.stepId);
    if (existingAction !== undefined && existingAction.status !== nextStatus) {
      return err(
        `invalid manager control at '${input.managerRuntimeId}': optional ${optionalTargetNoun} '${action.stepId}' cannot be both executed and skipped in one manager turn`,
      );
    }
    actionsByNodeId.set(action.stepId, {
      status: nextStatus,
      ...(action.type === "skip-optional-step" && action.reason !== undefined
        ? { reason: action.reason }
        : {}),
    });
  }

  let pendingOptionalNodeDecisions =
    input.session.pendingOptionalNodeDecisions ?? [];
  const queuedNodeIds: string[] = [];
  for (const [nodeId, action] of actionsByNodeId.entries()) {
    const currentDecision = pendingOptionalNodeDecisions.find(
      (entry) => entry.nodeId === nodeId,
    );
    if (currentDecision === undefined || currentDecision.status !== "pending") {
      return err(
        `invalid manager control at '${input.managerRuntimeId}': optional ${optionalTargetNoun} '${nodeId}' is not currently pending`,
      );
    }
    if (currentDecision.owningManagerNodeId !== input.managerRuntimeId) {
      return err(
        `invalid manager control at '${input.managerRuntimeId}': optional ${optionalTargetNoun} '${nodeId}' is owned by '${currentDecision.owningManagerNodeId}'`,
      );
    }
    if (!isOptionalNode(input.workflow, nodeId)) {
      return err(
        `invalid manager control at '${input.managerRuntimeId}': ${optionalTargetNoun} '${nodeId}' is not optional`,
      );
    }
    pendingOptionalNodeDecisions = upsertPendingOptionalNodeDecision(
      pendingOptionalNodeDecisions,
      {
        ...currentDecision,
        status: action.status,
        ...(action.status === "skip" && action.reason !== undefined
          ? { reason: action.reason }
          : {}),
        decidedAt: input.decidedAt,
        decidedByNodeExecId: input.managerNodeExecId,
      },
    );
    queuedNodeIds.push(nodeId);
  }

  return ok({
    pendingOptionalNodeDecisions,
    queuedNodeIds: dedupeNodeIds(queuedNodeIds),
  });
}

function findLatestPublishedWorkflowResult(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): NodeExecutionRecord | undefined {
  return [...session.nodeExecutions]
    .reverse()
    .find(
      (entry) =>
        entry.status === "succeeded" &&
        isWorkflowOutputKindNode(workflow, entry.nodeId),
    );
}

/**
 * Prefix for `transitionWhen` and queued transition `when` strings from
 * step-derived cross-workflow dispatches. Value is historical; kept for persisted
 * session compatibility. Dispatch ids are `__cw:<stepId>`, not authored `workflowCalls`.
 */
const CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX = "workflow-call:";

/**
 * Picks the callee session execution used to build the cross-workflow return payload:
 * latest succeeded workflow output-kind node when present; otherwise, for manager-less
 * callee bundles only, the latest succeeded execution. Flat cross-workflow handoff, not a structural child workflow.
 */
function findLatestCrossWorkflowCalleeResultExecution(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
): NodeExecutionRecord | undefined {
  const published = findLatestPublishedWorkflowResult(workflow, session);
  if (published !== undefined) {
    return published;
  }

  if (workflow.hasManagerNode !== false) {
    return undefined;
  }

  return [...session.nodeExecutions]
    .reverse()
    .find((entry) => entry.status === "succeeded");
}

/**
 * Merges caller state into `runtimeVariables.workflowCall` for a cross-workflow callee run.
 * Serialized `workflowCall.parentWorkflowId` / `parentWorkflowExecutionId` keep historical key names; they refer to the invoking (caller) workflow, not a structural sub-workflow relationship.
 */
function buildCrossWorkflowCalleeRuntimeVariables(input: {
  readonly callerRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly callerWorkflowId: string;
  readonly callerWorkflowExecutionId: string;
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly workflowCallId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const filteredCallerRuntimeVariables = Object.fromEntries(
    Object.entries(input.callerRuntimeVariables).filter(
      ([key]) =>
        key !== "humanInput" &&
        key !== "workflowOutput" &&
        key !== "workflowCall",
    ),
  );

  return {
    ...filteredCallerRuntimeVariables,
    workflowCall: {
      id: input.workflowCallId,
      parentWorkflowId: input.callerWorkflowId,
      parentWorkflowExecutionId: input.callerWorkflowExecutionId,
      callerNodeId: input.callerNodeId,
      ...(input.callerStepId === undefined
        ? {}
        : { callerStepId: input.callerStepId }),
      input: input.payload,
    },
  };
}

/**
 * Run options for invoking another workflow (callee) from a step transition.
 * This is a sibling call into another bundle, not a structural child workflow; the name avoids implying a sub-workflow tree.
 * Same filesystem/session roots as the caller except `runtimeVariables`.
 */
function buildCrossWorkflowCalleeRunOptions(
  options: WorkflowRunOptions,
  runtimeVariables: Readonly<Record<string, unknown>>,
): WorkflowRunOptions {
  return {
    ...(options.workflowRoot === undefined
      ? {}
      : { workflowRoot: options.workflowRoot }),
    ...(options.workflowScope === undefined
      ? {}
      : { workflowScope: options.workflowScope }),
    ...(options.userRoot === undefined ? {} : { userRoot: options.userRoot }),
    ...(options.projectRoot === undefined
      ? {}
      : { projectRoot: options.projectRoot }),
    ...(options.addonRoot === undefined
      ? {}
      : { addonRoot: options.addonRoot }),
    ...(options.resolvedWorkflowSource === undefined
      ? {}
      : { resolvedWorkflowSource: options.resolvedWorkflowSource }),
    ...(options.artifactRoot === undefined
      ? {}
      : { artifactRoot: options.artifactRoot }),
    ...(options.rootDataDir === undefined
      ? {}
      : { rootDataDir: options.rootDataDir }),
    ...(options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: options.sessionStoreRoot }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.nodeAddons === undefined
      ? {}
      : { nodeAddons: options.nodeAddons }),
    ...(options.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: options.asyncNodeAddonResolvers }),
    ...(options.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: options.nodeAddonResolvers }),
    ...(options.rejectLegacyWorkflowAuthoring === undefined
      ? {}
      : {
          rejectLegacyWorkflowAuthoring: options.rejectLegacyWorkflowAuthoring,
        }),
    ...(options.workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory: options.workflowWorkingDirectory }),
    runtimeVariables,
    ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
    ...(options.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: options.maxLoopIterations }),
    ...(options.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: options.defaultTimeoutMs }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.mockScenario === undefined
      ? {}
      : { mockScenario: options.mockScenario }),
    ...(options.restartOnStuck === undefined
      ? {}
      : { restartOnStuck: options.restartOnStuck }),
    ...(options.maxStuckRestarts === undefined
      ? {}
      : { maxStuckRestarts: options.maxStuckRestarts }),
    ...(options.stuckRestartBackoffMs === undefined
      ? {}
      : { stuckRestartBackoffMs: options.stuckRestartBackoffMs }),
  };
}

/**
 * Persists cross-workflow dispatch metadata under the caller's artifact tree (`workflow-calls/`).
 * Preferred field names (`callerNodeExecId`, `callee*`) describe a flat caller/callee handoff.
 * `parentNodeExecId` and `child*` repeat the same values for older consumers; they do not imply
 * a structural parent/child workflow relationship.
 */
async function persistCrossWorkflowDispatchArtifact(input: {
  readonly artifactDir: string;
  readonly callId: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly calleeWorkflowName: string;
  readonly calleeWorkflowId: string;
  readonly calleeSession: WorkflowSessionState;
  readonly callerNodeExecId: string;
  readonly resultNodeId?: string;
  readonly resultOutputRef?: OutputRef;
}): Promise<void> {
  await mkdir(path.join(input.artifactDir, "workflow-calls"), {
    recursive: true,
  });
  const callerExecId = input.callerNodeExecId;
  const calleeName = input.calleeWorkflowName;
  const calleeId = input.calleeWorkflowId;
  const calleeSessionId = input.calleeSession.sessionId;
  const calleeSessionStatus = input.calleeSession.status;
  await writeJsonFile(
    path.join(input.artifactDir, "workflow-calls", `${input.callId}.json`),
    {
      workflowCallId: input.callId,
      workflowId: input.workflowId,
      callerNodeId: input.callerNodeId,
      ...(input.callerStepId === undefined
        ? {}
        : { callerStepId: input.callerStepId }),
      callerNodeExecId: callerExecId,
      calleeWorkflowName: calleeName,
      calleeWorkflowId: calleeId,
      calleeSessionId,
      calleeSessionStatus,
      parentNodeExecId: callerExecId,
      childWorkflowName: calleeName,
      childWorkflowId: calleeId,
      childSessionId: calleeSessionId,
      childSessionStatus: calleeSessionStatus,
      ...(input.resultNodeId === undefined
        ? {}
        : { resultNodeId: input.resultNodeId }),
      ...(input.resultOutputRef === undefined
        ? {}
        : { resultOutputRef: input.resultOutputRef }),
    },
  );
}

interface CrossWorkflowDispatchExecutionResult {
  readonly communications: readonly CommunicationRecord[];
  readonly communicationCounter: number;
  readonly queuedNodeIds: readonly string[];
  readonly transitions: readonly {
    readonly from: string;
    readonly to: string;
    readonly when: string;
  }[];
}

function crossWorkflowDispatchMatchesCallerExecution(input: {
  readonly entry: CrossWorkflowExecutionDispatch;
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly callerOutputPayload: Readonly<Record<string, unknown>>;
}): boolean {
  const { entry } = input;
  if (entry.when !== undefined) {
    if (
      !evaluateBranch({
        when: entry.when,
        output: input.callerOutputPayload,
      })
    ) {
      return false;
    }
  }
  if (entry.callerStepId !== undefined) {
    if (input.callerStepId === undefined) {
      return false;
    }
    return (
      entry.callerStepId === input.callerStepId &&
      entry.callerNodeId === input.callerNodeId
    );
  }
  return entry.callerNodeId === input.callerNodeId;
}

/**
 * Executes cross-workflow dispatches derived from step transitions (`steps[].transitions`).
 * Non-step-addressed bundles yield no execution rows (cross-workflow dispatch is empty);
 * callers invoke this unconditionally after node completion so there is one code path.
 */
async function executeCrossWorkflowDispatchesForNode(input: {
  readonly workflow: WorkflowJson;
  readonly workflowName: string;
  readonly session: WorkflowSessionState;
  readonly options: WorkflowRunOptions;
  readonly artifactWorkflowRoot: string;
  readonly callerNodeId: string;
  readonly callerStepId?: string;
  readonly callerNodeExecId: string;
  readonly callerArtifactDir: string;
  readonly callerOutputPayload: Readonly<Record<string, unknown>>;
  readonly callerOutputRaw: string;
  readonly createdAt: string;
  readonly communicationCounter: number;
  readonly currentCommunications: readonly CommunicationRecord[];
  readonly adapter: NodeAdapter;
  readonly guards: EngineExecutionGuards | undefined;
  /** Workflow ids already on the active cross-workflow call stack (cycle guard). */
  readonly crossWorkflowInvocationStack: readonly string[];
}): Promise<Result<CrossWorkflowDispatchExecutionResult, string>> {
  const matchCtx = {
    callerNodeId: input.callerNodeId,
    ...(input.callerStepId === undefined
      ? {}
      : { callerStepId: input.callerStepId }),
    callerOutputPayload: input.callerOutputPayload,
  };
  // Cross-workflow dispatch: only step-addressed bundles derive execution rows
  // from `steps[].transitions`. Legacy node-graph bundles no longer dispatch
  // authored top-level `workflow.workflowCalls`.
  const relevantDispatches = crossWorkflowDispatchesForExecutionMatch(
    input.workflow,
    (entry) => crossWorkflowDispatchMatchesCallerExecution({ entry, ...matchCtx }),
  );
  if (relevantDispatches.length === 0) {
    return ok({
      communications: input.currentCommunications,
      communicationCounter: input.communicationCounter,
      queuedNodeIds: [],
      transitions: [],
    });
  }

  let currentCommunications = [...input.currentCommunications];
  let currentCommunicationCounter = input.communicationCounter;
  const queuedNodeIds: string[] = [];
  const transitions: Array<{
    readonly from: string;
    readonly to: string;
    readonly when: string;
  }> = [];

  for (const dispatch of relevantDispatches) {
    if (
      input.crossWorkflowInvocationStack.includes(dispatch.workflowId) ||
      input.workflow.workflowId === dispatch.workflowId
    ) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' would recurse into '${dispatch.workflowId}', which is not supported`,
      );
    }

    const loadedCallee = await loadWorkflowByIdFromDisk(
      dispatch.workflowId,
      input.options,
    );
    if (!loadedCallee.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' target '${dispatch.workflowId}' could not be loaded: ${loadedCallee.error.message}`,
      );
    }

    const calleeRun = await runWorkflowInternal(
      loadedCallee.value.workflowName,
      buildCrossWorkflowCalleeRunOptions(
        input.options,
        buildCrossWorkflowCalleeRuntimeVariables({
          callerRuntimeVariables: input.session.runtimeVariables,
          callerWorkflowId: input.workflow.workflowId,
          callerWorkflowExecutionId: input.session.sessionId,
          callerNodeId: input.callerNodeId,
          ...(input.callerStepId === undefined
            ? {}
            : { callerStepId: input.callerStepId }),
          workflowCallId: dispatch.id,
          payload: input.callerOutputPayload["payload"] as Readonly<
            Record<string, unknown>
          >,
        }),
      ),
      input.adapter,
      input.guards,
      [...input.crossWorkflowInvocationStack, input.workflow.workflowId],
    );
    if (!calleeRun.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' failed: ${calleeRun.error.message}`,
      );
    }

    const calleeWorkflow = loadedCallee.value.bundle.workflow;
    const calleeResultExecution = findLatestCrossWorkflowCalleeResultExecution(
      calleeWorkflow,
      calleeRun.value.session,
    );
    const calleeOutputRef =
      calleeResultExecution === undefined
        ? undefined
        : buildOutputRefForExecution({
            workflow: calleeWorkflow,
            session: calleeRun.value.session,
            execution: calleeResultExecution,
          });

    await persistCrossWorkflowDispatchArtifact({
      artifactDir: input.callerArtifactDir,
      callId: dispatch.id,
      workflowId: dispatch.workflowId,
      callerNodeId: input.callerNodeId,
      ...(input.callerStepId === undefined
        ? {}
        : { callerStepId: input.callerStepId }),
      calleeWorkflowName: loadedCallee.value.workflowName,
      calleeWorkflowId: calleeWorkflow.workflowId,
      calleeSession: calleeRun.value.session,
      callerNodeExecId: input.callerNodeExecId,
      ...(dispatch.resultNodeId === undefined
        ? {}
        : { resultNodeId: dispatch.resultNodeId }),
      ...(calleeOutputRef === undefined
        ? {}
        : { resultOutputRef: calleeOutputRef }),
    });

    if (dispatch.resultNodeId === undefined) {
      continue;
    }

    if (calleeResultExecution === undefined || calleeOutputRef === undefined) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' completed without a result execution for '${dispatch.resultNodeId}'`,
      );
    }

    const calleeOutput = await readOutputPayloadArtifact(
      calleeResultExecution.artifactDir,
    );
    if (!calleeOutput.ok) {
      return err(
        `cross-workflow dispatch '${dispatch.id}' produced an unreadable result: ${calleeOutput.error}`,
      );
    }

    const communication = await persistCommunicationArtifact({
      artifactWorkflowRoot: input.artifactWorkflowRoot,
      runtimeLogOptions: input.options,
      workflowId: input.workflow.workflowId,
      workflowExecutionId: input.session.sessionId,
      communicationCounter: currentCommunicationCounter,
      fromNodeId: input.callerNodeId,
      toNodeId: dispatch.resultNodeId,
      routingScope: "intra-workflow",
      deliveryKind: "edge-transition",
      transitionWhen: `${CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX}${dispatch.id}`,
      sourceNodeExecId: input.callerNodeExecId,
      payloadRef: calleeOutputRef,
      outputRaw: calleeOutput.value.raw,
      deliveredByNodeId: resolveWorkflowManagerRuntimeId(input.workflow),
      createdAt: input.createdAt,
    });
    currentCommunicationCounter += 1;
    currentCommunications.push(communication);
    queuedNodeIds.push(dispatch.resultNodeId);
    transitions.push({
      from: input.callerNodeId,
      to: dispatch.resultNodeId,
      when: `${CROSS_WORKFLOW_DISPATCH_TRANSITION_WHEN_PREFIX}${dispatch.id}`,
    });
  }

  return ok({
    communications: currentCommunications,
    communicationCounter: currentCommunicationCounter,
    queuedNodeIds,
    transitions,
  });
}

function buildUpstreamOutputRefs(
  session: WorkflowSessionState,
  nodeId: string,
): readonly UpstreamOutputRef[] {
  const matchingCommunications = session.communications.filter(
    (communication) =>
      communication.status === "delivered" && communication.toNodeId === nodeId,
  );
  if (matchingCommunications.length === 0) {
    return [];
  }

  return matchingCommunications
    .map((communication) => {
      const execution = session.nodeExecutions.find(
        (candidate) => candidate.nodeExecId === communication.sourceNodeExecId,
      );
      return {
        fromNodeId: communication.fromNodeId,
        transitionWhen: communication.transitionWhen,
        status: execution?.status ?? communication.status,
        communicationId: communication.communicationId,
        ...communication.payloadRef,
      };
    })
    .filter((entry): entry is UpstreamOutputRef => entry !== undefined);
}

async function buildUpstreamInputs(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
  nodeId: string,
): Promise<Result<readonly UpstreamInput[], string>> {
  const upstreamTargetNoun = workflow.steps !== undefined ? "step" : "node";
  const refs = buildUpstreamOutputRefs(session, nodeId);
  if (refs.length === 0) {
    return ok([]);
  }

  const loaded: UpstreamInput[] = [];
  for (const ref of refs) {
    const output = await readOutputPayloadArtifact(ref.artifactDir);
    if (!output.ok) {
      return err(
        `failed to resolve upstream communication '${ref.communicationId}' for ${upstreamTargetNoun} '${nodeId}': ${output.error}`,
      );
    }
    loaded.push({
      ...ref,
      output: output.value.payload,
      outputRaw: output.value.raw,
    });
  }

  return ok(loaded);
}

function buildCommitMessageTemplate(
  inputHash: string,
  outputHash: string,
  ref: OutputRef,
  nextNodes: readonly string[],
): string {
  const summary = `chore(workflow): checkpoint node ${ref.outputNodeId}`;
  const nextNodeValue =
    nextNodes.length === 0 ? "(terminal)" : nextNodes.join(",");
  return [
    summary,
    "",
    "Node execution checkpoint for deterministic output-to-input handoff.",
    "",
    `Node-ID: ${ref.outputNodeId}`,
    `Run-ID: ${ref.workflowExecutionId}`,
    `Workflow-ID: ${ref.workflowId}`,
    `Node-Exec-ID: ${ref.nodeExecId}`,
    `Artifact-Dir: ${ref.artifactDir}`,
    `Input-Hash: sha256:${inputHash}`,
    `Output-Hash: sha256:${outputHash}`,
    `Next-Node: ${nextNodeValue}`,
  ].join("\n");
}

interface CreateCommunicationInput {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly routingScope: CommunicationRecord["routingScope"];
  readonly deliveryKind: CommunicationRecord["deliveryKind"];
  readonly transitionWhen: string;
  readonly sourceNodeExecId: string;
  readonly payloadRef: OutputRef;
  readonly outputRaw: string;
  readonly deliveredByNodeId: string;
  readonly createdAt: string;
}

async function persistCommunicationArtifact(
  input: CreateCommunicationInput,
): Promise<CommunicationRecord> {
  const communicationId = nextCommunicationId(input.communicationCounter + 1);
  const deliveryAttemptId = initialDeliveryAttemptId();
  const communicationDir = path.join(
    input.artifactWorkflowRoot,
    "executions",
    input.workflowExecutionId,
    "communications",
    communicationId,
  );
  const envelope = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    routingScope: input.routingScope,
    sourceNodeExecId: input.sourceNodeExecId,
    deliveryKind: input.deliveryKind,
    payloadRef: {
      ...input.payloadRef,
      outputFile: "output.json",
    },
    createdAt: input.createdAt,
  };
  const meta = {
    status: "delivered",
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    sourceNodeExecId: input.sourceNodeExecId,
    routingScope: input.routingScope,
    deliveryKind: input.deliveryKind,
    activeDeliveryAttemptId: deliveryAttemptId,
    deliveryAttemptIds: [deliveryAttemptId],
    createdAt: input.createdAt,
    deliveredAt: input.createdAt,
  };
  const attempt = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    deliveryAttemptId,
    toNodeId: input.toNodeId,
    status: "succeeded",
    startedAt: input.createdAt,
    endedAt: input.createdAt,
  };
  const receipt = {
    communicationId,
    deliveryAttemptId,
    deliveredByNodeId: input.deliveredByNodeId,
    deliveredAt: input.createdAt,
  };

  await mkdir(path.join(communicationDir, "outbox", input.fromNodeId), {
    recursive: true,
  });
  await mkdir(path.join(communicationDir, "inbox", input.toNodeId), {
    recursive: true,
  });
  await mkdir(path.join(communicationDir, "attempts", deliveryAttemptId), {
    recursive: true,
  });

  await writeJsonFile(path.join(communicationDir, "message.json"), envelope);
  await writeJsonFile(
    path.join(communicationDir, "outbox", input.fromNodeId, "message.json"),
    envelope,
  );
  await writeRawTextFile(
    path.join(communicationDir, "outbox", input.fromNodeId, "output.json"),
    input.outputRaw,
  );
  await writeJsonFile(
    path.join(communicationDir, "inbox", input.toNodeId, "message.json"),
    envelope,
  );
  await writeJsonFile(
    path.join(communicationDir, "attempts", deliveryAttemptId, "attempt.json"),
    attempt,
  );
  await writeJsonFile(
    path.join(communicationDir, "attempts", deliveryAttemptId, "receipt.json"),
    receipt,
  );
  await writeJsonFile(path.join(communicationDir, "meta.json"), meta);

  const communication: CommunicationRecord = {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    routingScope: input.routingScope,
    sourceNodeExecId: input.sourceNodeExecId,
    payloadRef: input.payloadRef,
    deliveryKind: input.deliveryKind,
    transitionWhen: input.transitionWhen,
    status: "delivered",
    activeDeliveryAttemptId: deliveryAttemptId,
    deliveryAttemptIds: [deliveryAttemptId],
    createdAt: input.createdAt,
    deliveredAt: input.createdAt,
    artifactDir: communicationDir,
  };

  if (input.runtimeLogOptions !== undefined) {
    try {
      await saveCommunicationEventToRuntimeDb(
        communication,
        input.runtimeLogOptions,
      );
    } catch {
      // runtime DB event logs are best-effort
    }
  }

  return communication;
}

async function persistExternalMailboxInputCommunication(input: {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly deliveredByNodeId: string;
  readonly toNodeId: string;
  readonly humanInput: unknown;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  const sourceNodeExecId = "external-input-000001";
  const externalArtifactDir = path.join(
    input.artifactWorkflowRoot,
    "executions",
    input.workflowExecutionId,
    "external-mailbox",
    "input",
  );
  const outputPayload = {
    provider: "external-mailbox",
    model: "workflow-input",
    promptText: "workflow input mailbox delivery",
    completionPassed: true,
    when: { always: true },
    payload: normalizeExternalMailboxBusinessPayload(input.humanInput),
  };
  const outputRaw = outputArtifactJsonText(outputPayload);
  await mkdir(externalArtifactDir, { recursive: true });
  await writeRawTextFile(
    path.join(externalArtifactDir, "output.json"),
    outputRaw,
  );

  return persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    ...(input.runtimeLogOptions === undefined
      ? {}
      : { runtimeLogOptions: input.runtimeLogOptions }),
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: WORKFLOW_EXTERNAL_INPUT_NODE_ID,
    toNodeId: input.toNodeId,
    routingScope: "external-mailbox",
    deliveryKind: "external-input",
    transitionWhen: "external-mailbox:workflow-input",
    sourceNodeExecId,
    payloadRef: {
      kind: "node-output",
      workflowExecutionId: input.workflowExecutionId,
      workflowId: input.workflowId,
      outputNodeId: WORKFLOW_EXTERNAL_INPUT_NODE_ID,
      nodeExecId: sourceNodeExecId,
      artifactDir: externalArtifactDir,
    },
    outputRaw,
    deliveredByNodeId: input.deliveredByNodeId,
    createdAt: input.createdAt,
  });
}

async function persistExternalMailboxOutputCommunication(input: {
  readonly artifactWorkflowRoot: string;
  readonly runtimeLogOptions?: LoadOptions;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly execution: NodeExecutionRecord;
  readonly outputRaw: string;
  readonly communicationCounter: number;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  return persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    ...(input.runtimeLogOptions === undefined
      ? {}
      : { runtimeLogOptions: input.runtimeLogOptions }),
    workflowId: input.workflow.workflowId,
    workflowExecutionId: input.session.sessionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: input.execution.nodeId,
    toNodeId: WORKFLOW_EXTERNAL_OUTPUT_NODE_ID,
    routingScope: "external-mailbox",
    deliveryKind: "external-output",
    transitionWhen: "external-mailbox:workflow-output",
    sourceNodeExecId: input.execution.nodeExecId,
    payloadRef: buildOutputRefForExecution({
      workflow: input.workflow,
      session: input.session,
      execution: input.execution,
    }),
    outputRaw: input.outputRaw,
    deliveredByNodeId: resolveWorkflowManagerRuntimeId(input.workflow),
    createdAt: input.createdAt,
  });
}

async function markCommunicationsConsumed(
  session: WorkflowSessionState,
  communicationIds: readonly string[],
  consumedByNodeExecId: string,
  consumedAt: string,
): Promise<Result<readonly CommunicationRecord[], string>> {
  if (communicationIds.length === 0) {
    return ok(session.communications);
  }

  const consumedSet = new Set(communicationIds);
  const updates: CommunicationRecord[] = [];
  for (const communication of session.communications) {
    if (!consumedSet.has(communication.communicationId)) {
      updates.push(communication);
      continue;
    }

    const activeAttemptId =
      communication.activeDeliveryAttemptId ??
      communication.deliveryAttemptIds[
        communication.deliveryAttemptIds.length - 1
      ] ??
      initialDeliveryAttemptId();
    const metaPath = path.join(communication.artifactDir, "meta.json");
    const receiptPath = path.join(
      communication.artifactDir,
      "attempts",
      activeAttemptId,
      "receipt.json",
    );

    let parsedMeta: Record<string, unknown>;
    let parsedReceipt: Record<string, unknown>;
    try {
      parsedMeta = JSON.parse(await readFile(metaPath, "utf8")) as Record<
        string,
        unknown
      >;
      parsedReceipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      return err(
        `failed to load mailbox delivery metadata for '${communication.communicationId}': ${message}`,
      );
    }

    try {
      await writeJsonFile(receiptPath, {
        ...parsedReceipt,
        consumedByNodeExecId,
        consumedAt,
      });
      await writeJsonFile(metaPath, {
        ...parsedMeta,
        status: "consumed",
        consumedByNodeExecId,
        consumedAt,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error";
      return err(
        `failed to persist mailbox consumption for '${communication.communicationId}': ${message}`,
      );
    }

    updates.push({
      ...communication,
      status: "consumed",
      consumedByNodeExecId,
      consumedAt,
    });
  }

  return ok(updates);
}

function isTerminalStatus(status: WorkflowSessionState["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function readBusinessPayload(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> | null {
  const payload = value["payload"];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  return payload as Readonly<Record<string, unknown>>;
}

function cloneSession(session: WorkflowSessionState): WorkflowSessionState {
  const next: WorkflowSessionState = {
    ...session,
    queue: [...session.queue],
    nodeExecutionCounts: { ...session.nodeExecutionCounts },
    loopIterationCounts: { ...(session.loopIterationCounts ?? {}) },
    restartCounts: { ...(session.restartCounts ?? {}) },
    restartEvents: [...(session.restartEvents ?? [])],
    transitions: [...session.transitions],
    nodeExecutions: [...session.nodeExecutions],
    communicationCounter: session.communicationCounter,
    communications: [...session.communications],
    conversationTurns: [...(session.conversationTurns ?? [])],
    nodeBackendSessions: { ...(session.nodeBackendSessions ?? {}) },
    pendingOptionalNodeDecisions: [
      ...(session.pendingOptionalNodeDecisions ?? []),
    ],
    activeUserActions: [...(session.activeUserActions ?? [])],
    runtimeVariables: { ...session.runtimeVariables },
  };
  if (session.supervision === undefined) {
    return next;
  }
  return {
    ...next,
    supervision: {
      ...session.supervision,
      incidents: [...session.supervision.incidents],
      ...(session.supervision.remediations === undefined
        ? {}
        : { remediations: [...session.supervision.remediations] }),
    },
  };
}

function createInitialSupervisionRunState(input: {
  readonly policy: AutoImprovePolicy;
  readonly targetWorkflowId: string;
}): SupervisionRunState {
  const superviserWorkflowId = resolveSuperviserWorkflowId(
    input.policy.superviserWorkflowId,
  );
  return {
    supervisionRunId: `sup-${randomBytes(10).toString("hex")}`,
    targetWorkflowId: input.targetWorkflowId,
    superviserWorkflowId: superviserWorkflowId.ok
      ? superviserWorkflowId.value
      : DEFAULT_SUPERVISER_WORKFLOW_ID,
    status: "running",
    attemptCount: 1,
    workflowPatchCount: 0,
    policy: input.policy,
    incidents: [],
    remediations: [],
  };
}

function cloneSupervisionForContinuedRun(
  source: SupervisionRunState,
  policy: AutoImprovePolicy,
): SupervisionRunState {
  const superviserWorkflowId = resolveSuperviserWorkflowId(
    policy.superviserWorkflowId,
  );
  return {
    ...source,
    superviserWorkflowId: superviserWorkflowId.ok
      ? superviserWorkflowId.value
      : DEFAULT_SUPERVISER_WORKFLOW_ID,
    status: "running",
    policy,
    incidents: [...source.incidents],
    ...(source.remediations === undefined
      ? {}
      : { remediations: [...source.remediations] }),
  };
}

function buildScenarioExecutableNodePayload(
  node: NodePayload,
  hasScenarioEntry: boolean,
  allowScenarioFallback: boolean,
  allowDryRun: boolean,
): AgentNodePayload | null {
  const agentNodePayload = asAgentNodePayload(node);
  if (agentNodePayload !== null) {
    return agentNodePayload;
  }

  if (
    node.managerType === "code" &&
    (allowScenarioFallback || allowDryRun) &&
    node.promptTemplate !== undefined
  ) {
    return {
      ...node,
      nodeType: "agent",
      model: node.model ?? "deterministic-code-manager",
      promptTemplate: node.promptTemplate,
    };
  }

  if (
    hasScenarioEntry &&
    (node.nodeType === "command" ||
      node.nodeType === "container" ||
      node.nodeType === "addon")
  ) {
    const { nodeType: _nodeType, ...rest } = node;
    return {
      ...rest,
      nodeType: "agent",
      model: `scenario/${node.nodeType}`,
      promptTemplate: node.promptTemplate ?? "",
    };
  }

  return null;
}

async function runWorkflowInternal(
  workflowName: string,
  options: WorkflowRunOptions = {},
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
  crossWorkflowInvocationStack: readonly string[] = [],
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  let workflowWorkingDirectory: string;
  try {
    workflowWorkingDirectory = resolveWorkflowExecutionWorkingDirectory({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.workflowWorkingDirectory === undefined
        ? {}
        : { workflowWorkingDirectory: options.workflowWorkingDirectory }),
    });
  } catch (error: unknown) {
    return err({
      exitCode: 2,
      message:
        error instanceof Error
          ? error.message
          : "workingDirectory must be a non-empty path when provided",
    });
  }
  /** True when this run is not continuing from an existing session (resume or rerun). */
  const isNotResumingOrRerunning =
    options.resumeSessionId === undefined &&
    options.rerunFromSessionId === undefined;
  let preloadedForBundlePath: WorkflowSessionState | undefined;
  if (options.resumeSessionId !== undefined) {
    const pre = await loadSession(options.resumeSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  } else if (options.rerunFromSessionId !== undefined) {
    const pre = await loadSession(options.rerunFromSessionId, options);
    if (!pre.ok) {
      return err({ exitCode: 1, message: pre.error.message });
    }
    if (pre.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "source session workflow does not match command workflow",
      });
    }
    preloadedForBundlePath = pre.value;
  }
  const bundlePathOverrideFromSession =
    preloadedForBundlePath?.supervision?.mutableWorkflowDir;
  const firstLoadOptions: WorkflowRunOptions = {
    ...options,
    ...(options.workflowBundleDirectoryOverride === undefined &&
    bundlePathOverrideFromSession !== undefined
      ? { workflowBundleDirectoryOverride: bundlePathOverrideFromSession }
      : {}),
  };
  let loaded = await loadWorkflowFromDisk(workflowName, firstLoadOptions);
  if (!loaded.ok) {
    return err({
      exitCode:
        loaded.error.code === "VALIDATION" ||
        loaded.error.code === "INVALID_WORKFLOW_NAME"
          ? 2
          : 1,
      message: loaded.error.message,
    });
  }

  let precomputedSupervision: SupervisionRunState | undefined;
  if (isNotResumingOrRerunning && options.autoImprove !== undefined) {
    const policy = options.autoImprove;
    const initial = createInitialSupervisionRunState({
      policy,
      targetWorkflowId: loaded.value.bundle.workflow.workflowId,
    });
    const roots = resolveEffectiveRoots(options);
    const workspace = await createExecutionCopyMutableWorkspace({
      workflowId: loaded.value.bundle.workflow.workflowId,
      sourceWorkflowDir: loaded.value.workflowDirectory,
      artifactRoot: roots.artifactRoot,
      supervisionRunId: initial.supervisionRunId,
      mutationMode: policy.workflowMutationMode,
    });
    if (!workspace.ok) {
      return err({
        exitCode: 1,
        message: `supervision workspace: ${workspace.error.message}`,
      });
    }
    precomputedSupervision = {
      ...initial,
      mutableWorkflowDir: workspace.value.mutableWorkflowDir,
    };
    if (workspace.value.mutationMode === "execution-copy") {
      const reloaded = await loadWorkflowFromDisk(workflowName, {
        ...options,
        workflowBundleDirectoryOverride: workspace.value.mutableWorkflowDir,
      });
      if (!reloaded.ok) {
        return err({
          exitCode:
            reloaded.error.code === "VALIDATION" ||
            reloaded.error.code === "INVALID_WORKFLOW_NAME"
              ? 2
              : 1,
          message: reloaded.error.message,
        });
      }
      loaded = reloaded;
    }
  }

  const runtimeVariables = options.runtimeVariables ?? {};
  const workflow = loaded.value.bundle.workflow;
  const stepAddressedExecution = workflow.steps !== undefined;
  /** Noun for the execution key (`nodeId` queue item): step id or legacy node id. */
  const executionTargetNoun = stepAddressedExecution ? "step" : "node";
  const nodeMap = loaded.value.bundle.nodePayloads;
  const workflowNodes = new Map(
    workflow.nodes.map((entry) => [entry.id, entry]),
  );
  const loopRuleByJudgeNodeId = new Map<string, LoopRule>(
    getStructuralLoops(workflow).map((entry) => [entry.judgeNodeId, entry]),
  );
  const effectiveAdapter =
    adapter ??
    (options.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(options.mockScenario));
  if (
    adapter === undefined &&
    options.mockScenario === undefined &&
    options.dryRun !== true
  ) {
    const readiness = await inspectWorkflowRuntimeReadiness(
      loaded.value.bundle,
      options,
    );
    if (!readiness.ready) {
      return err({
        exitCode: 1,
        message: `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
      });
    }
  }
  const cancellationProbe =
    guards?.cancellationProbe ??
    ({
      async isCancelled(sessionId: string): Promise<boolean> {
        const current = await loadSession(sessionId, options);
        return current.ok && current.value.status === "cancelled";
      },
    } satisfies CancellationProbe);
  const managerSessionStore = createManagerSessionStore(options);

  let session: WorkflowSessionState;
  if (options.rerunFromSessionId !== undefined) {
    if (preloadedForBundlePath === undefined) {
      return err({
        exitCode: 1,
        message: "internal: rerun source session missing",
      });
    }
    const source = preloadedForBundlePath;
    const rerunTargetLabel = workflow.steps === undefined ? "node" : "step";
    const rerunTargetId = options.rerunFromStepId;
    if (rerunTargetId === undefined) {
      return err({
        exitCode: 1,
        message: `rerun ${rerunTargetLabel} id is required when rerunFromSessionId is set`,
      });
    }
    const stepIdSet =
      workflow.steps === undefined
        ? undefined
        : new Set(workflow.steps.map((st) => st.id));
    const rerunIdKnown =
      stepIdSet === undefined
        ? workflowNodes.has(rerunTargetId)
        : stepIdSet.has(rerunTargetId);
    if (!rerunIdKnown) {
      return err({
        exitCode: 1,
        message: `unknown rerun ${rerunTargetLabel} '${rerunTargetId}'`,
      });
    }

    session = createSessionState({
      sessionId: createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId: rerunTargetId,
      runtimeVariables: {
        ...source.runtimeVariables,
        ...runtimeVariables,
      },
    });
    // Supervision outer-loop reruns mint a new session id but the target attempt
    // continues: preserve per-node execution indices so `ScenarioNodeAdapter` (and
    // similar sequence semantics) can advance on the next attempt.
    if (options.supervisionLoopExecution === true) {
      session = {
        ...session,
        nodeExecutionCounter: source.nodeExecutionCounter,
        nodeExecutionCounts: { ...source.nodeExecutionCounts },
      };
    }
  } else if (options.resumeSessionId !== undefined) {
    if (preloadedForBundlePath === undefined) {
      return err({ exitCode: 1, message: "internal: resume session missing" });
    }
    const existing = preloadedForBundlePath;
    session = cloneSession(existing);
    if (options.autoImprove !== undefined) {
      const policy = options.autoImprove;
      if (session.supervision === undefined) {
        return err(
          workflowRunFailure(
            2,
            "autoImprove on resume requires supervision state on the session (start with workflow run --auto-improve, or omit --auto-improve when resuming a non-supervised session)",
            existing,
          ),
        );
      }
      session = {
        ...session,
        supervision: cloneSupervisionForContinuedRun(
          session.supervision,
          policy,
        ),
      };
    }
    if (session.status === "completed") {
      if (options.autoImprove !== undefined) {
        await saveSession(session, options);
      }
      return ok({ session, exitCode: 0 });
    }
    if ((session.activeUserActions?.length ?? 0) > 0) {
      if (options.autoImprove !== undefined) {
        await saveSession(session, options);
      }
      return ok({ session, exitCode: 4 });
    }
    session = {
      ...session,
      status: "running",
      runtimeVariables: { ...session.runtimeVariables, ...runtimeVariables },
    };
  } else {
    session = createSessionState({
      sessionId:
        options.sessionId ??
        createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId: resolveWorkflowManagerRuntimeId(workflow),
      runtimeVariables,
    });
  }

  if (
    options.autoImprove !== undefined &&
    options.resumeSessionId === undefined
  ) {
    const policy = options.autoImprove;
    let nextSupervision: SupervisionRunState;
    if (precomputedSupervision !== undefined) {
      nextSupervision = precomputedSupervision;
    } else if (preloadedForBundlePath?.supervision !== undefined) {
      nextSupervision = cloneSupervisionForContinuedRun(
        preloadedForBundlePath.supervision,
        policy,
      );
    } else if (options.rerunFromSessionId !== undefined) {
      return err({
        exitCode: 2,
        message:
          "autoImprove on rerun requires supervision state on the source session (for example, use workflow run with --auto-improve first, then rerun with the same policy)",
      });
    } else {
      return err({
        exitCode: 1,
        message:
          "internal: auto-improve supervision was not precomputed; report this as a bug",
      });
    }
    session = {
      ...session,
      supervision: nextSupervision,
    };
  }

  if (options.resumeSessionId === undefined) {
    const humanInput = session.runtimeVariables["humanInput"];
    if (humanInput !== undefined) {
      const bootstrapCommunication =
        await persistExternalMailboxInputCommunication({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          communicationCounter: session.communicationCounter,
          deliveredByNodeId: resolveWorkflowManagerRuntimeId(workflow),
          toNodeId: resolveWorkflowManagerRuntimeId(workflow),
          humanInput,
          createdAt: session.startedAt,
        });
      session = {
        ...session,
        communicationCounter: session.communicationCounter + 1,
        communications: [...session.communications, bootstrapCommunication],
      };
    }
  }

  await saveSession(session, options);

  if (options.nestedSuperviserDriver === true) {
    if (options.autoImprove === undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver requires an auto-improve policy",
          session,
        ),
      );
    }
    if (options.rerunFromSessionId !== undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver is not valid when rerunning from a source session",
          session,
        ),
      );
    }
    if (options.resumeSessionId !== undefined) {
      if (session.supervision?.nestedSuperviserSessionId === undefined) {
        return err(
          workflowRunFailure(
            2,
            "nestedSuperviserDriver on resume requires nestedSuperviserSessionId on supervision (start the workflow with --nested-superviser first)",
            session,
          ),
        );
      }
    }
    if (session.supervision === undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver requires seed supervision on the session",
          session,
        ),
      );
    }
    return runNestedSuperviserSessionDriver(
      workflowName,
      session,
      loaded.value,
      options,
      adapter,
      guards,
      crossWorkflowInvocationStack,
    );
  }

  const outgoingEdges = new Map<string, WorkflowEdge[]>();
  getStructuralEdges(workflow).forEach((edge) => {
    const current = outgoingEdges.get(edge.from);
    if (current) {
      current.push(edge);
      return;
    }
    outgoingEdges.set(edge.from, [edge]);
  });

  const maxLoopIterations =
    options.maxLoopIterations ?? workflow.defaults.maxLoopIterations;
  const maxSteps = options.maxSteps;
  const stuckRestartBackoffMs = options.stuckRestartBackoffMs ?? 250;

  if (
    (session.activeUserActions?.length ?? 0) > 0 &&
    session.status === "paused"
  ) {
    return ok({ session, exitCode: 4 });
  }

  while (session.queue.length > 0) {
    const persisted = await loadSession(session.sessionId, options);
    if (persisted.ok && isTerminalStatus(persisted.value.status)) {
      if (persisted.value.status === "completed") {
        return ok({ session: persisted.value, exitCode: 0 });
      }
      const exitCode = persisted.value.status === "cancelled" ? 130 : 1;
      return err(
        workflowRunFailure(
          exitCode,
          persisted.value.lastError ?? `session ${persisted.value.status}`,
          persisted.value,
        ),
      );
    }
    if (await cancellationProbe.isCancelled(session.sessionId)) {
      const cancelled: WorkflowSessionState = {
        ...session,
        status: "cancelled",
        ...(session.queue[0] === undefined
          ? {}
          : { currentNodeId: session.queue[0] }),
        endedAt: nowIso(),
        lastError: "cancelled by external request",
      };
      await saveSession(cancelled, options);
      return err(
        workflowRunFailure(130, cancelled.lastError ?? "cancelled", cancelled),
      );
    }

    if (maxSteps !== undefined && session.nodeExecutionCounter >= maxSteps) {
      const paused: WorkflowSessionState = {
        ...session,
        status: "paused",
        ...(session.queue[0] === undefined
          ? {}
          : { currentNodeId: session.queue[0] }),
        endedAt: nowIso(),
        lastError: `max steps reached (${maxSteps})`,
      };
      await saveSession(paused, options);
      return ok({ session: paused, exitCode: 4 });
    }

    const queue = [...session.queue];
    const nodeId = queue.shift();
    if (nodeId === undefined) {
      break;
    }

    const nodeRef = workflowNodes.get(nodeId);
    const nodePayload = nodeMap[nodeId];
    if (!nodeRef || !nodePayload) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: stepAddressedExecution
          ? `missing step definition for '${nodeId}'`
          : `missing node definition for '${nodeId}'`,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ??
            (stepAddressedExecution
              ? "missing step definition"
              : "missing node definition"),
          failed,
        ),
      );
    }
    const pendingOptionalDecision = findPendingOptionalNodeDecision(
      session,
      nodeId,
    );
    const isOptionalExecutionNode = nodeRef.execution?.mode === "optional";
    if (
      isOptionalExecutionNode &&
      (pendingOptionalDecision === undefined ||
        pendingOptionalDecision.status === "pending")
    ) {
      const requestedAt = nowIso();
      const owningManagerNodeId = findOwningManagerNodeId(workflow, nodeId);
      session = {
        ...session,
        status: "running",
        queue: dedupeNodeIds([...queue, owningManagerNodeId]),
        currentNodeId: owningManagerNodeId,
        pendingOptionalNodeDecisions: upsertPendingOptionalNodeDecision(
          session.pendingOptionalNodeDecisions ?? [],
          {
            nodeId,
            owningManagerNodeId,
            requestedAt,
            status: "pending",
          },
        ),
      };
      await saveSession(session, options);
      continue;
    }
    const skipOptionalNode =
      isOptionalExecutionNode && pendingOptionalDecision?.status === "skip";
    const executableNodePayload = buildScenarioExecutableNodePayload(
      nodePayload,
      options.mockScenario?.[nodeId] !== undefined,
      options.mockScenario !== undefined,
      options.dryRun === true,
    );
    const agentNodePayload = executableNodePayload;
    const nativeNodePayload =
      executableNodePayload === null &&
      (nodePayload.nodeType === "command" ||
        nodePayload.nodeType === "container" ||
        nodePayload.nodeType === "addon")
        ? nodePayload
        : null;
    if (
      agentNodePayload === null &&
      nativeNodePayload === null &&
      nodePayload.nodeType !== "user-action" &&
      !skipOptionalNode
    ) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: stepAddressedExecution
          ? `step '${nodeId}' is missing executable fields`
          : `node '${nodeId}' is missing executable node fields`,
      };
      await saveSession(failed, options);
      return err(
        workflowRunFailure(
          1,
          failed.lastError ??
            (stepAddressedExecution
              ? "invalid step execution payload"
              : "invalid node execution payload"),
          failed,
        ),
      );
    }

    let restartAttempt = 0;
    let previousNodeExecId: string | undefined;

    for (;;) {
      const nextCount = (session.nodeExecutionCounts[nodeId] ?? 0) + 1;
      const updatedCounts = {
        ...session.nodeExecutionCounts,
        [nodeId]: nextCount,
      };
      const loopRule = loopRuleByJudgeNodeId.get(nodeId);

      const nextExecutionCounter = session.nodeExecutionCounter + 1;
      const nodeExecId = nextNodeExecId(nextExecutionCounter);
      const workflowExecutionRoot = path.join(
        loaded.value.artifactWorkflowRoot,
        "executions",
        session.sessionId,
      );
      const artifactDir = path.join(
        workflowExecutionRoot,
        "nodes",
        nodeId,
        nodeExecId,
      );
      await mkdir(artifactDir, { recursive: true });

      const executionNodePayload = agentNodePayload ?? nodePayload;
      const stepExecutionAddress = resolveStepExecutionAddress(
        workflow,
        nodeId,
      );
      const stepIdentityFields = toStepIdentityFields(stepExecutionAddress);
      const mailboxInstanceId = nodeExecId;
      const mergedVariables = mergeVariables(
        executionNodePayload.variables,
        session.runtimeVariables,
      );
      const upstreamOutputRefs = buildUpstreamOutputRefs(session, nodeId);
      const upstreamInputsResult = await buildUpstreamInputs(
        workflow,
        session,
        nodeId,
      );
      if (!upstreamInputsResult.ok) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: upstreamInputsResult.error,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "upstream communication resolution failed",
            failed,
          ),
        );
      }
      const upstreamInputs = upstreamInputsResult.value;
      const upstreamBindingInputs = upstreamInputs.map((entry) => ({
        fromNodeId: entry.fromNodeId,
        transitionWhen: entry.transitionWhen,
        status: entry.status,
        communicationId: entry.communicationId,
        output: entry.output,
      }));
      const upstreamCommunicationIds = upstreamInputs.map(
        (entry) => entry.communicationId,
      );
      const transcriptInput = (session.conversationTurns ?? []).map((turn) => ({
        conversationId: turn.conversationId,
        turnIndex: turn.turnIndex,
        fromManagerNodeId: turn.fromManagerNodeId,
        toManagerNodeId: turn.toManagerNodeId,
        communicationId: turn.communicationId,
        outputRef: turn.outputRef,
        sentAt: turn.sentAt,
      }));

      let assembledPromptText: string;
      let assembledArguments: Readonly<Record<string, unknown>> | null;
      let executionMailbox:
        | ReturnType<typeof buildNodeExecutionMailbox>
        | undefined;
      try {
        const assembled = assembleNodeInput({
          runtimeVariables: session.runtimeVariables,
          node: executionNodePayload,
          workflowId: workflow.workflowId,
          workflowDescription: workflow.description,
          nodeKind: describeWorkflowNodeKind(nodeRef),
          upstream: upstreamBindingInputs,
          transcript: transcriptInput,
        });
        executionMailbox = buildNodeExecutionMailbox({
          workflow,
          nodeRef,
          node: executionNodePayload,
          ...stepIdentityFields,
          mailboxInstanceId,
          nodePayloads: nodeMap,
          runtimeVariables: session.runtimeVariables,
          basePromptText: assembled.promptText,
          assembledArguments: assembled.arguments,
          upstreamInputs,
        });
        assembledPromptText = assembled.promptText;
        assembledArguments = assembled.arguments;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown input assembly failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `input assembly failed for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            3,
            failed.lastError ?? "input assembly failed",
            failed,
          ),
        );
      }
      if (executionMailbox === undefined) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `input assembly failed for ${executionTargetNoun} '${nodeId}': execution mailbox was not created`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            3,
            failed.lastError ?? "execution mailbox creation failed",
            failed,
          ),
        );
      }

      try {
        await writeNodeExecutionMailboxArtifacts(artifactDir, executionMailbox);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown execution mailbox persistence failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `failed to persist execution mailbox for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "execution mailbox persistence failed",
            failed,
          ),
        );
      }

      const baseInputPayload = {
        sessionId: session.sessionId,
        workflowExecutionId: session.sessionId,
        workflowId: workflow.workflowId,
        nodeId,
        ...stepIdentityFields,
        nodeExecId,
        mailboxInstanceId,
        promptTemplate: executionNodePayload.promptTemplate,
        promptText: assembledPromptText,
        arguments: assembledArguments,
        variables: mergedVariables,
        upstreamOutputRefs,
        upstreamCommunications: upstreamCommunicationIds,
        executionMailbox,
        ...(stepExecutionAddress.promptVariant === undefined
          ? {}
          : { promptVariant: stepExecutionAddress.promptVariant }),
        restartAttempt,
        ...(previousNodeExecId === undefined
          ? {}
          : { restartedFromNodeExecId: previousNodeExecId }),
        dryRun: options.dryRun ?? false,
      };

      if (nodePayload.nodeType === "user-action") {
        const startedAt = nowIso();
        const inputJson = stableJson({
          ...baseInputPayload,
          nodeType: "user-action",
          userAction: nodePayload.userAction,
          outputContract:
            nodePayload.output === undefined
              ? undefined
              : {
                  description: nodePayload.output.description,
                  jsonSchema: nodePayload.output.jsonSchema,
                  maxValidationAttempts:
                    nodePayload.output.maxValidationAttempts,
                },
        });
        await writeRawTextFile(
          path.join(artifactDir, "input.json"),
          `${inputJson}\n`,
        );
        const userActionDir = path.join(artifactDir, "user-action");
        const userActionId = `useract-${nodeExecId}`;
        await mkdir(userActionDir, { recursive: true });
        await writeJsonFile(path.join(userActionDir, "request.json"), {
          userActionId,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          nodeId,
          nodeExecId,
          promptText: assembledPromptText,
          userAction: nodePayload.userAction,
          outputContract: nodePayload.output,
          createdAt: startedAt,
          status: "waiting-for-reply",
        });
        await writeJsonFile(path.join(userActionDir, "resolution.json"), {
          status: "waiting-for-reply",
          updatedAt: startedAt,
        });
        const {
          endedAt: _endedAt,
          lastError: _lastError,
          ...restSession
        } = session;
        const paused: WorkflowSessionState = {
          ...restSession,
          status: "paused",
          queue,
          currentNodeId: nodeId,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          pendingOptionalNodeDecisions: removePendingOptionalNodeDecision(
            session.pendingOptionalNodeDecisions ?? [],
            nodeId,
          ),
          activeUserActions: [
            ...(session.activeUserActions ?? []).filter(
              (entry) => entry.nodeId !== nodeId,
            ),
            {
              nodeId,
              nodeExecId,
              userActionId,
              artifactDir: userActionDir,
              status: "waiting-for-reply",
              pausedAt: startedAt,
            },
          ],
        };
        await saveSession(paused, options);
        return ok({ session: paused, exitCode: 4 });
      }

      if (skipOptionalNode) {
        const startedAt = nowIso();
        const endedAt = startedAt;
        const outputPayload = buildOptionalSkipOutput(
          pendingOptionalDecision?.reason,
        );
        const loopRule = loopRuleByJudgeNodeId.get(nodeId);
        let selected = (outgoingEdges.get(nodeId) ?? []).filter((edge) =>
          evaluateEdge(edge, outputPayload),
        );
        let updatedLoopIterationCounts = session.loopIterationCounts ?? {};
        if (loopRule !== undefined) {
          const effectiveLoopRule: LoopRule = {
            ...loopRule,
            maxIterations: loopRule.maxIterations ?? maxLoopIterations,
          };
          const iteration =
            (session.loopIterationCounts ?? {})[loopRule.id] ?? 0;
          const transition = resolveLoopTransition({
            loopRule: effectiveLoopRule,
            output: outputPayload,
            state: { loopId: loopRule.id, iteration },
          });
          if (transition === "continue") {
            selected = (outgoingEdges.get(nodeId) ?? []).filter(
              (edge) => edge.when === effectiveLoopRule.continueWhen,
            );
            updatedLoopIterationCounts = {
              ...(session.loopIterationCounts ?? {}),
              [loopRule.id]: iteration + 1,
            };
          } else if (transition === "exit") {
            selected = (outgoingEdges.get(nodeId) ?? []).filter(
              (edge) => edge.when === effectiveLoopRule.exitWhen,
            );
          }
        }

        const inputJson = stableJson({
          ...baseInputPayload,
          nodeType: executionNodePayload.nodeType ?? "agent",
          optionalDecision: "skip",
        });
        await writeRawTextFile(
          path.join(artifactDir, "input.json"),
          `${inputJson}\n`,
        );
        const nodeExecution: NodeExecutionRecord = {
          nodeId,
          ...stepIdentityFields,
          nodeExecId,
          mailboxInstanceId,
          status: "skipped",
          artifactDir,
          startedAt,
          endedAt,
          ...(stepExecutionAddress.promptVariant === undefined
            ? {}
            : { promptVariant: stepExecutionAddress.promptVariant }),
        };
        const outputRef = buildOutputRefForExecution({
          workflow,
          session,
          execution: nodeExecution,
        });
        const outputJson = stableJson(outputPayload);
        const outputRaw = `${outputJson}\n`;
        const inputHash = sha256Hex(inputJson);
        const outputHash = sha256Hex(outputJson);
        const nextNodes = selected.map((edge) => edge.to);
        await writeRawTextFile(
          path.join(artifactDir, "output.json"),
          outputRaw,
        );
        await writeJsonFile(path.join(artifactDir, "meta.json"), {
          nodeId,
          ...stepIdentityFields,
          nodeExecId,
          mailboxInstanceId,
          status: "skipped",
          startedAt,
          endedAt,
          ...(stepExecutionAddress.promptVariant === undefined
            ? {}
            : { promptVariant: stepExecutionAddress.promptVariant }),
          optionalDecision: "skip",
        });
        await writeJsonFile(path.join(artifactDir, "handoff.json"), {
          schemaVersion: 1,
          generatedAt: endedAt,
          nodeId,
          ...stepIdentityFields,
          mailboxInstanceId,
          outputRef,
          inputHash: `sha256:${inputHash}`,
          outputHash: `sha256:${outputHash}`,
          nextNodes,
        });
        await writeRawTextFile(
          path.join(artifactDir, "commit-message.txt"),
          `${buildCommitMessageTemplate(inputHash, outputHash, outputRef, nextNodes)}\n`,
        );
        try {
          await saveNodeExecutionToRuntimeDb(
            {
              sessionId: session.sessionId,
              nodeId,
              ...stepIdentityFields,
              nodeExecId,
              mailboxInstanceId,
              status: "skipped",
              artifactDir,
              startedAt,
              endedAt,
              ...(stepExecutionAddress.promptVariant === undefined
                ? {}
                : { promptVariant: stepExecutionAddress.promptVariant }),
              inputJson,
              outputJson,
              inputHash: `sha256:${inputHash}`,
              outputHash: `sha256:${outputHash}`,
            },
            options,
          );
        } catch {
          // runtime DB index is best-effort
        }

        const consumedCommunicationsResult = await markCommunicationsConsumed(
          session,
          upstreamCommunicationIds,
          nodeExecId,
          endedAt,
        );
        if (!consumedCommunicationsResult.ok) {
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions: [...session.nodeExecutions, nodeExecution],
            lastError: consumedCommunicationsResult.error,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message:
              failed.lastError ?? "mailbox consumption persistence failed",
          });
        }
        let currentCommunications = consumedCommunicationsResult.value;
        const transitionCommunications = await Promise.all(
          selected.map((edge, index) => {
            return persistCommunicationArtifact({
              artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
              runtimeLogOptions: options,
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              communicationCounter: session.communicationCounter + index,
              fromNodeId: edge.from,
              toNodeId: edge.to,
              routingScope: "intra-workflow",
              deliveryKind:
                edge.to === edge.from ? "loop-back" : "edge-transition",
              transitionWhen: edge.when,
              sourceNodeExecId: nodeExecId,
              payloadRef: outputRef,
              outputRaw,
              deliveredByNodeId: resolveWorkflowManagerRuntimeId(workflow),
              createdAt: endedAt,
            });
          }),
        );
        currentCommunications = [
          ...currentCommunications,
          ...transitionCommunications,
        ];
        session = {
          ...session,
          status: "running",
          queue: dedupeNodeIds([...queue, ...nextNodes]),
          currentNodeId: nodeId,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          loopIterationCounts: updatedLoopIterationCounts,
          transitions: [
            ...session.transitions,
            ...selected.map((edge) => ({
              from: edge.from,
              to: edge.to,
              when: edge.when,
            })),
          ],
          nodeExecutions: [...session.nodeExecutions, nodeExecution],
          communicationCounter:
            session.communicationCounter + transitionCommunications.length,
          communications: currentCommunications,
          runtimeVariables: isWorkflowOutputKindNode(workflow, nodeId)
            ? {
                ...session.runtimeVariables,
                workflowOutput: outputPayload["payload"],
              }
            : session.runtimeVariables,
          pendingOptionalNodeDecisions: removePendingOptionalNodeDecision(
            session.pendingOptionalNodeDecisions ?? [],
            nodeId,
          ),
        };
        await saveSession(session, options);
        break;
      }

      if (agentNodePayload === null && nativeNodePayload === null) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: stepAddressedExecution
            ? `step '${nodeId}' is missing agent execution fields`
            : `node '${nodeId}' is missing agent execution fields`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ??
              (stepAddressedExecution
                ? "invalid step execution payload"
                : "invalid node execution payload"),
            failed,
          ),
        );
      }

      const backendSessionSelection =
        agentNodePayload === null
          ? undefined
          : resolveBackendSessionSelection(
              stepExecutionAddress,
              agentNodePayload,
            );
      const backendSessionIdentityFields =
        backendSessionSelection === undefined
          ? undefined
          : toStepIdentityFields(backendSessionSelection);
      let backendSession =
        agentNodePayload === null
          ? undefined
          : resolveRequestedBackendSession({
              session,
              node: agentNodePayload,
              ...(backendSessionSelection?.sessionLookupNodeId === undefined
                ? {}
                : {
                    sessionLookupNodeId:
                      backendSessionSelection.sessionLookupNodeId,
                  }),
              ...(backendSessionSelection?.nodeRegistryId === undefined
                ? {}
                : { nodeRegistryId: backendSessionSelection.nodeRegistryId }),
              ...(backendSessionSelection?.inheritFromStepId === undefined
                ? {}
                : {
                    inheritFromStepId:
                      backendSessionSelection.inheritFromStepId,
                  }),
            });
      const composedPrompts = composeExecutionPrompts({
        promptComposition: {
          workflow,
          nodeRef,
          node: executionNodePayload,
          nodePayloads: nodeMap,
          runtimeVariables: session.runtimeVariables,
          basePromptText: assembledPromptText,
          assembledArguments,
          upstreamInputs,
          executionMailbox,
        },
        includeSessionStartPrompt:
          agentNodePayload !== null && backendSession?.mode !== "reuse",
      });
      const effectivePromptText = composedPrompts.promptText;
      const systemPromptText = composedPrompts.systemPromptText;
      const requestedBackendSessionMode = backendSession?.mode;
      let backendSessionId: string | undefined = backendSession?.sessionId;
      let backendSessionProvider: string | undefined;

      const inputPayload = {
        ...baseInputPayload,
        nodeType: executionNodePayload.nodeType ?? "agent",
        ...(agentNodePayload === null ? {} : { model: agentNodePayload.model }),
        ...(agentNodePayload?.systemPromptTemplate === undefined
          ? {}
          : { systemPromptTemplate: agentNodePayload.systemPromptTemplate }),
        ...(agentNodePayload?.sessionStartPromptTemplate === undefined
          ? {}
          : {
              sessionStartPromptTemplate:
                agentNodePayload.sessionStartPromptTemplate,
            }),
        ...(systemPromptText === undefined ? {} : { systemPromptText }),
        promptText: effectivePromptText,
        outputContract:
          executionNodePayload.output === undefined
            ? undefined
            : {
                description: executionNodePayload.output.description,
                jsonSchema: executionNodePayload.output.jsonSchema,
                maxValidationAttempts:
                  resolveOutputValidationAttempts(executionNodePayload),
                publication: buildOutputPublicationPolicy(),
              },
        ...(backendSession === undefined ? {} : { backendSession }),
      };
      const inputJson = stableJson(inputPayload);
      await writeRawTextFile(
        path.join(artifactDir, "input.json"),
        `${inputJson}\n`,
      );

      const startedAt = nowIso();
      const resolvedTimeout = resolveTimeoutMs({
        node: executionNodePayload,
        workflowTimeoutMs:
          options.defaultTimeoutMs ?? workflow.defaults.nodeTimeoutMs,
        ...(stepExecutionAddress.timeoutMs === undefined
          ? {}
          : { stepTimeoutMs: stepExecutionAddress.timeoutMs }),
      });
      const baseTimeoutMs = resolvedTimeout.timeoutMs;
      const timeoutPolicy = workflow.defaults.timeoutPolicy;
      const timeoutIncrementMs = timeoutPolicy?.retryTimeoutIncrementMs ?? 0;
      const applyTimeoutIncrement =
        timeoutIncrementMs > 0 &&
        restartAttempt > 0 &&
        timeoutPolicy !== undefined &&
        (timeoutPolicy.onTimeout === "retry-same-step" ||
          timeoutPolicy.onTimeout === "jump-to-step");
      const timeoutMs =
        baseTimeoutMs +
        (applyTimeoutIncrement ? timeoutIncrementMs * restartAttempt : 0);
      let ambientManagerContext: AdapterAmbientManagerContext | undefined;
      let managerSessionId: string | undefined;

      if (isManagerNodeRef(nodeRef) && options.dryRun !== true) {
        managerSessionId = nextManagerSessionId(nodeExecId);
        const managerAuthToken = mintManagerAuthToken();
        const activeManagerSessionExpiresAt = addMillisecondsToIso(
          startedAt,
          timeoutMs + 5 * 60_000,
        );
        ambientManagerContext = {
          environment: buildAmbientManagerControlPlaneEnvironment({
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            managerNodeId: nodeId,
            managerNodeExecId: nodeExecId,
            managerSessionId,
            authToken: managerAuthToken,
            ...(options.env === undefined ? {} : { env: options.env }),
          }),
        };
        try {
          await managerSessionStore.createOrResumeSession({
            managerSessionId,
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            managerNodeId: nodeId,
            managerNodeExecId: nodeExecId,
            status: "active",
            createdAt: startedAt,
            updatedAt: startedAt,
            authTokenHash: hashManagerAuthToken(managerAuthToken),
            authTokenExpiresAt: activeManagerSessionExpiresAt,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : "unknown manager session persistence failure";
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt: startedAt,
            lastError: `failed to start manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "failed to start manager session",
          });
        }
      }

      let outputPayload: Readonly<Record<string, unknown>>;
      let nodeStatus: NodeExecutionRecord["status"] = "succeeded";
      let outputValidationErrors: readonly JsonSchemaValidationError[] = [];
      let outputAttemptCount = 1;
      let processLogs: readonly AdapterProcessLog[] = [];

      if (options.dryRun === true) {
        outputPayload = {
          provider: "dry-run",
          model:
            agentNodePayload?.model ??
            `${executionNodePayload.nodeType ?? "agent"}-dry-run`,
          ...(systemPromptText === undefined ? {} : { systemPromptText }),
          promptText: effectivePromptText,
          completionPassed: true,
          when: { always: true },
          payload: { skippedExecution: true },
        };
      } else {
        let finalizedOutput: Readonly<Record<string, unknown>> | undefined;
        const hasOutputContract = executionNodePayload.output !== undefined;
        const maxOutputAttempts = hasOutputContract
          ? resolveOutputValidationAttempts(executionNodePayload)
          : 1;

        for (
          let outputAttempt = 1;
          outputAttempt <= maxOutputAttempts;
          outputAttempt += 1
        ) {
          outputAttemptCount = outputAttempt;
          const outputAttemptId = hasOutputContract
            ? nextOutputAttemptId(outputAttempt)
            : undefined;
          const attemptDir =
            outputAttemptId === undefined
              ? undefined
              : path.join(artifactDir, "output-attempts", outputAttemptId);
          const candidateArtifactPath =
            attemptDir === undefined
              ? undefined
              : path.join(attemptDir, "candidate.json");
          const candidatePath =
            outputAttemptId === undefined || agentNodePayload === null
              ? undefined
              : buildReservedCandidateSubmissionPath({
                  workflowId: workflow.workflowId,
                  workflowExecutionId: session.sessionId,
                  nodeId,
                  nodeExecId,
                  outputAttemptId,
                });
          const requestPath =
            attemptDir === undefined
              ? undefined
              : path.join(attemptDir, "request.json");
          const validationPath =
            attemptDir === undefined
              ? undefined
              : path.join(attemptDir, "validation.json");
          if (
            attemptDir !== undefined &&
            candidatePath !== undefined &&
            requestPath !== undefined
          ) {
            await mkdir(attemptDir, { recursive: true });
            await mkdir(path.dirname(candidatePath), { recursive: true });
            await rm(candidatePath, { force: true });
          }
          const executionPromptText =
            candidatePath === undefined || agentNodePayload === null
              ? effectivePromptText
              : buildOutputPromptText({
                  basePromptText: effectivePromptText,
                  node: agentNodePayload,
                  candidatePath,
                  validationErrors: outputValidationErrors,
                });
          const retryValidationFeedback = buildRetryValidationFeedback(
            outputValidationErrors,
          );
          if (requestPath !== undefined && candidatePath !== undefined) {
            await writeJsonFile(requestPath, {
              attempt: outputAttempt,
              promptText: executionPromptText,
              candidatePath,
              validationErrors: retryValidationFeedback,
            });
          }
          try {
            const contractCandidatePath = hasOutputContract
              ? candidatePath
              : undefined;
            if (
              hasOutputContract &&
              agentNodePayload !== null &&
              contractCandidatePath === undefined
            ) {
              throw new Error(
                "candidate path must exist when node.output is configured",
              );
            }
            const adapterOutputContract =
              !hasOutputContract ||
              agentNodePayload === null ||
              agentNodePayload.output === undefined
                ? undefined
                : {
                    ...(agentNodePayload.output.description === undefined
                      ? {}
                      : { description: agentNodePayload.output.description }),
                    ...(agentNodePayload.output.jsonSchema === undefined
                      ? {}
                      : { jsonSchema: agentNodePayload.output.jsonSchema }),
                    maxValidationAttempts: maxOutputAttempts,
                    attempt: outputAttempt,
                    candidatePath: contractCandidatePath!,
                    validationErrors: retryValidationFeedback,
                    publication: buildOutputPublicationPolicy(),
                  };
            const supervisionStall = buildSupervisionStallWatch(
              session,
              options,
            );
            const execution =
              agentNodePayload !== null
                ? await executeAdapterWithTimeout(
                    effectiveAdapter,
                    {
                      workflowId: workflow.workflowId,
                      workflowExecutionId: session.sessionId,
                      nodeId,
                      nodeExecId,
                      node: agentNodePayload,
                      workingDirectory: resolveNodeExecutionWorkingDirectory(
                        workflowWorkingDirectory,
                        agentNodePayload.workingDirectory,
                      ),
                      mergedVariables,
                      ...(systemPromptText === undefined
                        ? {}
                        : { systemPromptText }),
                      promptText: executionPromptText,
                      arguments: assembledArguments,
                      executionIndex: nextCount,
                      artifactDir,
                      upstreamCommunicationIds,
                      executionMailbox,
                      divedraHookContext: buildAdapterDivedraHookContext({
                        workflowId: workflow.workflowId,
                        workflowExecutionId: session.sessionId,
                        nodeId,
                        nodeExecId,
                        ...(agentNodePayload.executionBackend === undefined
                          ? {}
                          : {
                              agentBackend: agentNodePayload.executionBackend,
                            }),
                      }),
                      ...(backendSession === undefined
                        ? {}
                        : { backendSession }),
                      ...(ambientManagerContext === undefined
                        ? {}
                        : { ambientManagerContext }),
                      ...(adapterOutputContract === undefined
                        ? {}
                        : { output: adapterOutputContract }),
                    },
                    timeoutMs,
                    supervisionStall,
                  )
                : await executeNativeNodeWithTimeout({
                    workflowDirectory: loaded.value.workflowDirectory,
                    workflowWorkingDirectory,
                    artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
                    workflowId: workflow.workflowId,
                    workflowDescription: workflow.description,
                    workflowExecutionId: session.sessionId,
                    nodeId,
                    nodeExecId,
                    node: executionNodePayload,
                    workflowDefaults: workflow.defaults,
                    runtimeVariables: session.runtimeVariables,
                    mergedVariables,
                    arguments: assembledArguments,
                    artifactDir,
                    executionMailbox,
                    ...(options.eventReplyDispatcher === undefined
                      ? {}
                      : { chatReplyDispatcher: options.eventReplyDispatcher }),
                    ...(options.env === undefined ? {} : { env: options.env }),
                    ...(options.superviserControl === undefined
                      ? {}
                      : { superviserControl: options.superviserControl }),
                    timeoutMs,
                    ...(supervisionStall === undefined
                      ? {}
                      : { supervisionStall }),
                  });

            if (!execution.ok) {
              processLogs = [
                ...processLogs,
                ...(execution.error.processLogs ?? []),
              ];
              if (
                execution.error.code === "invalid_output" &&
                hasOutputContract &&
                validationPath !== undefined
              ) {
                outputValidationErrors = [
                  { path: "$", message: execution.error.message },
                ];
                await writeJsonFile(validationPath, {
                  valid: false,
                  errors: outputValidationErrors,
                  rejectedAt: nowIso(),
                });

                if (outputAttempt === maxOutputAttempts) {
                  nodeStatus = "failed";
                  finalizedOutput = {
                    provider: "deterministic-local",
                    model:
                      agentNodePayload?.model ??
                      executionNodePayload.nodeType ??
                      "node",
                    promptText: effectivePromptText,
                    completionPassed: false,
                    when: {},
                    payload: {},
                    error: "output_validation_failed",
                    validationErrors: outputValidationErrors,
                  };
                  break;
                }

                continue;
              }

              outputValidationErrors = [];
              nodeStatus =
                execution.error.code === "timeout" ? "timed_out" : "failed";
              finalizedOutput = {
                provider: "deterministic-local",
                model:
                  agentNodePayload?.model ??
                  executionNodePayload.nodeType ??
                  "node",
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload:
                  execution.error.code === "provider_error" &&
                  execution.error.message.length > 0
                    ? { providerErrorMessage: execution.error.message }
                    : {},
                error: execution.error.code,
              };
              break;
            }

            backendSessionProvider = execution.value.provider;
            processLogs = [
              ...processLogs,
              ...(execution.value.processLogs ?? []),
            ];
            if (execution.value.backendSession?.sessionId !== undefined) {
              backendSession = {
                mode: "reuse",
                sessionId: execution.value.backendSession.sessionId,
              };
              backendSessionId = execution.value.backendSession.sessionId;
            }

            if (
              !hasOutputContract &&
              execution.value.candidateFilePath !== undefined
            ) {
              outputValidationErrors = [
                { path: "$", message: NON_CONTRACT_CANDIDATE_FILE_ERROR },
              ];
              nodeStatus = "failed";
              finalizedOutput = {
                provider: execution.value.provider,
                model: execution.value.model,
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: "invalid_output",
                validationErrors: outputValidationErrors,
              };
              break;
            }

            if (!hasOutputContract) {
              finalizedOutput = {
                provider: execution.value.provider,
                model: execution.value.model,
                promptText: effectivePromptText,
                completionPassed: execution.value.completionPassed,
                when: execution.value.when,
                payload: execution.value.payload,
              };
              break;
            }
            const candidateResult =
              contractCandidatePath === undefined
                ? ok(execution.value.payload)
                : await resolveCandidatePayload({
                    expectedCandidatePath: contractCandidatePath,
                    execution: execution.value,
                  });
            if (!candidateResult.ok) {
              outputValidationErrors = [
                { path: "$", message: candidateResult.error.message },
              ];
              if (validationPath !== undefined) {
                await writeJsonFile(validationPath, {
                  valid: false,
                  errors: outputValidationErrors,
                  rejectedAt: nowIso(),
                });
              }

              if (
                candidateResult.error.retryable &&
                outputAttempt < maxOutputAttempts
              ) {
                continue;
              }

              nodeStatus = "failed";
              finalizedOutput = {
                provider: execution.value.provider,
                model: execution.value.model,
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: candidateResult.error.retryable
                  ? "output_validation_failed"
                  : "invalid_output",
                validationErrors: outputValidationErrors,
              };
              break;
            }

            if (candidateArtifactPath !== undefined) {
              await writeJsonFile(candidateArtifactPath, candidateResult.value);
            }
            const schema = executionNodePayload.output?.jsonSchema;
            const validationErrors =
              schema === undefined
                ? []
                : validateJsonValueAgainstSchema({
                    schema: schema as JsonObject,
                    value: candidateResult.value,
                  });
            outputValidationErrors = validationErrors;
            if (validationPath !== undefined) {
              await writeJsonFile(validationPath, {
                valid: validationErrors.length === 0,
                errors: validationErrors,
                validatedAt: nowIso(),
              });
            }
            if (validationErrors.length === 0) {
              finalizedOutput = {
                provider: execution.value.provider,
                model: execution.value.model,
                promptText: effectivePromptText,
                completionPassed: execution.value.completionPassed,
                when: execution.value.when,
                payload: candidateResult.value,
              };
              break;
            }

            if (outputAttempt === maxOutputAttempts) {
              nodeStatus = "failed";
              finalizedOutput = {
                provider: execution.value.provider,
                model: execution.value.model,
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: "output_validation_failed",
                validationErrors,
              };
              break;
            }
          } finally {
            if (candidatePath !== undefined) {
              await cleanupReservedCandidateSubmissionPath(candidatePath);
            }
          }
        }

        outputPayload = finalizedOutput ?? {
          provider: "deterministic-local",
          model:
            agentNodePayload?.model ?? executionNodePayload.nodeType ?? "node",
          promptText: effectivePromptText,
          completionPassed: false,
          when: {},
          payload: {},
          error: "provider_error",
        };
      }

      const endedAt = nowIso();
      try {
        await saveProcessLogsToRuntimeDb(
          {
            sessionId: session.sessionId,
            nodeId,
            nodeExecId,
            processLogs,
            at: endedAt,
            ...(stepExecutionAddress.stepId === undefined
              ? {}
              : { executionLogTarget: "step" as const }),
          },
          options,
        );
      } catch {
        // runtime DB process logs are best-effort
      }
      const nextNodeBackendSessions =
        agentNodePayload === null
          ? (session.nodeBackendSessions ?? {})
          : persistNodeBackendSession({
              session,
              node: agentNodePayload,
              nodeExecId,
              ...(backendSessionIdentityFields ?? {}),
              ...(backendSessionSelection?.inheritFromStepId === undefined
                ? {}
                : {
                    inheritFromStepId:
                      backendSessionSelection.inheritFromStepId,
                  }),
              provider:
                backendSessionProvider ??
                outputPayload["provider"]?.toString() ??
                "unknown-provider",
              endedAt,
              backendSession,
              ...(backendSessionId === undefined
                ? {}
                : { returnedSessionId: backendSessionId }),
            });
      const buildNodeExecutionRecord = (
        status: NodeExecutionRecord["status"] = nodeStatus,
      ): NodeExecutionRecord => ({
        nodeId,
        ...stepIdentityFields,
        nodeExecId,
        mailboxInstanceId,
        status,
        artifactDir,
        startedAt,
        endedAt,
        ...(restartAttempt === 0 ? {} : { attempt: restartAttempt + 1 }),
        ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
        ...(outputValidationErrors.length === 0
          ? {}
          : { outputValidationErrors }),
        ...(backendSessionId === undefined ? {} : { backendSessionId }),
        ...(requestedBackendSessionMode === undefined
          ? {}
          : { backendSessionMode: requestedBackendSessionMode }),
        ...(previousNodeExecId === undefined
          ? {}
          : { restartedFromNodeExecId: previousNodeExecId }),
        ...(stepExecutionAddress.promptVariant === undefined
          ? {}
          : { promptVariant: stepExecutionAddress.promptVariant }),
        timeoutMs,
      });
      const buildNodeExecutions = (
        status: NodeExecutionRecord["status"] = nodeStatus,
      ): readonly NodeExecutionRecord[] => [
        ...session.nodeExecutions,
        buildNodeExecutionRecord(status),
      ];
      const finalizeManagerSession = async (
        finalStatus: "completed" | "failed" | "cancelled",
      ): Promise<void> => {
        if (
          managerSessionId === undefined ||
          ambientManagerContext === undefined
        ) {
          return;
        }
        await managerSessionStore.createOrResumeSession({
          managerSessionId,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          managerNodeId: nodeId,
          managerNodeExecId: nodeExecId,
          status: finalStatus,
          createdAt: startedAt,
          updatedAt: endedAt,
          authTokenHash: hashManagerAuthToken(
            ambientManagerContext.environment.DIVEDRA_MANAGER_AUTH_TOKEN,
          ),
          authTokenExpiresAt: endedAt,
        });
      };
      let managerControl = null;
      if (isManagerNodeRef(nodeRef)) {
        try {
          const businessPayload = readBusinessPayload(outputPayload);
          managerControl =
            businessPayload === null
              ? null
              : parseManagerControlPayload(businessPayload, workflow, {
                  managerRuntimeId: nodeId,
                  ...(nodeRef.role === undefined
                    ? {}
                    : { managerRole: nodeRef.role }),
                });
        } catch (error: unknown) {
          nodeStatus = "failed";
          const nodeExecutions = buildNodeExecutions();
          try {
            await finalizeManagerSession("failed");
          } catch (finalizationError: unknown) {
            const message =
              finalizationError instanceof Error
                ? finalizationError.message
                : "unknown manager session finalization failure";
            const failed: WorkflowSessionState = {
              ...session,
              queue,
              status: "failed",
              currentNodeId: nodeId,
              endedAt,
              nodeExecutionCounter: nextExecutionCounter,
              nodeExecutionCounts: updatedCounts,
              nodeExecutions,
              communicationCounter: session.communicationCounter,
              communications: session.communications,
              nodeBackendSessions: nextNodeBackendSessions,
              lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 1,
              message: failed.lastError ?? "failed to finalize manager session",
            });
          }
          const message =
            error instanceof Error
              ? error.message
              : "unknown manager control parsing failure";
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: session.communicationCounter,
            communications: session.communications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 5,
            message: failed.lastError ?? "invalid manager control",
          });
        }
        if (managerControl !== null && managerSessionId !== undefined) {
          try {
            const claimedMode = await managerSessionStore.claimControlMode({
              managerSessionId,
              controlMode: "payload-manager-control",
              updatedAt: endedAt,
            });
            if (claimedMode !== "payload-manager-control") {
              nodeStatus = "failed";
              const nodeExecutions = buildNodeExecutions();
              try {
                await finalizeManagerSession("failed");
              } catch (finalizationError: unknown) {
                const message =
                  finalizationError instanceof Error
                    ? finalizationError.message
                    : "unknown manager session finalization failure";
                const failed: WorkflowSessionState = {
                  ...session,
                  queue,
                  status: "failed",
                  currentNodeId: nodeId,
                  endedAt,
                  nodeExecutionCounter: nextExecutionCounter,
                  nodeExecutionCounts: updatedCounts,
                  nodeExecutions,
                  communicationCounter: session.communicationCounter,
                  communications: session.communications,
                  nodeBackendSessions: nextNodeBackendSessions,
                  lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
                };
                await saveSession(failed, options);
                return err({
                  exitCode: 1,
                  message:
                    failed.lastError ?? "failed to finalize manager session",
                });
              }
              const failed: WorkflowSessionState = {
                ...session,
                queue,
                status: "failed",
                currentNodeId: nodeId,
                endedAt,
                nodeExecutionCounter: nextExecutionCounter,
                nodeExecutionCounts: updatedCounts,
                nodeExecutions,
                communicationCounter: session.communicationCounter,
                communications: session.communications,
                nodeBackendSessions: nextNodeBackendSessions,
                lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': manager execution cannot mix GraphQL manager messages with payload managerControl`,
              };
              await saveSession(failed, options);
              return err({
                exitCode: 5,
                message: failed.lastError ?? "invalid manager control",
              });
            }
          } catch (error: unknown) {
            nodeStatus = "failed";
            const nodeExecutions = buildNodeExecutions();
            try {
              await finalizeManagerSession("failed");
            } catch (finalizationError: unknown) {
              const message =
                finalizationError instanceof Error
                  ? finalizationError.message
                  : "unknown manager session finalization failure";
              const failed: WorkflowSessionState = {
                ...session,
                queue,
                status: "failed",
                currentNodeId: nodeId,
                endedAt,
                nodeExecutionCounter: nextExecutionCounter,
                nodeExecutionCounts: updatedCounts,
                nodeExecutions,
                communicationCounter: session.communicationCounter,
                communications: session.communications,
                nodeBackendSessions: nextNodeBackendSessions,
                lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
              };
              await saveSession(failed, options);
              return err({
                exitCode: 1,
                message:
                  failed.lastError ?? "failed to finalize manager session",
              });
            }
            const message =
              error instanceof Error
                ? error.message
                : "unknown manager control mode claim failure";
            const failed: WorkflowSessionState = {
              ...session,
              queue,
              status: "failed",
              currentNodeId: nodeId,
              endedAt,
              nodeExecutionCounter: nextExecutionCounter,
              nodeExecutionCounts: updatedCounts,
              nodeExecutions,
              communicationCounter: session.communicationCounter,
              communications: session.communications,
              nodeBackendSessions: nextNodeBackendSessions,
              lastError: `invalid manager control for ${executionTargetNoun} '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 5,
              message: failed.lastError ?? "invalid manager control",
            });
          }
        }
      }
      const optionalManagerDecisionsResult = applyOptionalManagerDecisions({
        managerControl,
        session,
        workflow,
        managerRuntimeId: nodeId,
        managerNodeExecId: nodeExecId,
        decidedAt: endedAt,
      });
      if (!optionalManagerDecisionsResult.ok) {
        nodeStatus = "failed";
        const nodeExecutions = buildNodeExecutions();
        try {
          await finalizeManagerSession("failed");
        } catch (finalizationError: unknown) {
          const message =
            finalizationError instanceof Error
              ? finalizationError.message
              : "unknown manager session finalization failure";
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: session.communicationCounter,
            communications: session.communications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "failed to finalize manager session",
          });
        }
        await saveSession(
          {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions,
            communicationCounter: session.communicationCounter,
            communications: session.communications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: optionalManagerDecisionsResult.error,
          },
          options,
        );
        return err({
          exitCode: 5,
          message: optionalManagerDecisionsResult.error,
        });
      }
      const queuedOptionalDecisionNodeIds =
        optionalManagerDecisionsResult.value.queuedNodeIds;
      const pendingOptionalNodeDecisionsAfterManagerActions =
        optionalManagerDecisionsResult.value.pendingOptionalNodeDecisions;
      const nodeExecutions = buildNodeExecutions();
      try {
        await finalizeManagerSession(
          nodeStatus === "succeeded" ? "completed" : "failed",
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "unknown manager session finalization failure";
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: session.communicationCounter,
          communications: session.communications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: `failed to finalize manager session for ${executionTargetNoun} '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "failed to finalize manager session",
            failed,
          ),
        );
      }
      const edges = outgoingEdges.get(nodeId) ?? [];
      const matched = edges.filter((edge) => evaluateEdge(edge, outputPayload));
      const loopIterationCounts = session.loopIterationCounts ?? {};
      let selected = matched;
      let updatedLoopIterationCounts = loopIterationCounts;
      if (loopRule !== undefined) {
        const effectiveLoopRule: LoopRule = {
          ...loopRule,
          maxIterations: loopRule.maxIterations ?? maxLoopIterations,
        };
        const iteration = loopIterationCounts[loopRule.id] ?? 0;
        const transition = resolveLoopTransition({
          loopRule: effectiveLoopRule,
          output: outputPayload,
          state: { loopId: loopRule.id, iteration },
        });
        if (transition === "continue") {
          selected = edges.filter(
            (edge) => edge.when === effectiveLoopRule.continueWhen,
          );
          updatedLoopIterationCounts = {
            ...loopIterationCounts,
            [loopRule.id]: iteration + 1,
          };
        } else if (transition === "exit") {
          selected = edges.filter(
            (edge) => edge.when === effectiveLoopRule.exitWhen,
          );
        } else {
          selected = matched.filter(
            (edge) =>
              edge.when !== effectiveLoopRule.continueWhen &&
              edge.when !== effectiveLoopRule.exitWhen,
          );
        }

        if (selected.length === 0 && transition !== "none") {
          const failed: WorkflowSessionState = {
            ...session,
            queue,
            status: "failed",
            currentNodeId: nodeId,
            endedAt,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            nodeExecutions: [
              ...session.nodeExecutions,
              buildNodeExecutionRecord(),
            ],
            loopIterationCounts: updatedLoopIterationCounts,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `loop transition '${transition}' has no matching edge for ${executionTargetNoun} '${nodeId}'`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 4,
            message: failed.lastError ?? "invalid loop transition",
          });
        }
      }
      const nextNodes = selected.map((edge) => edge.to);

      const outputJson = stableJson(outputPayload);
      const outputRaw = `${outputJson}\n`;
      const metaPayload = {
        nodeId,
        ...stepIdentityFields,
        nodeExecId,
        mailboxInstanceId,
        status: nodeStatus,
        startedAt,
        endedAt,
        model: executionNodePayload.model,
        timeoutMs,
        ...(stepExecutionAddress.promptVariant === undefined
          ? {}
          : { promptVariant: stepExecutionAddress.promptVariant }),
        restartAttempt,
        outputAttemptCount,
        ...(backendSessionId === undefined ? {} : { backendSessionId }),
        ...(requestedBackendSessionMode === undefined
          ? {}
          : { backendSessionMode: requestedBackendSessionMode }),
        ...(outputValidationErrors.length === 0
          ? {}
          : { outputValidationErrors }),
        ...(previousNodeExecId === undefined
          ? {}
          : { restartedFromNodeExecId: previousNodeExecId }),
      };
      const outputRef = buildOutputRefForExecution({
        workflow,
        session: { ...session, workflowId: workflow.workflowId },
        execution: {
          nodeId,
          ...stepIdentityFields,
          nodeExecId,
          mailboxInstanceId,
          status: nodeStatus,
          artifactDir,
          startedAt,
          endedAt,
          ...(stepExecutionAddress.promptVariant === undefined
            ? {}
            : { promptVariant: stepExecutionAddress.promptVariant }),
          timeoutMs,
        },
      });
      const inputHash = sha256Hex(inputJson);
      const outputHash = sha256Hex(outputJson);
      let currentCommunications: readonly CommunicationRecord[] =
        session.communications;
      let currentCommunicationCounter = session.communicationCounter;
      const currentRuntimeVariables = isWorkflowOutputKindNode(workflow, nodeId)
        ? {
            ...session.runtimeVariables,
            workflowOutput: outputPayload["payload"],
          }
        : session.runtimeVariables;

      const handoffPayload = {
        schemaVersion: 1,
        generatedAt: endedAt,
        nodeId,
        ...stepIdentityFields,
        mailboxInstanceId,
        outputRef,
        inputHash: `sha256:${inputHash}`,
        outputHash: `sha256:${outputHash}`,
        nextNodes,
      };
      const commitMessageTemplate = buildCommitMessageTemplate(
        inputHash,
        outputHash,
        outputRef,
        nextNodes,
      );

      await writeRawTextFile(path.join(artifactDir, "output.json"), outputRaw);
      await writeJsonFile(path.join(artifactDir, "meta.json"), metaPayload);
      await writeJsonFile(
        path.join(artifactDir, "handoff.json"),
        handoffPayload,
      );
      await writeRawTextFile(
        path.join(artifactDir, "commit-message.txt"),
        `${commitMessageTemplate}\n`,
      );

      try {
        await saveNodeExecutionToRuntimeDb(
          {
            sessionId: session.sessionId,
            nodeId,
            ...stepIdentityFields,
            nodeExecId,
            mailboxInstanceId,
            status: nodeStatus,
            artifactDir,
            startedAt,
            endedAt,
            ...(restartAttempt === 0 ? {} : { attempt: restartAttempt + 1 }),
            ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
            ...(outputValidationErrors.length === 0
              ? {}
              : { outputValidationErrors }),
            ...(stepExecutionAddress.promptVariant === undefined
              ? {}
              : { promptVariant: stepExecutionAddress.promptVariant }),
            timeoutMs,
            ...(requestedBackendSessionMode === undefined
              ? {}
              : { backendSessionMode: requestedBackendSessionMode }),
            ...(backendSessionId === undefined ? {} : { backendSessionId }),
            ...(previousNodeExecId === undefined
              ? {}
              : { restartedFromNodeExecId: previousNodeExecId }),
            inputJson,
            outputJson,
            inputHash: `sha256:${inputHash}`,
            outputHash: `sha256:${outputHash}`,
          },
          options,
        );
      } catch {
        // runtime DB index is best-effort and must not break artifact/session persistence
      }

      if (nodeStatus === "timed_out") {
        const authoredTimeoutPolicy = workflow.defaults.timeoutPolicy;
        if (
          options.restartOnStuck !== false &&
          authoredTimeoutPolicy?.onTimeout === "jump-to-step" &&
          authoredTimeoutPolicy.jumpStepId !== undefined
        ) {
          const retriesBeforeJump = authoredTimeoutPolicy.maxRetries ?? 0;
          if (restartAttempt >= retriesBeforeJump) {
            const jumpId = authoredTimeoutPolicy.jumpStepId;
            if (!workflowNodes.has(jumpId)) {
              const failed: WorkflowSessionState = {
                ...session,
                queue,
                status: "failed",
                currentNodeId: nodeId,
                endedAt,
                nodeExecutionCounter: nextExecutionCounter,
                nodeExecutionCounts: updatedCounts,
                nodeExecutions,
                communicationCounter: currentCommunicationCounter,
                communications: currentCommunications,
                nodeBackendSessions: nextNodeBackendSessions,
                lastError: `${executionTargetNoun} timeout at '${nodeId}': timeout policy jump target '${jumpId}' is not a known workflow ${executionTargetNoun}`,
              };
              await saveSession(failed, options);
              return err({
                exitCode: 6,
                message: failed.lastError ?? `${executionTargetNoun} timeout`,
              });
            }
            session = {
              ...session,
              status: "running",
              queue: [...dedupeNodeIds([jumpId, ...queue])],
              currentNodeId: nodeId,
              nodeExecutionCounter: nextExecutionCounter,
              nodeExecutionCounts: updatedCounts,
              nodeExecutions,
              communicationCounter: currentCommunicationCounter,
              communications: currentCommunications,
              nodeBackendSessions: nextNodeBackendSessions,
              lastError: `${executionTargetNoun} timeout at '${nodeId}', jumping to '${jumpId}'`,
            };
            await saveSession(session, options);
            break;
          }
        }

        const { allowRestart, maxRestarts } = resolveTimeoutRestartBudget(
          authoredTimeoutPolicy,
          options,
          restartAttempt,
        );
        if (allowRestart && restartAttempt < maxRestarts) {
          const restartCountForNode =
            (session.restartCounts?.[nodeId] ?? 0) + 1;
          const restartEvents = [
            ...(session.restartEvents ?? []),
            {
              nodeId,
              fromNodeExecId: nodeExecId,
              restartAttempt: restartAttempt + 1,
              reason: "stuck_timeout" as const,
              at: endedAt,
            },
          ];

          session = {
            ...session,
            status: "running",
            queue,
            currentNodeId: nodeId,
            nodeExecutionCounter: nextExecutionCounter,
            nodeExecutionCounts: updatedCounts,
            restartCounts: {
              ...(session.restartCounts ?? {}),
              [nodeId]: restartCountForNode,
            },
            restartEvents,
            nodeExecutions,
            communicationCounter: currentCommunicationCounter,
            communications: currentCommunications,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `stuck detected for ${executionTargetNoun} '${nodeId}', restarting attempt ${restartAttempt + 1}`,
          };
          await saveSession(session, options);

          previousNodeExecId = nodeExecId;
          restartAttempt += 1;
          if (stuckRestartBackoffMs > 0) {
            await sleep(stuckRestartBackoffMs);
          }
          continue;
        }

        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: `${executionTargetNoun} timeout at '${nodeId}'`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            6,
            failed.lastError ?? `${executionTargetNoun} timeout`,
            failed,
          ),
        );
      }

      if (nodeStatus === "failed") {
        const providerErrMessage = (() => {
          const p = outputPayload["payload"];
          if (typeof p !== "object" || p === null) {
            return undefined;
          }
          const m = (p as Readonly<Record<string, unknown>>)[
            "providerErrorMessage"
          ];
          return typeof m === "string" && m.length > 0 ? m : undefined;
        })();
        const failureReason: string =
          providerErrMessage !== undefined &&
          isSupervisionStallLastError(providerErrMessage)
            ? providerErrMessage
            : outputPayload["error"] === "invalid_output"
              ? `invalid adapter output for ${executionTargetNoun} '${nodeId}'`
              : outputValidationErrors.length > 0
                ? `output validation failed for ${executionTargetNoun} '${nodeId}'`
                : `adapter failure for ${executionTargetNoun} '${nodeId}'`;
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: failureReason,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(5, failed.lastError ?? "adapter failure", failed),
        );
      }

      const completion = evaluateCompletion({
        rule: nodeRef.completion,
        output: outputPayload,
      });
      if (!completion.passed) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          loopIterationCounts: updatedLoopIterationCounts,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError:
            completion.reason === null
              ? `completion condition not met for ${executionTargetNoun} '${nodeId}'`
              : `completion condition not met for ${executionTargetNoun} '${nodeId}': ${completion.reason}`,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            3,
            failed.lastError ?? "completion condition not met",
            failed,
          ),
        );
      }
      const consumedCommunicationsResult = await markCommunicationsConsumed(
        { ...session, communications: currentCommunications },
        upstreamCommunicationIds,
        nodeExecId,
        endedAt,
      );
      if (!consumedCommunicationsResult.ok) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          loopIterationCounts: updatedLoopIterationCounts,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: consumedCommunicationsResult.error,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "mailbox consumption persistence failed",
            failed,
          ),
        );
      }
      currentCommunications = consumedCommunicationsResult.value;
      const transitionCommunications = await Promise.all(
        selected.map((edge, index) => {
          return persistCommunicationArtifact({
            artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
            runtimeLogOptions: options,
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            communicationCounter: currentCommunicationCounter + index,
            fromNodeId: edge.from,
            toNodeId: edge.to,
            routingScope: "intra-workflow",
            deliveryKind:
              edge.to === edge.from ? "loop-back" : "edge-transition",
            transitionWhen: edge.when,
            sourceNodeExecId: nodeExecId,
            payloadRef: outputRef,
            outputRaw,
            deliveredByNodeId: resolveWorkflowManagerRuntimeId(workflow),
            createdAt: endedAt,
          });
        }),
      );
      currentCommunications = [
        ...currentCommunications,
        ...transitionCommunications,
      ];
      currentCommunicationCounter += transitionCommunications.length;

      const crossWorkflowDispatchResult = await executeCrossWorkflowDispatchesForNode({
        workflow,
        workflowName,
        session: {
          ...session,
          nodeExecutions,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          runtimeVariables: currentRuntimeVariables,
        },
        options,
        artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
        callerNodeId: nodeId,
        ...(stepExecutionAddress.stepId === undefined
          ? {}
          : { callerStepId: stepExecutionAddress.stepId }),
        callerNodeExecId: nodeExecId,
        callerArtifactDir: artifactDir,
        callerOutputPayload: outputPayload,
        callerOutputRaw: outputRaw,
        createdAt: endedAt,
        communicationCounter: currentCommunicationCounter,
        currentCommunications,
        adapter: effectiveAdapter,
        guards,
        crossWorkflowInvocationStack,
      });
      if (!crossWorkflowDispatchResult.ok) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt,
          nodeExecutionCounter: nextExecutionCounter,
          nodeExecutionCounts: updatedCounts,
          nodeExecutions,
          loopIterationCounts: updatedLoopIterationCounts,
          communicationCounter: currentCommunicationCounter,
          communications: currentCommunications,
          nodeBackendSessions: nextNodeBackendSessions,
          lastError: crossWorkflowDispatchResult.error,
        };
        await saveSession(failed, options);
        return err(
          workflowRunFailure(
            1,
            failed.lastError ?? "cross-workflow dispatch execution failed",
            failed,
          ),
        );
      }
      currentCommunications = crossWorkflowDispatchResult.value.communications;
      currentCommunicationCounter =
        crossWorkflowDispatchResult.value.communicationCounter;

      const transitions = [
        ...session.transitions,
        ...selected.map((edge) => ({
          from: edge.from,
          to: edge.to,
          when: edge.when,
        })),
        ...crossWorkflowDispatchResult.value.transitions,
      ];
      const transitionNextNodes = selected.map((edge) => edge.to);
      const retryStepIds = managerControl?.retryStepIds ?? [];
      const nextQueue = [
        ...queue,
        ...transitionNextNodes,
        ...crossWorkflowDispatchResult.value.queuedNodeIds,
        ...queuedOptionalDecisionNodeIds,
      ].filter((value, index, all) => all.indexOf(value) === index);
      const nextQueueWithRetries = [...nextQueue, ...retryStepIds].filter(
        (value, index, all) => all.indexOf(value) === index,
      );

      session = {
        ...session,
        status: "running",
        queue: nextQueueWithRetries,
        currentNodeId: nodeId,
        nodeExecutionCounter: nextExecutionCounter,
        nodeExecutionCounts: updatedCounts,
        loopIterationCounts: updatedLoopIterationCounts,
        transitions,
        nodeExecutions,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        ...(session.conversationTurns === undefined
          ? {}
          : { conversationTurns: session.conversationTurns }),
        nodeBackendSessions: nextNodeBackendSessions,
        pendingOptionalNodeDecisions: isOptionalExecutionNode
          ? removePendingOptionalNodeDecision(
              pendingOptionalNodeDecisionsAfterManagerActions,
              nodeId,
            )
          : pendingOptionalNodeDecisionsAfterManagerActions,
        runtimeVariables: currentRuntimeVariables,
      };

      await saveSession(session, options);
      break;
    }
  }

  const beforeComplete = await loadSession(session.sessionId, options);
  if (beforeComplete.ok && isTerminalStatus(beforeComplete.value.status)) {
    if (beforeComplete.value.status === "completed") {
      return ok({ session: beforeComplete.value, exitCode: 0 });
    }
    const exitCode = beforeComplete.value.status === "cancelled" ? 130 : 1;
    return err(
      workflowRunFailure(
        exitCode,
        beforeComplete.value.lastError ??
          `session ${beforeComplete.value.status}`,
        beforeComplete.value,
      ),
    );
  }

  let completed: WorkflowSessionState = {
    ...session,
    status: "completed",
    endedAt: nowIso(),
    queue: [],
  };

  const publishedResultExecution = findLatestPublishedWorkflowResult(
    workflow,
    completed,
  );
  if (publishedResultExecution !== undefined) {
    const publishedTargetId =
      stepAddressedExecution && publishedResultExecution.stepId !== undefined
        ? publishedResultExecution.stepId
        : publishedResultExecution.nodeId;
    const outputPayload = await readOutputPayloadArtifact(
      publishedResultExecution.artifactDir,
    );
    if (!outputPayload.ok) {
      const publicationFailureMessage =
        `failed to publish selected external output for ${executionTargetNoun} '${publishedTargetId}' ` +
        `(${publishedResultExecution.nodeExecId}): ${outputPayload.error}`;
      return await failTerminalSession(
        completed,
        options,
        publicationFailureMessage,
      );
    }
    let externalOutputCommunication: CommunicationRecord;
    try {
      externalOutputCommunication =
        await persistExternalMailboxOutputCommunication({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          runtimeLogOptions: options,
          workflow,
          session: completed,
          execution: publishedResultExecution,
          outputRaw: outputPayload.value.raw,
          communicationCounter: completed.communicationCounter,
          createdAt: completed.endedAt ?? nowIso(),
        });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "unknown external output publication failure";
      const publicationFailureMessage =
        `failed to persist external output publication for ${executionTargetNoun} '${publishedTargetId}' ` +
        `(${publishedResultExecution.nodeExecId}): ${message}`;
      return await failTerminalSession(
        completed,
        options,
        publicationFailureMessage,
      );
    }
    completed = {
      ...completed,
      communicationCounter: completed.communicationCounter + 1,
      communications: [
        ...completed.communications,
        externalOutputCommunication,
      ],
    };
  }

  const persistedCompleted = await persistCompletedSessionState(
    completed,
    options,
  );
  if (!persistedCompleted.ok) {
    return err(workflowRunFailure(1, persistedCompleted.error, completed));
  }
  return ok({ session: completed, exitCode: 0 });
}

/**
 * Outermost auto-improve cycle: re-run the target after terminal failure until success or
 * {@link AutoImprovePolicy.maxSupervisedAttempts}, recording incidents and remediations.
 * In-step stall is detected from persisted `sessions.updated_at` while a step executes
 * (`executeAdapterWithTimeout` + `buildSupervisionStallWatch`). A nested `superviserWorkflowId`
 * workflow is still a follow-up.
 */
async function runAutoImproveLoop(
  workflowName: string,
  options: WorkflowRunOptions,
  adapter: NodeAdapter | undefined,
  guards: EngineExecutionGuards | undefined,
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const policy = options.autoImprove;
  if (policy === undefined) {
    return err(workflowRunFailure(1, "internal: autoImprove policy missing"));
  }
  const innerBase: WorkflowRunOptions = {
    ...options,
    supervisionLoopExecution: true,
  };
  let current: WorkflowRunOptions = innerBase;

  for (;;) {
    const result = await runWorkflowInternal(
      workflowName,
      current,
      adapter,
      guards,
    );

    if (result.ok) {
      const persisted = await loadSession(
        result.value.session.sessionId,
        options,
      );
      const latest = persisted.ok ? persisted.value : result.value.session;
      if (latest.status !== "completed" || result.value.exitCode !== 0) {
        return ok({ ...result.value, session: latest });
      }
      if (latest.supervision !== undefined) {
        const next: WorkflowSessionState = {
          ...latest,
          supervision: { ...latest.supervision, status: "succeeded" },
        };
        const saved = await saveSession(next, options);
        if (!saved.ok) {
          return err(workflowRunFailure(1, saved.error.message, next));
        }
        return ok({ session: next, exitCode: 0 });
      }
      return ok({ ...result.value, session: latest });
    }

    const failure = result.error;
    if (failure.sessionId === undefined) {
      return result;
    }
    if (failure.exitCode === 130) {
      return result;
    }

    const loaded = await loadSession(failure.sessionId, options);
    if (!loaded.ok) {
      return result;
    }
    const failedSession = loaded.value;
    if (failedSession.supervision === undefined) {
      return result;
    }

    const sup = failedSession.supervision;
    if (sup.attemptCount >= policy.maxSupervisedAttempts) {
      const t = nowIso();
      const lastErr = failedSession.lastError;
      const terminalIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: isSupervisionStallLastError(lastErr) ? "stall" : "failure",
        summary: lastErr ?? failure.message,
        detectedAt: t,
      };
      const budgetIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: "budget-exhausted",
        summary: `max supervised attempts (${policy.maxSupervisedAttempts}) reached`,
        detectedAt: t,
      };
      const remediation: SupervisionRemediationRecord = {
        remediationId: `rem-${randomBytes(6).toString("hex")}`,
        incidentId: budgetIncident.incidentId,
        decidedAt: t,
        action: "stop-supervision",
        reason: "supervision attempt budget exhausted",
      };
      const nextSession: WorkflowSessionState = {
        ...failedSession,
        supervision: {
          ...sup,
          status: "stopped",
          incidents: [...sup.incidents, terminalIncident, budgetIncident],
          remediations: [...(sup.remediations ?? []), remediation],
        },
      };
      const saved = await saveSession(nextSession, options);
      if (!saved.ok) {
        return err(workflowRunFailure(1, saved.error.message, nextSession));
      }
      return err(
        workflowRunFailure(
          1,
          nextSession.lastError ?? failure.message,
          nextSession,
        ),
      );
    }

    const t = nowIso();
    const lastErr = failedSession.lastError;
    const failIncident: SupervisionIncident = {
      incidentId: `inc-${randomBytes(6).toString("hex")}`,
      supervisedAttemptId: failedSession.sessionId,
      category: isSupervisionStallLastError(lastErr) ? "stall" : "failure",
      summary: lastErr ?? failure.message,
      detectedAt: t,
    };
    const nextAttempt = sup.attemptCount + 1;

    const loadOptsForTarget = mergeLoadOptionsForSessionMutableBundle(
      options,
      failedSession,
    );
    const wfForTarget = await loadWorkflowFromDisk(
      workflowName,
      loadOptsForTarget,
    );
    if (!wfForTarget.ok) {
      return err(
        workflowRunFailure(
          2,
          `supervision rerun: load workflow: ${wfForTarget.error.message}`,
          failedSession,
        ),
      );
    }
    const targetWorkflow = wfForTarget.value.bundle.workflow;
    const workflowForSupervision =
      toStepAddressedWorkflowForSupervision(targetWorkflow);
    if (workflowForSupervision === null) {
      return err(
        workflowRunFailure(
          2,
          "supervision rerun requires entryStepId with non-empty steps on the target workflow",
          failedSession,
        ),
      );
    }
    const remediationPlan = planSupervisionRemediation({
      policy,
      sup,
      workflow: workflowForSupervision,
      session: failedSession,
      failIncident,
    });

    if (remediationPlan.kind === "stop-patch-budget") {
      const tStop = nowIso();
      const patchBudgetIncident: SupervisionIncident = {
        incidentId: `inc-${randomBytes(6).toString("hex")}`,
        supervisedAttemptId: failedSession.sessionId,
        category: "budget-exhausted",
        summary: `max workflow patches (${policy.maxWorkflowPatches}) reached; repeated supervised incident: ${lastErr ?? failure.message}`,
        detectedAt: tStop,
      };
      const patchStopRemediation: SupervisionRemediationRecord = {
        remediationId: `rem-${randomBytes(6).toString("hex")}`,
        incidentId: patchBudgetIncident.incidentId,
        decidedAt: tStop,
        action: "stop-supervision",
        reason: "workflow patch budget exhausted",
      };
      const nextSession: WorkflowSessionState = {
        ...failedSession,
        supervision: {
          ...sup,
          status: "stopped",
          incidents: [...sup.incidents, failIncident, patchBudgetIncident],
          remediations: [...(sup.remediations ?? []), patchStopRemediation],
        },
      };
      const savedP = await saveSession(nextSession, options);
      if (!savedP.ok) {
        return err(workflowRunFailure(1, savedP.error.message, nextSession));
      }
      return err(
        workflowRunFailure(
          1,
          nextSession.lastError ?? failure.message,
          nextSession,
        ),
      );
    }

    let nextPatchCount = sup.workflowPatchCount;
    if (remediationPlan.kind === "patch-then-rerun") {
      const roots = resolveEffectiveRoots(current);
      if (sup.mutableWorkflowDir === undefined) {
        return err(
          workflowRunFailure(
            2,
            "supervision: mutable workflow directory missing; cannot record patch revision",
            failedSession,
          ),
        );
      }
      const patchRec = await recordWorkflowPatchRevision({
        artifactRoot: roots.artifactRoot,
        supervisionRunId: sup.supervisionRunId,
        mutableWorkflowDir: sup.mutableWorkflowDir,
        reason: remediationPlan.patchRecordReason,
        patchedByStepId: getEngineSupervisionPatcherId(),
      });
      if (!patchRec.ok) {
        return err(
          workflowRunFailure(
            2,
            `supervision: ${patchRec.error.message}`,
            failedSession,
          ),
        );
      }
      nextPatchCount += 1;
    }

    const rem: SupervisionRemediationRecord = {
      remediationId: `rem-${randomBytes(6).toString("hex")}`,
      incidentId: failIncident.incidentId,
      decidedAt: t,
      action:
        remediationPlan.kind === "patch-then-rerun"
          ? "patch-workflow"
          : remediationPlan.remediationAction,
      reason:
        remediationPlan.kind === "patch-then-rerun"
          ? remediationPlan.patchRecordReason
          : "automatic target workflow rerun after terminal failure or stall",
      ...(remediationPlan.targetStepId === undefined
        ? {}
        : { targetStepId: remediationPlan.targetStepId }),
    };
    const withUpdates: WorkflowSessionState = {
      ...failedSession,
      supervision: {
        ...sup,
        attemptCount: nextAttempt,
        workflowPatchCount: nextPatchCount,
        incidents: [...sup.incidents, failIncident],
        remediations: [...(sup.remediations ?? []), rem],
        ...(sup.policy === undefined ? { policy } : {}),
      },
    };
    const saved2 = await saveSession(withUpdates, options);
    if (!saved2.ok) {
      return err(workflowRunFailure(1, saved2.error.message, withUpdates));
    }

    const {
      resumeSessionId: _resumeSessionId,
      rerunFromSessionId: _rerunFromSessionId,
      rerunFromStepId: _rerunFromStepId,
      ...rerunBase
    } = innerBase;
    current = {
      ...rerunBase,
      autoImprove: policy,
      supervisionLoopExecution: true,
      rerunFromSessionId: withUpdates.sessionId,
      rerunFromStepId:
        remediationPlan.targetStepId ?? remediationPlan.rerunFromStepId,
    };
  }
}

export async function runWorkflow(
  workflowName: string,
  options: WorkflowRunOptions = {},
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  let normalizedOptions = options;
  if (options.autoImprove !== undefined) {
    const normalizedPolicy = normalizeAutoImprovePolicy(options.autoImprove);
    if (!normalizedPolicy.ok || normalizedPolicy.value === undefined) {
      return err(
        workflowRunFailure(
          2,
          normalizedPolicy.ok
            ? "autoImprove.enabled must be true when autoImprove is set"
            : `invalid autoImprove policy: ${normalizedPolicy.error}`,
        ),
      );
    }
    normalizedOptions = {
      ...options,
      autoImprove: normalizedPolicy.value,
    };
  }

  if (normalizedOptions.autoImprove === undefined) {
    return runWorkflowInternal(
      workflowName,
      normalizedOptions,
      adapter,
      guards,
      [],
    );
  }
  if (normalizedOptions.supervisionLoopExecution === true) {
    return runWorkflowInternal(
      workflowName,
      normalizedOptions,
      adapter,
      guards,
      [],
    );
  }
  if (normalizedOptions.nestedSuperviserDriver === true) {
    if (normalizedOptions.rerunFromSessionId !== undefined) {
      return err(
        workflowRunFailure(
          2,
          "nestedSuperviserDriver cannot be combined with rerunFromSessionId",
        ),
      );
    }
    return runWorkflowInternal(
      workflowName,
      normalizedOptions,
      adapter,
      guards,
      [],
    );
  }
  return runAutoImproveLoop(workflowName, normalizedOptions, adapter, guards);
}

async function runNestedSuperviserSessionDriver(
  workflowName: string,
  session: WorkflowSessionState,
  loaded: LoadedWorkflow,
  options: WorkflowRunOptions,
  adapter: NodeAdapter | undefined,
  guards: EngineExecutionGuards | undefined,
  crossWorkflowInvocationStack: readonly string[],
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const sup = session.supervision;
  if (sup === undefined || options.autoImprove === undefined) {
    return err(
      workflowRunFailure(
        2,
        "internal: nested superviser requires supervision and policy",
      ),
    );
  }
  const supLoad = await loadWorkflowByIdFromDisk(
    sup.superviserWorkflowId,
    options,
  );
  if (!supLoad.ok) {
    return err(
      workflowRunFailure(
        2,
        `nested superviser: load '${sup.superviserWorkflowId}': ${supLoad.error.message}`,
        session,
      ),
    );
  }
  const resumingTarget =
    options.resumeSessionId !== undefined &&
    options.resumeSessionId === session.sessionId;
  const existingSuperviserRunSessionId = sup.nestedSuperviserSessionId;
  let sessionWithSuperviserRunId: WorkflowSessionState;
  let superviserRunSessionId: string;
  /**
   * When true, run the phase-2 superviser bundle with `resumeSessionId` set to
   * `superviserRunSessionId` (continue an in-flight superviser run). When false, start a new
   * superviser run with a fresh `sessionId` (no structural sub-workflow tree; flat supervision).
   */
  let resumeSuperviserRunSession: boolean;
  if (resumingTarget) {
    if (existingSuperviserRunSessionId === undefined) {
      return err(
        workflowRunFailure(
          2,
          "internal: nested superviser resume requires nestedSuperviserSessionId on supervision",
          session,
        ),
      );
    }
    const superviserRunLoaded = await loadSession(
      existingSuperviserRunSessionId,
      options,
    );
    if (!superviserRunLoaded.ok) {
      return err(
        workflowRunFailure(
          1,
          `nested superviser: load session for superviser run: ${superviserRunLoaded.error.message}`,
          session,
        ),
      );
    }
    const superviserRunCompleted = superviserRunLoaded.value.status === "completed";
    const targetStillActive = session.status !== "completed";
    if (superviserRunCompleted && targetStillActive) {
      // The superviser bundle finished (for example a one-shot add-on) while the
      // target session is still paused or failed. Resume the target by running another
      // superviser round with a fresh superviser session id (reusing the same supervision run).
      superviserRunSessionId = createSessionId({
        workflowId: supLoad.value.bundle.workflow.workflowId,
      });
      sessionWithSuperviserRunId = {
        ...session,
        supervision: {
          ...sup,
          nestedSuperviserSessionId: superviserRunSessionId,
        },
      };
      const savedSuperviser = await saveSession(sessionWithSuperviserRunId, options);
      if (!savedSuperviser.ok) {
        return err(
          workflowRunFailure(1, savedSuperviser.error.message, sessionWithSuperviserRunId),
        );
      }
      resumeSuperviserRunSession = false;
    } else {
      superviserRunSessionId = existingSuperviserRunSessionId;
      sessionWithSuperviserRunId = session;
      resumeSuperviserRunSession = true;
    }
  } else {
    superviserRunSessionId = createSessionId({
      workflowId: supLoad.value.bundle.workflow.workflowId,
    });
    sessionWithSuperviserRunId = {
      ...session,
      supervision: {
        ...sup,
        nestedSuperviserSessionId: superviserRunSessionId,
      },
    };
    const savedSuperviser = await saveSession(sessionWithSuperviserRunId, options);
    if (!savedSuperviser.ok) {
      return err(
        workflowRunFailure(1, savedSuperviser.error.message, sessionWithSuperviserRunId),
      );
    }
    resumeSuperviserRunSession = false;
  }
  const baseForControl = workflowRunBaseForSuperviserControl(options);
  const runWorkflowWithAdapter = (
    name: string,
    opts: WorkflowRunOptions,
  ): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> =>
    runWorkflow(name, opts, adapter, guards);
  const control = buildSuperviserRuntimeControl({
    base: baseForControl,
    runWorkflow: runWorkflowWithAdapter,
    auth: {
      supervisionRunId: sup.supervisionRunId,
      targetSessionId: session.sessionId,
    },
    targetWorkflowName: workflowName,
    targetExpectedWorkflowId: loaded.bundle.workflow.workflowId,
    defaultPolicy: options.autoImprove,
  });
  const {
    autoImprove: _ai2,
    supervisionLoopExecution: _sl2,
    nestedSuperviserDriver: _nd2,
    superviserControl: _sc2,
    ...supOptsBase
  } = baseForControl;
  const baseRv = supOptsBase.runtimeVariables ?? {};
  const supOpts: WorkflowRunOptions = {
    ...supOptsBase,
    runtimeVariables: {
      ...baseRv,
      supervisionRunId: sup.supervisionRunId,
      targetSessionId: session.sessionId,
      superviserTargetWorkflowId: loaded.bundle.workflow.workflowId,
    },
    superviserControl: control,
    ...(resumeSuperviserRunSession
      ? { resumeSessionId: superviserRunSessionId }
      : { sessionId: superviserRunSessionId }),
  };
  const supResult = await runWorkflowInternal(
    supLoad.value.workflowName,
    supOpts,
    adapter,
    guards,
    crossWorkflowInvocationStack,
  );
  const reloaded = await loadSession(session.sessionId, options);
  const target =
    reloaded.ok && reloaded.value.supervision !== undefined
      ? reloaded.value
      : sessionWithSuperviserRunId;
  if (supResult.ok) {
    const exit = supResult.value.exitCode;
    const st: SupervisionRunState["status"] =
      exit === 0 ? "succeeded" : exit === 4 ? "stopped" : "failed";
    const nextSup: SupervisionRunState = {
      ...(target.supervision as SupervisionRunState),
      status: st,
    };
    const stamped: WorkflowSessionState = {
      ...target,
      supervision: nextSup,
    };
    const w = await saveSession(stamped, options);
    if (!w.ok) {
      return err(workflowRunFailure(1, w.error.message, stamped));
    }
    return ok({ session: stamped, exitCode: exit });
  }
  const nextSup: SupervisionRunState = {
    ...((target.supervision ?? sup) as SupervisionRunState),
    status: "failed",
  };
  const stamped: WorkflowSessionState = {
    ...target,
    supervision: nextSup,
  };
  const w = await saveSession(stamped, options);
  if (!w.ok) {
    return err(workflowRunFailure(1, w.error.message, stamped));
  }
  return err(
    workflowRunFailure(
      supResult.error.exitCode,
      supResult.error.message,
      stamped,
    ),
  );
}
