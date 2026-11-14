import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionOutput } from "../adapter";
import type { AutoImprovePolicyInput } from "../auto-improve-policy";
import type { FanoutStepBudget } from "../engine-fanout";
import type { JsonSchemaValidationError } from "../json-schema";
import { err, ok, type Result } from "../result";
import type { MockNodeScenario } from "../scenario-adapter";
import { evaluateBranch } from "../semantics";
import type {
  CommunicationRecord,
  NodeExecutionRecord,
  OutputRef,
  PendingOptionalNodeDecision,
  WorkflowSessionState,
} from "../session";
import { saveSession, type SessionStoreOptions } from "../session-store";
import type { SuperviserRuntimeControl } from "../superviser-control";
import type {
  AutoImprovePolicy,
  ChatReplyDispatcher,
  LoadOptions,
  NodePayload,
  WorkflowEdge,
  WorkflowJson,
  WorkflowTimeoutPolicy,
} from "../types";
import { resolveWorkflowManagerStepId } from "../types";

export interface WorkflowRunEventOptions {
  /** Typed in-process workflow-run event channel for supervisor-owned consumers. */
  readonly eventSink?: WorkflowRunEventSink;
  /** Enables legacy local debug progress callbacks. */
  readonly debug?: boolean;
}
export interface WorkflowRunOptions
  extends LoadOptions,
    SessionStoreOptions,
    WorkflowRunEventOptions {
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
  readonly autoImprove?: AutoImprovePolicyInput;
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
   * Rerun entry step id.
   * Required with {@link rerunFromSessionId} for rerun entry.
   */
  readonly rerunFromStepId?: string;
  /**
   * History-linked continuation: source workflow execution id (immediate parent timeline).
   * Requires {@link continueAfterStepRunId} and {@link continueStartStepId}.
   * Mutually exclusive with {@link rerunFromSessionId} and {@link resumeSessionId}.
   */
  readonly continueFromWorkflowExecutionId?: string;
  /** Last imported step run (`nodeExecId`) inclusive boundary on the source timeline. */
  readonly continueAfterStepRunId?: string;
  /** Entry step id for the new workflow execution (`queue` seed). */
  readonly continueStartStepId?: string;
  readonly restartOnStuck?: boolean;
  readonly maxStuckRestarts?: number;
  readonly stuckRestartBackoffMs?: number;
  /**
   * Public cap on runtime fanout concurrency for this workflow run.
   * Must be a positive integer when provided.
   * Seeds {@link fanoutConcurrencyBudget} when that internal field is absent,
   * clamping authored or default fanout concurrency for all (nested) fanout groups.
   */
  readonly maxConcurrency?: number;
  /** Internal fanout branch entry step. */
  readonly fanoutBranchStartStepId?: string;
  /** Internal maximum fanout budget inherited by nested fanout runs. */
  readonly fanoutConcurrencyBudget?: number;
  /** Internal shared step budget for fanout branch child executions. */
  readonly fanoutStepBudget?: FanoutStepBudget;
  /** Best-effort local progress notifications for explicit debug consumers. */
  readonly onProgress?: (event: WorkflowRunProgressEvent) => void;
}
export type NormalizedWorkflowRunOptions = Omit<
  WorkflowRunOptions,
  "autoImprove"
> & {
  readonly autoImprove?: AutoImprovePolicy;
};
export type WorkflowRunProgressEvent = WorkflowRunStepStartEvent;
export interface WorkflowRunStepStartEvent {
  readonly type: "step-start";
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly stepId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly attempt: number;
  readonly queuedStepIds: readonly string[];
}
export interface WorkflowRunEventSink {
  emit(event: WorkflowRunEvent): void | Promise<void>;
}
export type WorkflowRunEvent =
  | WorkflowRunStepStartedEvent
  | WorkflowRunStepCompletedEvent
  | WorkflowRunCompletedEvent;
