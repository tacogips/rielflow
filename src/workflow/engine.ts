import { mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../shared/fs";
import {
  AdapterExecutionError,
  ScenarioNodeAdapter,
  type AdapterAmbientManagerContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type MockNodeScenario,
  type NodeAdapter,
} from "./adapter";
import { DispatchingNodeAdapter } from "./adapters/dispatch";
import { resolveNodeExecutionBackend } from "./adapters/dispatch";
import { assembleNodeInput } from "./input-assembly";
import { normalizeExternalMailboxBusinessPayload } from "./json-boundary";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "./json-schema";
import { loadWorkflowFromDisk } from "./load";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "./node-execution-mailbox";
import { composeExecutionPrompts } from "./prompt-composition";
import {
  parseManagerControlPayload,
  type ParsedManagerControl,
} from "./manager-control";
import { err, ok, type Result } from "./result";
import { saveNodeExecutionToRuntimeDb } from "./runtime-db";
import { executeConversationRound } from "./conversation";
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
  planRootManagerSubWorkflowStarts,
  planSubWorkflowChildInputs,
} from "./sub-workflow";
import {
  createSessionId,
  createSessionState,
  type CommunicationRecord,
  type NodeBackendSessionRecord,
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
import type {
  AgentNodePayload,
  JsonObject,
  LoadOptions,
  LoopRule,
  NodePayload,
  SubWorkflowRef,
  WorkflowEdge,
  WorkflowJson,
} from "./types";
import { asAgentNodePayload } from "./types";

export interface WorkflowRunOptions extends LoadOptions, SessionStoreOptions {
  readonly sessionId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly mockScenario?: MockNodeScenario;
  readonly resumeSessionId?: string;
  readonly rerunFromSessionId?: string;
  readonly rerunFromNodeId?: string;
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
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
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

interface ForwardedManagerPayload {
  readonly payloadRef: OutputRef;
  readonly outputRaw: string;
}

interface OutputArtifact {
  readonly payload: Readonly<Record<string, unknown>>;
  readonly raw: string;
}

interface AdapterExecutionFailure {
  readonly code:
    | "provider_error"
    | "timeout"
    | "invalid_output"
    | "policy_blocked";
  readonly message: string;
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

function resolveTimeoutMs(
  node: NodePayload,
  workflowTimeoutMs: number,
  overrideTimeoutMs: number | undefined,
): number {
  if (node.timeoutMs !== undefined) {
    return node.timeoutMs;
  }
  if (overrideTimeoutMs !== undefined && overrideTimeoutMs > 0) {
    return overrideTimeoutMs;
  }
  return workflowTimeoutMs;
}

function evaluateEdge(
  edge: WorkflowEdge,
  output: Readonly<Record<string, unknown>>,
): boolean {
  return evaluateBranch({ when: edge.when, output });
}

async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
): Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AdapterExecutionError("timeout", "adapter execution timed out"),
      );
    }, timeoutMs);
  });

  try {
    const output = await Promise.race([
      adapter.execute(input, {
        timeoutMs,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    return ok(output);
  } catch (error: unknown) {
    if (error instanceof AdapterExecutionError) {
      return err({
        code: error.code,
        message: error.message,
      });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return err({
        code: "timeout",
        message: "adapter execution timed out",
      });
    }
    return err({
      code: "provider_error",
      message:
        error instanceof Error
          ? error.message
          : "unknown adapter execution failure",
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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
  return err({
    exitCode: 1,
    message: persisted.ok ? message : persisted.error,
  });
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

function findOwningSubWorkflowByRuntimeNodeId(
  workflow: WorkflowJson,
  nodeId: string,
): SubWorkflowRef | undefined {
  return workflow.subWorkflows.find((entry) => {
    if (entry.nodeIds?.includes(nodeId) ?? false) {
      return true;
    }
    return (
      entry.managerNodeId === nodeId ||
      entry.inputNodeId === nodeId ||
      entry.outputNodeId === nodeId
    );
  });
}

function outputRefForExecution(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
  execution: NodeExecutionRecord,
  nodeId: string,
): OutputRef {
  const owningSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
    workflow,
    nodeId,
  );
  return {
    kind: "node-output",
    workflowExecutionId: session.sessionId,
    workflowId: session.workflowId,
    ...(owningSubWorkflow === undefined
      ? {}
      : { subWorkflowId: owningSubWorkflow.id }),
    outputNodeId: nodeId,
    nodeExecId: execution.nodeExecId,
    artifactDir: execution.artifactDir,
  };
}

function isManagerNodeKind(
  kind: WorkflowJson["nodes"][number]["kind"],
): boolean {
  return kind === "root-manager" || kind === "subworkflow-manager";
}

function findOwningSubWorkflowByInputNodeId(
  workflow: WorkflowJson,
  nodeId: string,
): SubWorkflowRef | undefined {
  return workflow.subWorkflows.find((entry) => entry.inputNodeId === nodeId);
}

function findOwningSubWorkflowByNodeId(
  workflow: WorkflowJson,
  nodeId: string,
): SubWorkflowRef | undefined {
  return findOwningSubWorkflowByRuntimeNodeId(workflow, nodeId);
}

function isRootScopeNode(workflow: WorkflowJson, nodeId: string): boolean {
  return findOwningSubWorkflowByNodeId(workflow, nodeId) === undefined;
}

function findNodeRef(workflow: WorkflowJson, nodeId: string) {
  return workflow.nodes.find((entry) => entry.id === nodeId);
}

function isOptionalNode(workflow: WorkflowJson, nodeId: string): boolean {
  return findNodeRef(workflow, nodeId)?.execution?.mode === "optional";
}

function findOwningManagerNodeId(
  workflow: WorkflowJson,
  nodeId: string,
): string {
  return (
    findOwningSubWorkflowByRuntimeNodeId(workflow, nodeId)?.managerNodeId ??
    workflow.managerNodeId
  );
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

function buildOptionalSkipOutput(reason = "manager judged unnecessary"): Readonly<
  Record<string, unknown>
> {
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
  readonly managerNodeId: string;
  readonly managerNodeExecId: string;
  readonly decidedAt: string;
}): Result<
  {
    readonly pendingOptionalNodeDecisions: readonly PendingOptionalNodeDecision[];
    readonly queuedNodeIds: readonly string[];
  },
  string
> {
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
      action.type !== "execute-optional-node" &&
      action.type !== "skip-optional-node"
    ) {
      continue;
    }
    const nextStatus =
      action.type === "execute-optional-node" ? "execute" : "skip";
    const existingAction = actionsByNodeId.get(action.nodeId);
    if (existingAction !== undefined && existingAction.status !== nextStatus) {
      return err(
        `invalid manager control at '${input.managerNodeId}': optional node '${action.nodeId}' cannot be both executed and skipped in one manager turn`,
      );
    }
    actionsByNodeId.set(action.nodeId, {
      status: nextStatus,
      ...(action.type === "skip-optional-node" && action.reason !== undefined
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
        `invalid manager control at '${input.managerNodeId}': optional node '${nodeId}' is not currently pending`,
      );
    }
    if (currentDecision.owningManagerNodeId !== input.managerNodeId) {
      return err(
        `invalid manager control at '${input.managerNodeId}': optional node '${nodeId}' is owned by '${currentDecision.owningManagerNodeId}'`,
      );
    }
    if (!isOptionalNode(input.workflow, nodeId)) {
      return err(
        `invalid manager control at '${input.managerNodeId}': node '${nodeId}' is not optional`,
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

function isRootScopeOutputNode(
  workflow: WorkflowJson,
  nodeId: string,
): boolean {
  const node = workflow.nodes.find((entry) => entry.id === nodeId);
  return node?.kind === "output" && isRootScopeNode(workflow, nodeId);
}

function mailboxDeliveryManagerNodeId(
  workflow: WorkflowJson,
  toNodeId: string,
): string {
  if (toNodeId === workflow.managerNodeId) {
    return workflow.managerNodeId;
  }

  if (workflow.subWorkflows.some((entry) => entry.managerNodeId === toNodeId)) {
    return workflow.managerNodeId;
  }

  return (
    findOwningSubWorkflowByRuntimeNodeId(workflow, toNodeId)?.managerNodeId ??
    workflow.managerNodeId
  );
}

function resolveCommunicationBoundary(input: {
  readonly workflow: WorkflowJson;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}): {
  readonly routingScope: CommunicationRecord["routingScope"];
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
} {
  const fromSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
    input.workflow,
    input.fromNodeId,
  );
  const toSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
    input.workflow,
    input.toNodeId,
  );
  const recipientManagerSubWorkflow = input.workflow.subWorkflows.find(
    (entry) => entry.managerNodeId === input.toNodeId,
  );

  if (recipientManagerSubWorkflow !== undefined) {
    if (fromSubWorkflow === undefined) {
      return {
        routingScope: "parent-to-sub-workflow",
        toSubWorkflowId: recipientManagerSubWorkflow.id,
      };
    }
    if (fromSubWorkflow.id === recipientManagerSubWorkflow.id) {
      return {
        routingScope: "intra-sub-workflow",
        fromSubWorkflowId: fromSubWorkflow.id,
        toSubWorkflowId: recipientManagerSubWorkflow.id,
      };
    }
    return {
      routingScope: "cross-sub-workflow",
      fromSubWorkflowId: fromSubWorkflow.id,
      toSubWorkflowId: recipientManagerSubWorkflow.id,
    };
  }

  if (fromSubWorkflow !== undefined && toSubWorkflow !== undefined) {
    if (fromSubWorkflow.id === toSubWorkflow.id) {
      return {
        routingScope: "intra-sub-workflow",
        fromSubWorkflowId: fromSubWorkflow.id,
        toSubWorkflowId: toSubWorkflow.id,
      };
    }
    return {
      routingScope: "cross-sub-workflow",
      fromSubWorkflowId: fromSubWorkflow.id,
      toSubWorkflowId: toSubWorkflow.id,
    };
  }

  if (fromSubWorkflow !== undefined) {
    return {
      routingScope: "cross-sub-workflow",
      fromSubWorkflowId: fromSubWorkflow.id,
    };
  }

  if (toSubWorkflow !== undefined) {
    return {
      routingScope: "intra-sub-workflow",
      toSubWorkflowId: toSubWorkflow.id,
    };
  }

  return {
    routingScope: "intra-sub-workflow",
  };
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
        isRootScopeOutputNode(workflow, entry.nodeId),
    );
}

function buildUpstreamOutputRefs(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
  nodeId: string,
): readonly UpstreamOutputRef[] {
  const owningSubWorkflow = findOwningSubWorkflowByInputNodeId(
    workflow,
    nodeId,
  );
  const matchingCommunications = session.communications.filter(
    (communication) => {
      if (communication.status !== "delivered") {
        return false;
      }
      if (communication.toNodeId === nodeId) {
        return true;
      }
      if (owningSubWorkflow === undefined) {
        return false;
      }
      return (
        communication.toSubWorkflowId === owningSubWorkflow.id &&
        communication.toNodeId === owningSubWorkflow.managerNodeId
      );
    },
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
        ...(communication.fromSubWorkflowId === undefined
          ? {}
          : { fromSubWorkflowId: communication.fromSubWorkflowId }),
        ...(communication.toSubWorkflowId === undefined
          ? {}
          : { toSubWorkflowId: communication.toSubWorkflowId }),
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
  const refs = buildUpstreamOutputRefs(workflow, session, nodeId);
  if (refs.length === 0) {
    return ok([]);
  }

  const loaded: UpstreamInput[] = [];
  for (const ref of refs) {
    const output = await readOutputPayloadArtifact(ref.artifactDir);
    if (!output.ok) {
      return err(
        `failed to resolve upstream communication '${ref.communicationId}' for node '${nodeId}': ${output.error}`,
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

function toForwardedManagerPayload(
  input: UpstreamInput,
): ForwardedManagerPayload {
  return {
    payloadRef: {
      workflowExecutionId: input.workflowExecutionId,
      workflowId: input.workflowId,
      ...(input.subWorkflowId === undefined
        ? {}
        : { subWorkflowId: input.subWorkflowId }),
      outputNodeId: input.outputNodeId,
      nodeExecId: input.nodeExecId,
      artifactDir: input.artifactDir,
    },
    outputRaw: input.outputRaw,
  };
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
    `Subworkflow-ID: ${ref.subWorkflowId ?? "(unset)"}`,
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
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly communicationCounter: number;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly fromSubWorkflowId?: string;
  readonly toSubWorkflowId?: string;
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
    ...(input.fromSubWorkflowId === undefined
      ? {}
      : { fromSubWorkflowId: input.fromSubWorkflowId }),
    ...(input.toSubWorkflowId === undefined
      ? {}
      : { toSubWorkflowId: input.toSubWorkflowId }),
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
    ...(input.fromSubWorkflowId === undefined
      ? {}
      : { fromSubWorkflowId: input.fromSubWorkflowId }),
    ...(input.toSubWorkflowId === undefined
      ? {}
      : { toSubWorkflowId: input.toSubWorkflowId }),
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

  return {
    workflowId: input.workflowId,
    workflowExecutionId: input.workflowExecutionId,
    communicationId,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    ...(input.fromSubWorkflowId === undefined
      ? {}
      : { fromSubWorkflowId: input.fromSubWorkflowId }),
    ...(input.toSubWorkflowId === undefined
      ? {}
      : { toSubWorkflowId: input.toSubWorkflowId }),
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
}

async function persistExternalMailboxInputCommunication(input: {
  readonly artifactWorkflowRoot: string;
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
    promptText: "root workflow input mailbox delivery",
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
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly execution: NodeExecutionRecord;
  readonly outputRaw: string;
  readonly communicationCounter: number;
  readonly createdAt: string;
}): Promise<CommunicationRecord> {
  return persistCommunicationArtifact({
    artifactWorkflowRoot: input.artifactWorkflowRoot,
    workflowId: input.workflow.workflowId,
    workflowExecutionId: input.session.sessionId,
    communicationCounter: input.communicationCounter,
    fromNodeId: input.execution.nodeId,
    toNodeId: WORKFLOW_EXTERNAL_OUTPUT_NODE_ID,
    routingScope: "external-mailbox",
    deliveryKind: "external-output",
    transitionWhen: "external-mailbox:workflow-output",
    sourceNodeExecId: input.execution.nodeExecId,
    payloadRef: outputRefForExecution(
      input.workflow,
      input.session,
      input.execution,
      input.execution.nodeId,
    ),
    outputRaw: input.outputRaw,
    deliveredByNodeId: input.workflow.managerNodeId,
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
  return {
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
}

function resolveRequestedBackendSession(
  session: WorkflowSessionState,
  node: AgentNodePayload,
): AdapterExecutionInput["backendSession"] | undefined {
  if (node.sessionPolicy === undefined) {
    return undefined;
  }

  if (node.sessionPolicy.mode === "new") {
    return { mode: "new" };
  }

  const existing = session.nodeBackendSessions?.[node.id];
  if (existing === undefined) {
    return { mode: "new" };
  }

  const backend = resolveNodeExecutionBackend(node);
  if (existing.backend !== backend) {
    return { mode: "new" };
  }

  return {
    mode: "reuse",
    sessionId: existing.sessionId,
  };
}

function persistNodeBackendSession(input: {
  readonly session: WorkflowSessionState;
  readonly node: AgentNodePayload;
  readonly nodeExecId: string;
  readonly provider: string;
  readonly endedAt: string;
  readonly backendSession: AdapterExecutionInput["backendSession"];
  readonly returnedSessionId?: string;
}): Readonly<Record<string, NodeBackendSessionRecord>> {
  const current = { ...(input.session.nodeBackendSessions ?? {}) };
  if (input.node.sessionPolicy?.mode !== "reuse") {
    return current;
  }

  const sessionId = input.returnedSessionId ?? input.backendSession?.sessionId;
  if (sessionId === undefined) {
    return current;
  }

  const existing = current[input.node.id];
  current[input.node.id] = {
    nodeId: input.node.id,
    backend: resolveNodeExecutionBackend(input.node),
    provider: input.provider,
    sessionId,
    createdAt: existing?.createdAt ?? input.endedAt,
    updatedAt: input.endedAt,
    lastNodeExecId: input.nodeExecId,
  };
  return current;
}

function buildScenarioExecutableNodePayload(
  node: NodePayload,
  hasScenarioEntry: boolean,
): AgentNodePayload | null {
  const agentNodePayload = asAgentNodePayload(node);
  if (agentNodePayload !== null) {
    return agentNodePayload;
  }
  if (!hasScenarioEntry) {
    return null;
  }
  if (node.nodeType !== "command" && node.nodeType !== "container") {
    return null;
  }
  const { nodeType: _nodeType, ...rest } = node;
  return {
    ...rest,
    nodeType: "agent",
    model: `scenario/${node.nodeType}`,
    promptTemplate: node.promptTemplate ?? "",
  };
}

export async function runWorkflow(
  workflowName: string,
  options: WorkflowRunOptions = {},
  adapter?: NodeAdapter,
  guards?: EngineExecutionGuards,
): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> {
  const loaded = await loadWorkflowFromDisk(workflowName, options);
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

  const runtimeVariables = options.runtimeVariables ?? {};
  const workflow = loaded.value.bundle.workflow;
  const nodeMap = loaded.value.bundle.nodePayloads;
  const workflowNodes = new Map(
    workflow.nodes.map((entry) => [entry.id, entry]),
  );
  const loopRuleByJudgeNodeId = new Map<string, LoopRule>(
    (workflow.loops ?? []).map((entry) => [entry.judgeNodeId, entry]),
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
        message:
          `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
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
    if (options.rerunFromNodeId === undefined) {
      return err({
        exitCode: 1,
        message: "rerunFromNodeId is required when rerunFromSessionId is set",
      });
    }
    if (!workflowNodes.has(options.rerunFromNodeId)) {
      return err({
        exitCode: 1,
        message: `unknown rerun node '${options.rerunFromNodeId}'`,
      });
    }

    const source = await loadSession(options.rerunFromSessionId, options);
    if (!source.ok) {
      return err({ exitCode: 1, message: source.error.message });
    }
    if (source.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "source session workflow does not match command workflow",
      });
    }

    session = createSessionState({
      sessionId: createSessionId({ workflowId: workflow.workflowId }),
      workflowName,
      workflowId: workflow.workflowId,
      initialNodeId: options.rerunFromNodeId,
      runtimeVariables: {
        ...source.value.runtimeVariables,
        ...runtimeVariables,
      },
    });
  } else if (options.resumeSessionId !== undefined) {
    const existing = await loadSession(options.resumeSessionId, options);
    if (!existing.ok) {
      return err({ exitCode: 1, message: existing.error.message });
    }
    if (existing.value.workflowName !== workflowName) {
      return err({
        exitCode: 1,
        message: "session workflow does not match command workflow",
      });
    }
    session = cloneSession(existing.value);
    if (session.status === "completed") {
      return ok({ session, exitCode: 0 });
    }
    if ((session.activeUserActions?.length ?? 0) > 0) {
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
      initialNodeId: workflow.managerNodeId,
      runtimeVariables,
    });
  }

  if (options.resumeSessionId === undefined) {
    const humanInput = session.runtimeVariables["humanInput"];
    if (humanInput !== undefined) {
      const bootstrapCommunication =
        await persistExternalMailboxInputCommunication({
          artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          communicationCounter: session.communicationCounter,
          deliveredByNodeId: workflow.managerNodeId,
          toNodeId: workflow.managerNodeId,
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

  const outgoingEdges = new Map<string, WorkflowEdge[]>();
  workflow.edges.forEach((edge) => {
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
  const restartOnStuck = options.restartOnStuck ?? true;
  const maxStuckRestarts = options.maxStuckRestarts ?? 2;
  const stuckRestartBackoffMs = options.stuckRestartBackoffMs ?? 250;

  if ((session.activeUserActions?.length ?? 0) > 0 && session.status === "paused") {
    return ok({ session, exitCode: 4 });
  }

  while (session.queue.length > 0) {
    const persisted = await loadSession(session.sessionId, options);
    if (persisted.ok && isTerminalStatus(persisted.value.status)) {
      if (persisted.value.status === "completed") {
        return ok({ session: persisted.value, exitCode: 0 });
      }
      const exitCode = persisted.value.status === "cancelled" ? 130 : 1;
      return err({
        exitCode,
        message:
          persisted.value.lastError ?? `session ${persisted.value.status}`,
      });
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
      return err({
        exitCode: 130,
        message: cancelled.lastError ?? "cancelled",
      });
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
        lastError: `missing node definition for '${nodeId}'`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message: failed.lastError ?? "missing node definition",
      });
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
      const owningSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
        workflow,
        nodeId,
      );
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
            ...(owningSubWorkflow === undefined
              ? {}
              : { subWorkflowId: owningSubWorkflow.id }),
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
    );
    if (
      nodePayload.nodeType === "command" &&
      executableNodePayload === null
    ) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: `node '${nodeId}' requests nodeType='command', but command execution is not implemented yet`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message:
          failed.lastError ?? "unsupported command node execution request",
      });
    }
    if (
      nodePayload.nodeType === "container" &&
      executableNodePayload === null
    ) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: `node '${nodeId}' requests nodeType='container', but container execution is not implemented yet`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message:
          failed.lastError ?? "unsupported container node execution request",
      });
    }
    const agentNodePayload = executableNodePayload;
    if (
      agentNodePayload === null &&
      nodePayload.nodeType !== "user-action" &&
      !skipOptionalNode
    ) {
      const failed: WorkflowSessionState = {
        ...session,
        queue,
        status: "failed",
        currentNodeId: nodeId,
        endedAt: nowIso(),
        lastError: `node '${nodeId}' is missing agent execution fields`,
      };
      await saveSession(failed, options);
      return err({
        exitCode: 1,
        message: failed.lastError ?? "invalid agent node payload",
      });
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
      const mergedVariables = mergeVariables(
        executionNodePayload.variables,
        session.runtimeVariables,
      );
      const upstreamOutputRefs = buildUpstreamOutputRefs(
        workflow,
        session,
        nodeId,
      );
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
        return err({
          exitCode: 1,
          message:
            failed.lastError ?? "upstream communication resolution failed",
        });
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
        fromSubWorkflowId: turn.fromSubWorkflowId,
        toSubWorkflowId: turn.toSubWorkflowId,
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
          ...(nodeRef.kind === undefined ? {} : { nodeKind: nodeRef.kind }),
          upstream: upstreamBindingInputs,
          transcript: transcriptInput,
        });
        executionMailbox = buildNodeExecutionMailbox({
          workflow,
          nodeRef,
          node: executionNodePayload,
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
          lastError: `input assembly failed at '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 3,
          message: failed.lastError ?? "input assembly failed",
        });
      }
      if (executionMailbox === undefined) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `input assembly failed at '${nodeId}': execution mailbox was not created`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 3,
          message: failed.lastError ?? "execution mailbox creation failed",
        });
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
          lastError: `failed to persist execution mailbox at '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 1,
          message:
            failed.lastError ?? "execution mailbox persistence failed",
        });
      }

      const baseInputPayload = {
        sessionId: session.sessionId,
        workflowExecutionId: session.sessionId,
        workflowId: workflow.workflowId,
        nodeId,
        nodeExecId,
        promptTemplate: executionNodePayload.promptTemplate,
        promptText: assembledPromptText,
        arguments: assembledArguments,
        variables: mergedVariables,
        upstreamOutputRefs,
        upstreamCommunications: upstreamCommunicationIds,
        executionMailbox,
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
          nodeExecId,
          status: "skipped",
          artifactDir,
          startedAt,
          endedAt,
        };
        const outputRef = outputRefForExecution(workflow, session, nodeExecution, nodeId);
        const outputJson = stableJson(outputPayload);
        const outputRaw = `${outputJson}\n`;
        const inputHash = sha256Hex(inputJson);
        const outputHash = sha256Hex(outputJson);
        const nextNodes = selected.map((edge) => edge.to);
        await writeRawTextFile(path.join(artifactDir, "output.json"), outputRaw);
        await writeJsonFile(path.join(artifactDir, "meta.json"), {
          nodeId,
          nodeExecId,
          status: "skipped",
          startedAt,
          endedAt,
          optionalDecision: "skip",
        });
        await writeJsonFile(path.join(artifactDir, "handoff.json"), {
          schemaVersion: 1,
          generatedAt: endedAt,
          nodeId,
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
              nodeExecId,
              status: "skipped",
              artifactDir,
              startedAt,
              endedAt,
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
            const boundary = resolveCommunicationBoundary({
              workflow,
              fromNodeId: edge.from,
              toNodeId: edge.to,
            });
            return persistCommunicationArtifact({
              artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              communicationCounter: session.communicationCounter + index,
              fromNodeId: edge.from,
              toNodeId: edge.to,
              ...(boundary.fromSubWorkflowId === undefined
                ? {}
                : { fromSubWorkflowId: boundary.fromSubWorkflowId }),
              ...(boundary.toSubWorkflowId === undefined
                ? {}
                : { toSubWorkflowId: boundary.toSubWorkflowId }),
              routingScope: boundary.routingScope,
              deliveryKind:
                edge.to === edge.from ? "loop-back" : "edge-transition",
              transitionWhen: edge.when,
              sourceNodeExecId: nodeExecId,
              payloadRef: outputRef,
              outputRaw,
              deliveredByNodeId: mailboxDeliveryManagerNodeId(
                workflow,
                edge.to,
              ),
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
          runtimeVariables: isRootScopeOutputNode(workflow, nodeId)
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

      if (agentNodePayload === null) {
        const failed: WorkflowSessionState = {
          ...session,
          queue,
          status: "failed",
          currentNodeId: nodeId,
          endedAt: nowIso(),
          lastError: `node '${nodeId}' is missing agent execution fields`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 1,
          message: failed.lastError ?? "invalid agent node payload",
        });
      }

      let backendSession = resolveRequestedBackendSession(
        session,
        agentNodePayload,
      );
      const composedPrompts = composeExecutionPrompts({
        promptComposition: {
          workflow,
          nodeRef,
          node: agentNodePayload,
          nodePayloads: nodeMap,
          runtimeVariables: session.runtimeVariables,
          basePromptText: assembledPromptText,
          assembledArguments,
          upstreamInputs,
          executionMailbox,
        },
        includeSessionStartPrompt: backendSession?.mode !== "reuse",
      });
      const effectivePromptText = composedPrompts.promptText;
      const systemPromptText = composedPrompts.systemPromptText;
      const requestedBackendSessionMode = backendSession?.mode;
      let backendSessionId: string | undefined = backendSession?.sessionId;
      let backendSessionProvider: string | undefined;

      const inputPayload = {
        ...baseInputPayload,
        model: agentNodePayload.model,
        ...(agentNodePayload.systemPromptTemplate === undefined
          ? {}
          : { systemPromptTemplate: agentNodePayload.systemPromptTemplate }),
        ...(agentNodePayload.sessionStartPromptTemplate === undefined
          ? {}
          : {
              sessionStartPromptTemplate:
                agentNodePayload.sessionStartPromptTemplate,
            }),
        ...(systemPromptText === undefined ? {} : { systemPromptText }),
        promptText: effectivePromptText,
        outputContract:
          agentNodePayload.output === undefined
            ? undefined
            : {
                description: agentNodePayload.output.description,
                jsonSchema: agentNodePayload.output.jsonSchema,
                maxValidationAttempts:
                  resolveOutputValidationAttempts(agentNodePayload),
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
      const timeoutMs = resolveTimeoutMs(
        agentNodePayload,
        workflow.defaults.nodeTimeoutMs,
        options.defaultTimeoutMs,
      );
      let ambientManagerContext: AdapterAmbientManagerContext | undefined;
      let managerSessionId: string | undefined;

      if (isManagerNodeKind(nodeRef.kind) && options.dryRun !== true) {
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
            lastError: `failed to start manager session at '${nodeId}': ${message}`,
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

      if (options.dryRun === true) {
        outputPayload = {
          provider: "dry-run",
          model: agentNodePayload.model,
          ...(systemPromptText === undefined ? {} : { systemPromptText }),
          promptText: effectivePromptText,
          completionPassed: true,
          when: { always: true },
          payload: { skippedExecution: true },
        };
      } else {
        let finalizedOutput: Readonly<Record<string, unknown>> | undefined;
        const hasOutputContract = agentNodePayload.output !== undefined;
        const maxOutputAttempts = hasOutputContract
          ? resolveOutputValidationAttempts(agentNodePayload)
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
            outputAttemptId === undefined
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
            candidatePath === undefined
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
            if (hasOutputContract && contractCandidatePath === undefined) {
              throw new Error(
                "candidate path must exist when node.output is configured",
              );
            }
            const adapterOutputContract =
              !hasOutputContract || agentNodePayload.output === undefined
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
            const execution = await executeAdapterWithTimeout(
              effectiveAdapter,
              {
                workflowId: workflow.workflowId,
                workflowExecutionId: session.sessionId,
                nodeId,
                nodeExecId,
                node: agentNodePayload,
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
                ...(backendSession === undefined ? {} : { backendSession }),
                ...(ambientManagerContext === undefined
                  ? {}
                  : { ambientManagerContext }),
                ...(adapterOutputContract === undefined
                  ? {}
                  : { output: adapterOutputContract }),
              },
              timeoutMs,
            );

            if (!execution.ok) {
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
                    model: agentNodePayload.model,
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
                model: agentNodePayload.model,
                promptText: effectivePromptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: execution.error.code,
              };
              break;
            }

            backendSessionProvider = execution.value.provider;
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
            if (contractCandidatePath === undefined) {
              throw new Error(
                "candidate path must exist when resolving contract output",
              );
            }

            const candidateResult = await resolveCandidatePayload({
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
            const schema = agentNodePayload.output?.jsonSchema;
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
          model: agentNodePayload.model,
          promptText: effectivePromptText,
          completionPassed: false,
          when: {},
          payload: {},
          error: "provider_error",
        };
      }

      const endedAt = nowIso();
      const nextNodeBackendSessions = persistNodeBackendSession({
        session,
        node: agentNodePayload,
        nodeExecId,
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
        nodeExecId,
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
      if (isManagerNodeKind(nodeRef.kind)) {
        try {
          const businessPayload = readBusinessPayload(outputPayload);
          managerControl =
            businessPayload === null
              ? null
              : parseManagerControlPayload(businessPayload, workflow, {
                  managerNodeId: nodeId,
                  managerKind: nodeRef.kind,
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
              lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
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
            lastError: `invalid manager control at '${nodeId}': ${message}`,
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
                  lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
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
                lastError: `invalid manager control at '${nodeId}': manager execution cannot mix GraphQL manager messages with payload managerControl`,
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
                lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
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
              lastError: `invalid manager control at '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 5,
              message: failed.lastError ?? "invalid manager control",
            });
          }
        }

        if (
          nodeId !== workflow.managerNodeId &&
          (managerControl?.startSubWorkflowIds.length ?? 0) > 0
        ) {
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
              lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 1,
              message: failed.lastError ?? "failed to finalize manager session",
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
            lastError: `invalid manager control at '${nodeId}': only the root manager can start sub-workflows`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 5,
            message: failed.lastError ?? "invalid manager control",
          });
        }

        if (
          nodeRef.kind !== "subworkflow-manager" &&
          (managerControl?.childInputNodeIds.length ?? 0) > 0
        ) {
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
              lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
            };
            await saveSession(failed, options);
            return err({
              exitCode: 1,
              message: failed.lastError ?? "failed to finalize manager session",
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
            lastError: `invalid manager control at '${nodeId}': only a subworkflow-manager can dispatch child input nodes`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 5,
            message: failed.lastError ?? "invalid manager control",
          });
        }
      }
      const optionalManagerDecisionsResult = applyOptionalManagerDecisions({
        managerControl,
        session,
        workflow,
        managerNodeId: nodeId,
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
            lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "failed to finalize manager session",
          });
        }
        await saveSession({
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
        }, options);
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
          lastError: `failed to finalize manager session at '${nodeId}': ${message}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 1,
          message: failed.lastError ?? "failed to finalize manager session",
        });
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
              {
                nodeId,
                nodeExecId,
                status: nodeStatus,
                artifactDir,
                startedAt,
                endedAt,
                ...(restartAttempt === 0
                  ? {}
                  : { attempt: restartAttempt + 1 }),
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
              },
            ],
            loopIterationCounts: updatedLoopIterationCounts,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: `loop transition '${transition}' has no matching edge at '${nodeId}'`,
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
        nodeExecId,
        status: nodeStatus,
        startedAt,
        endedAt,
        model: agentNodePayload.model,
        timeoutMs,
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
      const outputRef = outputRefForExecution(
        workflow,
        { ...session, workflowId: workflow.workflowId },
        {
          nodeId,
          nodeExecId,
          status: nodeStatus,
          artifactDir,
          startedAt,
          endedAt,
        },
        nodeId,
      );
      const inputHash = sha256Hex(inputJson);
      const outputHash = sha256Hex(outputJson);
      let currentCommunications: readonly CommunicationRecord[] =
        session.communications;
      let currentCommunicationCounter = session.communicationCounter;
      const currentRuntimeVariables = isRootScopeOutputNode(workflow, nodeId)
        ? {
            ...session.runtimeVariables,
            workflowOutput: outputPayload["payload"],
          }
        : session.runtimeVariables;

      const handoffPayload = {
        schemaVersion: 1,
        generatedAt: endedAt,
        nodeId,
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
            nodeExecId,
            status: nodeStatus,
            artifactDir,
            startedAt,
            endedAt,
            ...(restartAttempt === 0 ? {} : { attempt: restartAttempt + 1 }),
            ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
            ...(outputValidationErrors.length === 0
              ? {}
              : { outputValidationErrors }),
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
        if (restartOnStuck && restartAttempt < maxStuckRestarts) {
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
            lastError: `stuck detected at '${nodeId}', restarting attempt ${restartAttempt + 1}`,
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
          lastError: `node timeout at '${nodeId}'`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 6,
          message: failed.lastError ?? "node timeout",
        });
      }

      if (nodeStatus === "failed") {
        const failureReason =
          outputPayload["error"] === "invalid_output"
            ? `invalid adapter output at '${nodeId}'`
            : outputValidationErrors.length > 0
              ? `output validation failed at '${nodeId}'`
              : `adapter failure at '${nodeId}'`;
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
        return err({
          exitCode: 5,
          message: failed.lastError ?? "adapter failure",
        });
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
              ? `completion condition not met at '${nodeId}'`
              : `completion condition not met at '${nodeId}': ${completion.reason}`,
        };
        await saveSession(failed, options);
        return err({
          exitCode: 3,
          message: failed.lastError ?? "completion condition not met",
        });
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
        return err({
          exitCode: 1,
          message: failed.lastError ?? "mailbox consumption persistence failed",
        });
      }
      currentCommunications = consumedCommunicationsResult.value;
      const transitionCommunications = await Promise.all(
        selected.map((edge, index) => {
          const boundary = resolveCommunicationBoundary({
            workflow,
            fromNodeId: edge.from,
            toNodeId: edge.to,
          });
          return persistCommunicationArtifact({
            artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            communicationCounter: currentCommunicationCounter + index,
            fromNodeId: edge.from,
            toNodeId: edge.to,
            ...(boundary.fromSubWorkflowId === undefined
              ? {}
              : { fromSubWorkflowId: boundary.fromSubWorkflowId }),
            ...(boundary.toSubWorkflowId === undefined
              ? {}
              : { toSubWorkflowId: boundary.toSubWorkflowId }),
            routingScope: boundary.routingScope,
            deliveryKind:
              edge.to === edge.from ? "loop-back" : "edge-transition",
            transitionWhen: edge.when,
            sourceNodeExecId: nodeExecId,
            payloadRef: outputRef,
            outputRaw,
            deliveredByNodeId: mailboxDeliveryManagerNodeId(workflow, edge.to),
            createdAt: endedAt,
          });
        }),
      );
      currentCommunications = [
        ...currentCommunications,
        ...transitionCommunications,
      ];
      currentCommunicationCounter += transitionCommunications.length;

      const transitions = [
        ...session.transitions,
        ...selected.map((edge) => ({
          from: edge.from,
          to: edge.to,
          when: edge.when,
        })),
      ];
      const transitionNextNodes = selected.map((edge) => edge.to);
      const pendingSessionState: WorkflowSessionState = {
        ...session,
        queue: [...queue, ...transitionNextNodes].filter(
          (value, index, all) => all.indexOf(value) === index,
        ),
        nodeExecutions,
        communicationCounter: currentCommunicationCounter,
        communications: currentCommunications,
        runtimeVariables: currentRuntimeVariables,
      };
      let managerPlannedInputs = isManagerNodeKind(nodeRef.kind)
        ? nodeRef.kind === "subworkflow-manager"
          ? [
              ...((managerControl?.overridesChildInputPlanning ?? false)
                ? (managerControl?.childInputNodeIds ?? [])
                : planSubWorkflowChildInputs({
                    workflow,
                    session: pendingSessionState,
                    managerNodeId: nodeId,
                  })),
            ]
          : []
        : [];

      let managerPlannedCommunications: readonly CommunicationRecord[] = [];
      if (nodeId === workflow.managerNodeId) {
        const plannedSubWorkflowStarts =
          managerControl?.overridesRootSubWorkflowPlanning === true
            ? managerControl.startSubWorkflowIds
                .map((subWorkflowId) =>
                  workflow.subWorkflows.find(
                    (entry) => entry.id === subWorkflowId,
                  ),
                )
                .filter(
                  (subWorkflow): subWorkflow is SubWorkflowRef =>
                    subWorkflow !== undefined,
                )
            : planRootManagerSubWorkflowStarts({
                workflow,
                session: pendingSessionState,
              });
        const persistedStarts: CommunicationRecord[] = [];
        for (const subWorkflow of plannedSubWorkflowStarts) {
          if (subWorkflow.managerNodeId === workflow.managerNodeId) {
            managerPlannedInputs.push(subWorkflow.inputNodeId);
            continue;
          }
          const communication = await persistCommunicationArtifact({
            artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            communicationCounter: currentCommunicationCounter,
            fromNodeId: nodeId,
            toNodeId: subWorkflow.managerNodeId,
            toSubWorkflowId: subWorkflow.id,
            routingScope: "parent-to-sub-workflow",
            deliveryKind: "edge-transition",
            transitionWhen: `sub-workflow-start:${subWorkflow.id}`,
            sourceNodeExecId: nodeExecId,
            payloadRef: outputRef,
            outputRaw,
            deliveredByNodeId: mailboxDeliveryManagerNodeId(
              workflow,
              subWorkflow.managerNodeId,
            ),
            createdAt: endedAt,
          });
          currentCommunicationCounter += 1;
          persistedStarts.push(communication);
          managerPlannedInputs.push(subWorkflow.managerNodeId);
        }
        const persistedChildInputs: CommunicationRecord[] = [];
        const rootManagedSubWorkflows = workflow.subWorkflows.filter(
          (entry) => entry.managerNodeId === nodeId,
        );
        for (const subWorkflow of rootManagedSubWorkflows) {
          const forwardedPayloads = upstreamInputs
            .filter((entry) => entry.toSubWorkflowId === subWorkflow.id)
            .map((entry) => toForwardedManagerPayload(entry));
          if (forwardedPayloads.length === 0) {
            continue;
          }
          managerPlannedInputs.push(subWorkflow.inputNodeId);
          for (const forwarded of forwardedPayloads) {
            const communication = await persistCommunicationArtifact({
              artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              communicationCounter: currentCommunicationCounter,
              fromNodeId: nodeId,
              toNodeId: subWorkflow.inputNodeId,
              toSubWorkflowId: subWorkflow.id,
              routingScope: "intra-sub-workflow",
              deliveryKind: "edge-transition",
              transitionWhen: `root-manager-input:${subWorkflow.inputNodeId}`,
              sourceNodeExecId: forwarded.payloadRef.nodeExecId,
              payloadRef: forwarded.payloadRef,
              outputRaw: forwarded.outputRaw,
              deliveredByNodeId: mailboxDeliveryManagerNodeId(
                workflow,
                subWorkflow.inputNodeId,
              ),
              createdAt: endedAt,
            });
            currentCommunicationCounter += 1;
            persistedChildInputs.push(communication);
          }
        }
        managerPlannedCommunications = [
          ...persistedStarts,
          ...persistedChildInputs,
        ];
      } else if (nodeRef.kind === "subworkflow-manager") {
        const forwardedPayloads = [{ payloadRef: outputRef, outputRaw }];
        const persistedChildInputs: CommunicationRecord[] = [];
        for (const inputNodeId of managerPlannedInputs) {
          for (const forwarded of forwardedPayloads) {
            const communication = await persistCommunicationArtifact({
              artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              communicationCounter: currentCommunicationCounter,
              fromNodeId: nodeId,
              toNodeId: inputNodeId,
              routingScope: "intra-sub-workflow",
              deliveryKind: "edge-transition",
              transitionWhen: `subworkflow-manager-input:${inputNodeId}`,
              sourceNodeExecId: forwarded.payloadRef.nodeExecId,
              payloadRef: forwarded.payloadRef,
              outputRaw: forwarded.outputRaw,
              deliveredByNodeId: mailboxDeliveryManagerNodeId(
                workflow,
                inputNodeId,
              ),
              createdAt: endedAt,
            });
            currentCommunicationCounter += 1;
            persistedChildInputs.push(communication);
          }
        }
        managerPlannedCommunications = persistedChildInputs;
      }
      currentCommunications = [
        ...currentCommunications,
        ...managerPlannedCommunications,
      ];

      let conversationTurns = [...(session.conversationTurns ?? [])];
      let conversationPlannedInputs: string[] = [];
      if (isManagerNodeKind(nodeRef.kind)) {
        const conversationRound = await executeConversationRound({
          workflow,
          workflowExecutionId: session.sessionId,
          session: {
            ...session,
            nodeExecutions,
            conversationTurns,
            communicationCounter: currentCommunicationCounter,
            communications: currentCommunications,
          },
        });

        if (conversationRound.status === "failed") {
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
            conversationTurns,
            nodeBackendSessions: nextNodeBackendSessions,
            lastError: "conversation round execution failed",
          };
          await saveSession(failed, options);
          return err({
            exitCode: 1,
            message: failed.lastError ?? "conversation round execution failed",
          });
        }

        if (conversationRound.turns.length > 0) {
          const successfulTurnDeliveries: Array<{
            readonly turn: (typeof conversationRound.turns)[number];
            readonly communication: CommunicationRecord;
            readonly receiverManagerNodeId: string;
          }> = [];
          for (const turn of conversationRound.turns) {
            if (turn.toManagerNodeId === undefined) {
              continue;
            }
            const parsedOutput = await readOutputPayloadArtifact(
              turn.outputRef.artifactDir,
            );
            if (!parsedOutput.ok) {
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
                conversationTurns,
                nodeBackendSessions: nextNodeBackendSessions,
                lastError:
                  `failed to resolve conversation output for '${turn.fromSubWorkflowId}' -> '${turn.toSubWorkflowId}': ` +
                  parsedOutput.error,
              };
              await saveSession(failed, options);
              return err({
                exitCode: 1,
                message:
                  failed.lastError ?? "conversation output resolution failed",
              });
            }
            const communication = await persistCommunicationArtifact({
              artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
              workflowId: workflow.workflowId,
              workflowExecutionId: session.sessionId,
              communicationCounter: currentCommunicationCounter,
              fromNodeId: turn.fromManagerNodeId,
              toNodeId: turn.toManagerNodeId,
              fromSubWorkflowId: turn.fromSubWorkflowId,
              toSubWorkflowId: turn.toSubWorkflowId,
              routingScope: "cross-sub-workflow",
              deliveryKind: "conversation-turn",
              transitionWhen: `conversation:${turn.conversationId}:${turn.turnIndex}`,
              sourceNodeExecId: turn.outputRef.nodeExecId,
              payloadRef: turn.outputRef,
              outputRaw: parsedOutput.value.raw,
              deliveredByNodeId: workflow.managerNodeId,
              createdAt: endedAt,
            });
            currentCommunicationCounter += 1;
            successfulTurnDeliveries.push({
              turn,
              communication,
              receiverManagerNodeId: turn.toManagerNodeId,
            });
          }
          currentCommunications = [
            ...currentCommunications,
            ...successfulTurnDeliveries.map((entry) => entry.communication),
          ];
          conversationTurns = [
            ...conversationTurns,
            ...successfulTurnDeliveries.map((entry) => ({
              ...entry.turn,
              communicationId: entry.communication.communicationId,
              sentAt: endedAt,
            })),
          ];
          conversationPlannedInputs = successfulTurnDeliveries.map(
            (entry) => entry.receiverManagerNodeId,
          );
        }
      }

      const retryNodeIds = managerControl?.retryNodeIds ?? [];
      const nextQueue = [
        ...queue,
        ...transitionNextNodes,
        ...managerPlannedInputs,
        ...conversationPlannedInputs,
        ...queuedOptionalDecisionNodeIds,
      ].filter((value, index, all) => all.indexOf(value) === index);
      const nextQueueWithRetries = [...nextQueue, ...retryNodeIds].filter(
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
        conversationTurns,
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
    return err({
      exitCode,
      message:
        beforeComplete.value.lastError ??
        `session ${beforeComplete.value.status}`,
    });
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
    const outputPayload = await readOutputPayloadArtifact(
      publishedResultExecution.artifactDir,
    );
    if (!outputPayload.ok) {
      const publicationFailureMessage =
        `failed to publish selected external output for '${publishedResultExecution.nodeId}' ` +
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
        `failed to persist external output publication for '${publishedResultExecution.nodeId}' ` +
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
    return err({ exitCode: 1, message: persistedCompleted.error });
  }
  return ok({ session: completed, exitCode: 0 });
}