export interface WorkflowRunStepStartedEvent {
  readonly type: "step-started";
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly nodeExecId: string;
  readonly workflowName?: string;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly attempt?: number;
  readonly queuedStepIds?: readonly string[];
}
export interface WorkflowRunStepCompletedEvent {
  readonly type: "step-completed";
  readonly workflowExecutionId: string;
  readonly stepId: string;
  readonly nodeExecId: string;
  readonly status: string;
}
export interface WorkflowRunCompletedEvent {
  readonly type: "workflow-completed";
  readonly workflowExecutionId: string;
  readonly status: string;
}
export const noopWorkflowRunEventSink: WorkflowRunEventSink = {
  emit() {
    return undefined;
  },
};
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
export function workflowRunFailure(
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
export function notifyWorkflowProgress(
  options: WorkflowRunOptions,
  event: WorkflowRunProgressEvent,
): void {
  if (options.debug !== true) {
    return;
  }
  try {
    options.onProgress?.(event);
  } catch {
    // Debug progress callbacks must not change execution.
  }
}
export async function emitWorkflowRunEvent(
  options: WorkflowRunOptions,
  event: WorkflowRunEvent,
): Promise<void> {
  try {
    await (options.eventSink ?? noopWorkflowRunEventSink).emit(event);
  } catch {
    // Event sinks are an operator-facing notification surface and must not
    // change workflow execution semantics.
  }
}
export interface CancellationProbe {
  isCancelled(sessionId: string): Promise<boolean>;
}
export interface EngineExecutionGuards {
  readonly cancellationProbe: CancellationProbe;
}
export function mergeVariables(
  nodeVariables: Readonly<Record<string, unknown>>,
  runtimeVariables: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return { ...nodeVariables, ...runtimeVariables };
}
export function nowIso(): string {
  return new Date().toISOString();
}
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
export function addMillisecondsToIso(
  timestamp: string,
  milliseconds: number,
): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}
export interface UpstreamOutputRef extends OutputRef {
  readonly fromNodeId: string;
  readonly transitionWhen: string;
  readonly status:
    | NodeExecutionRecord["status"]
    | CommunicationRecord["status"];
  readonly communicationId: string;
}
export interface UpstreamInput extends UpstreamOutputRef {
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRaw: string;
}
export interface OutputArtifact {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly raw: string;
}
export function nextNodeExecId(counter: number): string {
  return `exec-${String(counter).padStart(6, "0")}`;
}
export function nextManagerSessionId(nodeExecId: string): string {
  return `mgrsess-${nodeExecId}`;
}
export function nextCommunicationId(counter: number): string {
  return `comm-${String(counter).padStart(6, "0")}`;
}
export function initialDeliveryAttemptId(): string {
  return "attempt-000001";
}
export function resolveTimeoutMs(input: {
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
export function resolveTimeoutRestartBudget(
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
export function evaluateEdge(
  edge: WorkflowEdge,
  output: Readonly<Record<string, unknown>>,
): boolean {
  return evaluateBranch({ when: edge.when, output });
}
export async function persistTerminalSessionState(
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
export async function persistCompletedSessionState(
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
export async function failTerminalSession(
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
export function stableJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
export function outputArtifactJsonText(payload: unknown): string {
  return `${stableJson(payload)}\n`;
}
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function resolveOutputValidationAttempts(node: NodePayload): number {
  if (node.output === undefined) {
    return 1;
  }
  if (node.output.maxValidationAttempts !== undefined) {
    return Math.max(1, node.output.maxValidationAttempts);
  }
  return node.output.jsonSchema === undefined ? 1 : 3;
}
export function buildOutputPublicationPolicy(): {
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
export function nextOutputAttemptId(counter: number): string {
  return `attempt-${String(counter).padStart(6, "0")}`;
}
export function buildReservedCandidateSubmissionPath(input: {
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
export async function cleanupReservedCandidateSubmissionPath(
  candidatePath: string,
): Promise<void> {
  await rm(path.dirname(candidatePath), { recursive: true, force: true });
}
export function buildOutputPromptText(input: {
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
    "If you choose to submit the final business JSON via a file, write that JSON only to the reserved Candidate-Path.",
    "This Candidate-Path restriction applies only to the final structured output submission; repository edits explicitly requested by the node instructions are still allowed.",
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
export const MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS = 8;
export const MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH = 240;
export const NON_CONTRACT_CANDIDATE_FILE_ERROR =
  "adapter output.candidateFilePath is only supported when node.output is configured";
export const WORKFLOW_EXTERNAL_INPUT_NODE_ID = "__workflow-input-mailbox__";
export const WORKFLOW_EXTERNAL_OUTPUT_NODE_ID = "__workflow-output-mailbox__";
export function formatOutputValidationErrors(
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
export function buildRetryValidationFeedback(
  errors: readonly JsonSchemaValidationError[],
): readonly JsonSchemaValidationError[] {
  if (errors.length === 0) {
    return [];
  }
  return formatOutputValidationErrors(errors);
}
export interface CandidatePayloadResolutionError {
  readonly message: string;
  readonly retryable: boolean;
}
export async function readCandidatePayloadFromFile(
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
export async function resolveCandidatePayload(input: {
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
export async function readOutputPayloadArtifact(
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
export function findNodeRef(workflow: WorkflowJson, nodeId: string) {
  return workflow.nodes.find((entry) => entry.id === nodeId);
}
export function isOptionalNode(
  workflow: WorkflowJson,
  nodeId: string,
): boolean {
  return findNodeRef(workflow, nodeId)?.execution?.mode === "optional";
}
export function findOwningManagerNodeId(
  workflow: WorkflowJson,
  _nodeId: string,
): string {
  return resolveWorkflowManagerStepId(workflow);
}
export function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
  return nodeIds.filter((value, index, all) => all.indexOf(value) === index);
}
export function upsertPendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  decision: PendingOptionalNodeDecision,
): readonly PendingOptionalNodeDecision[] {
  return [
    ...decisions.filter((entry) => entry.nodeId !== decision.nodeId),
    decision,
  ];
}
export function removePendingOptionalNodeDecision(
  decisions: readonly PendingOptionalNodeDecision[],
  nodeId: string,
): readonly PendingOptionalNodeDecision[] {
  return decisions.filter((entry) => entry.nodeId !== nodeId);
}
export function findPendingOptionalNodeDecision(
  session: WorkflowSessionState,
  nodeId: string,
): PendingOptionalNodeDecision | undefined {
  return session.pendingOptionalNodeDecisions?.find(
    (entry) => entry.nodeId === nodeId,
  );
}
export function hasPendingPausedFanoutBranch(
  session: WorkflowSessionState,
): boolean {
  const hasPausedBranch =
    session.fanoutGroups?.some((group) =>
      group.branches.some((branch) => branch.status === "paused"),
    ) === true;
  if (!hasPausedBranch) {
    return false;
  }
  return (
    session.pendingOptionalNodeDecisions?.some(
      (decision) => decision.status === "pending",
    ) === true
  );
}
export function describeAmbiguousFanoutBranchRerunTarget(
  session: WorkflowSessionState,
  stepId: string,
): string | undefined {
  const groups = (session.fanoutGroups ?? []).filter(
    (group) => group.targetStepId === stepId && group.branches.length > 1,
  );
  if (groups.length === 0) {
    return undefined;
  }
  const groupIds = groups.map((group) => group.groupId).join(", ");
  return `cannot rerun fanout branch target step '${stepId}' without fanout branch context; matching fanout group(s): ${groupIds}`;
}
export function buildOptionalSkipOutput(
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
