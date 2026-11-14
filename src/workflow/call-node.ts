import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
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
import {
  DispatchingNodeAdapter,
  resolveNodeExecutionBackend,
} from "./adapters/dispatch";
import { assembleNodeInput } from "./input-assembly";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "./json-schema";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "./node-execution-mailbox";
import { loadWorkflowFromDisk } from "./load";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
} from "./manager-session-store";
import { composeExecutionPrompts } from "./prompt-composition";
import { err, ok, type Result } from "./result";
import { inspectWorkflowRuntimeReadiness } from "./runtime-readiness";
import { saveNodeExecutionToRuntimeDb } from "./runtime-db";
import {
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "./session-store";
import type {
  NodeBackendSessionRecord,
  NodeExecutionRecord,
  OutputRef,
  SessionStatus,
  WorkflowSessionState,
} from "./session";
import type {
  AgentNodePayload,
  JsonObject,
  LoadOptions,
  NodeKind,
  NodePayload,
  WorkflowJson,
} from "./types";
import { asAgentNodePayload } from "./types";

export interface CallNodeInput extends LoadOptions, SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly nodeId: string;
  readonly message?: unknown;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly defaultTimeoutMs?: number;
}

export interface CallNodeSuccess {
  readonly session: WorkflowSessionState;
  readonly nodeExecution: NodeExecutionRecord;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRef: OutputRef;
  readonly exitCode: 0;
}

export interface CallNodeFailure {
  readonly session: WorkflowSessionState;
  readonly nodeExecution?: NodeExecutionRecord;
  readonly exitCode: number;
  readonly message: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nextNodeExecId(counter: number): string {
  return `exec-${String(counter).padStart(6, "0")}`;
}

function nextManagerSessionId(nodeExecId: string): string {
  return `mgrsess-${nodeExecId}`;
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

function isManagerNodeKind(kind: NodeKind | undefined): boolean {
  return kind === "root-manager" || kind === "subworkflow-manager";
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

const MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS = 8;
const MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH = 240;
const NON_CONTRACT_CANDIDATE_FILE_ERROR =
  "adapter output.candidateFilePath is only supported when node.output is configured";

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
    sections.push(
      contract.jsonSchema === undefined
        ? "Return a corrected JSON object."
        : "Return a corrected JSON object that satisfies the schema.",
    );
  }
  return sections.join("\n");
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

async function executeAdapterWithTimeout(
  adapter: NodeAdapter,
  input: AdapterExecutionInput,
  timeoutMs: number,
): Promise<Result<AdapterExecutionOutput, { code: string; message: string }>> {
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
      return err({ code: error.code, message: error.message });
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      return err({ code: "timeout", message: "adapter execution timed out" });
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

function findOwningSubWorkflowByRuntimeNodeId(
  workflow: WorkflowJson,
  nodeId: string,
) {
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

function isRootScopeOutputNode(
  workflow: WorkflowJson,
  nodeId: string,
): boolean {
  const node = workflow.nodes.find((entry) => entry.id === nodeId);
  return (
    node?.kind === "output" &&
    findOwningSubWorkflowByRuntimeNodeId(workflow, nodeId) === undefined
  );
}

function outputRefForExecution(
  workflow: WorkflowJson,
  session: WorkflowSessionState,
  execution: NodeExecutionRecord,
): OutputRef {
  const owningSubWorkflow = findOwningSubWorkflowByRuntimeNodeId(
    workflow,
    execution.nodeId,
  );
  return {
    kind: "node-output",
    workflowExecutionId: session.sessionId,
    workflowId: session.workflowId,
    ...(owningSubWorkflow === undefined
      ? {}
      : { subWorkflowId: owningSubWorkflow.id }),
    outputNodeId: execution.nodeId,
    nodeExecId: execution.nodeExecId,
    artifactDir: execution.artifactDir,
  };
}

function buildCommitMessageTemplate(
  inputHash: string,
  outputHash: string,
  ref: OutputRef,
): string {
  return [
    `chore(workflow): checkpoint node ${ref.outputNodeId}`,
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
    "Next-Node: (manager-driven)",
  ].join("\n");
}

class OutputValidator {
  async validate(input: {
    readonly node: NodePayload;
    readonly execution: AdapterExecutionOutput;
    readonly expectedCandidatePath?: string;
  }): Promise<
    Result<
      {
        readonly payload: Readonly<Record<string, unknown>>;
        readonly errors: readonly JsonSchemaValidationError[];
      },
      {
        readonly errors: readonly JsonSchemaValidationError[];
        readonly retryable: boolean;
        readonly payload?: Readonly<Record<string, unknown>>;
      }
    >
  > {
    if (input.node.output === undefined) {
      return ok({ payload: input.execution.payload, errors: [] });
    }

    if (input.expectedCandidatePath === undefined) {
      return err({
        errors: [
          {
            path: "$",
            message: "candidate path must exist when node.output is configured",
          },
        ],
        retryable: false,
      });
    }

    const candidateResult = await resolveCandidatePayload({
      expectedCandidatePath: input.expectedCandidatePath,
      execution: input.execution,
    });
    if (!candidateResult.ok) {
      return err({
        errors: [{ path: "$", message: candidateResult.error.message }],
        retryable: candidateResult.error.retryable,
      });
    }

    const validationErrors =
      input.node.output.jsonSchema === undefined
        ? []
        : validateJsonValueAgainstSchema({
            schema: input.node.output.jsonSchema as JsonObject,
            value: candidateResult.value,
          });
    if (validationErrors.length > 0) {
      return err({
        payload: candidateResult.value,
        errors: validationErrors,
        retryable: true,
      });
    }

    return ok({
      payload: candidateResult.value,
      errors: [],
    });
  }
}

class MailboxPublisher {
  readonly #options: LoadOptions;

  constructor(options: LoadOptions) {
    this.#options = options;
  }

  async publish(input: {
    readonly workflow: WorkflowJson;
    readonly session: WorkflowSessionState;
    readonly node: NodePayload;
    readonly nodeExecution: NodeExecutionRecord;
    readonly artifactDir: string;
    readonly inputJson: string;
    readonly outputPayload: Readonly<Record<string, unknown>>;
    readonly timeoutMs: number;
    readonly requestedBackendSessionMode?: NodeExecutionRecord["backendSessionMode"];
  }): Promise<OutputRef> {
    const outputJson = stableJson(input.outputPayload);
    const outputRaw = `${outputJson}\n`;
    const inputHash = sha256Hex(input.inputJson);
    const outputHash = sha256Hex(outputJson);
    const outputRef = outputRefForExecution(
      input.workflow,
      input.session,
      input.nodeExecution,
    );
    const handoffPayload = {
      schemaVersion: 1,
      generatedAt: input.nodeExecution.endedAt,
      nodeId: input.nodeExecution.nodeId,
      outputRef,
      inputHash: `sha256:${inputHash}`,
      outputHash: `sha256:${outputHash}`,
      nextNodes: [],
    };
    const metaPayload = {
      nodeId: input.nodeExecution.nodeId,
      nodeExecId: input.nodeExecution.nodeExecId,
      status: input.nodeExecution.status,
      startedAt: input.nodeExecution.startedAt,
      endedAt: input.nodeExecution.endedAt,
      model: input.node.model,
      timeoutMs: input.timeoutMs,
      ...(input.nodeExecution.outputAttemptCount === undefined
        ? {}
        : { outputAttemptCount: input.nodeExecution.outputAttemptCount }),
      ...(input.nodeExecution.outputValidationErrors === undefined
        ? {}
        : {
            outputValidationErrors: input.nodeExecution.outputValidationErrors,
          }),
      ...(input.nodeExecution.backendSessionId === undefined
        ? {}
        : { backendSessionId: input.nodeExecution.backendSessionId }),
      ...(input.requestedBackendSessionMode === undefined
        ? {}
        : { backendSessionMode: input.requestedBackendSessionMode }),
    };

    await writeRawTextFile(
      path.join(input.artifactDir, "output.json"),
      outputRaw,
    );
    await writeJsonFile(path.join(input.artifactDir, "meta.json"), metaPayload);
    await writeJsonFile(
      path.join(input.artifactDir, "handoff.json"),
      handoffPayload,
    );
    await writeRawTextFile(
      path.join(input.artifactDir, "commit-message.txt"),
      `${buildCommitMessageTemplate(inputHash, outputHash, outputRef)}\n`,
    );

    try {
      await saveNodeExecutionToRuntimeDb(
        {
          sessionId: input.session.sessionId,
          nodeId: input.nodeExecution.nodeId,
          nodeExecId: input.nodeExecution.nodeExecId,
          status: input.nodeExecution.status,
          artifactDir: input.nodeExecution.artifactDir,
          startedAt: input.nodeExecution.startedAt,
          endedAt: input.nodeExecution.endedAt,
          ...(input.nodeExecution.outputAttemptCount === undefined
            ? {}
            : { outputAttemptCount: input.nodeExecution.outputAttemptCount }),
          ...(input.nodeExecution.outputValidationErrors === undefined
            ? {}
            : {
                outputValidationErrors:
                  input.nodeExecution.outputValidationErrors,
              }),
          ...(input.requestedBackendSessionMode === undefined
            ? {}
            : { backendSessionMode: input.requestedBackendSessionMode }),
          ...(input.nodeExecution.backendSessionId === undefined
            ? {}
            : { backendSessionId: input.nodeExecution.backendSessionId }),
          inputJson: input.inputJson,
          outputJson,
          inputHash: `sha256:${inputHash}`,
          outputHash: `sha256:${outputHash}`,
        },
        this.#options,
      );
    } catch {
      // best effort index
    }

    return outputRef;
  }
}

class ExecutionDispatcher {
  readonly #adapter: NodeAdapter;
  readonly #validator = new OutputValidator();
  readonly #publisher: MailboxPublisher;

  constructor(adapter: NodeAdapter, options: LoadOptions) {
    this.#adapter = adapter;
    this.#publisher = new MailboxPublisher(options);
  }

  async dispatch(
    input: CallNodeInput,
  ): Promise<Result<CallNodeSuccess, CallNodeFailure>> {
    const sessionResult = await loadSession(input.workflowRunId, input);
    if (!sessionResult.ok) {
      const session = {
        sessionId: input.workflowRunId,
        workflowName: "",
        workflowId: input.workflowId,
        status: "running" as const,
        startedAt: nowIso(),
        queue: [],
        nodeExecutionCounter: 0,
        nodeExecutionCounts: {},
        transitions: [],
        nodeExecutions: [],
        communicationCounter: 0,
        communications: [],
        runtimeVariables: {},
      } as WorkflowSessionState;
      return err({
        session,
        exitCode: 1,
        message: sessionResult.error.message,
      });
    }

    let session = sessionResult.value;
    if (isTerminalSessionStatus(session.status)) {
      return err({
        session,
        exitCode: 1,
        message: `cannot call node '${input.nodeId}' on terminal session '${session.sessionId}' with status '${session.status}'`,
      });
    }
    if (session.workflowId !== input.workflowId) {
      return err({
        session,
        exitCode: 1,
        message: `workflow id mismatch: session '${session.sessionId}' belongs to '${session.workflowId}', not '${input.workflowId}'`,
      });
    }

    const loaded = await loadWorkflowFromDisk(session.workflowName, input);
    if (!loaded.ok) {
      return err({
        session,
        exitCode: loaded.error.code === "VALIDATION" ? 2 : 1,
        message: loaded.error.message,
      });
    }
    if (loaded.value.bundle.workflow.workflowId !== input.workflowId) {
      return err({
        session,
        exitCode: 1,
        message: `workflow '${session.workflowName}' resolved to workflowId '${loaded.value.bundle.workflow.workflowId}', not '${input.workflowId}'`,
      });
    }

    const workflow = loaded.value.bundle.workflow;
    const nodeRef = workflow.nodes.find((entry) => entry.id === input.nodeId);
    const nodePayload = loaded.value.bundle.nodePayloads[input.nodeId];
    if (nodeRef === undefined || nodePayload === undefined) {
      return err({
        session,
        exitCode: 1,
        message: `missing node definition for '${input.nodeId}'`,
      });
    }
    if (nodeRef.execution?.mode === "optional") {
      return err({
        session,
        exitCode: 1,
        message: `node '${input.nodeId}' is optional and must be executed through the workflow scheduler after an owning-manager decision`,
      });
    }
    if (nodePayload.nodeType === "user-action") {
      return err({
        session,
        exitCode: 1,
        message: `node '${input.nodeId}' requests nodeType='user-action', but direct call-node execution is not supported`,
      });
    }
    if (nodePayload.nodeType === "command") {
      return err({
        session,
        exitCode: 1,
        message: `node '${input.nodeId}' requests nodeType='command', but command execution is not implemented yet`,
      });
    }
    if (nodePayload.nodeType === "container") {
      return err({
        session,
        exitCode: 1,
        message: `node '${input.nodeId}' requests nodeType='container', but container execution is not implemented yet`,
      });
    }

    if (
      this.#adapter instanceof DispatchingNodeAdapter &&
      input.mockScenario === undefined &&
      input.dryRun !== true
    ) {
      const readiness = await inspectWorkflowRuntimeReadiness(
        loaded.value.bundle,
        {
          ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
          ...(input.env === undefined ? {} : { env: input.env }),
          onlyNodeIds: new Set([input.nodeId]),
        },
      );
      if (!readiness.ready) {
        return err({
          session,
          exitCode: 1,
          message:
            `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
        });
      }
    }
    const agentNodePayload = asAgentNodePayload(nodePayload);
    if (agentNodePayload === null) {
      return err({
        session,
        exitCode: 1,
        message: `node '${input.nodeId}' is missing agent execution fields`,
      });
    }

    const nextExecutionCounter = session.nodeExecutionCounter + 1;
    const executionIndex = (session.nodeExecutionCounts[input.nodeId] ?? 0) + 1;
    const nodeExecId = nextNodeExecId(nextExecutionCounter);
    const artifactDir = path.join(
      loaded.value.artifactWorkflowRoot,
      "executions",
      session.sessionId,
      "nodes",
      input.nodeId,
      nodeExecId,
    );
    await mkdir(artifactDir, { recursive: true });

    const mergedVariables = {
      ...agentNodePayload.variables,
      ...session.runtimeVariables,
    };

    const assembled = assembleNodeInput({
      runtimeVariables: session.runtimeVariables,
      node: agentNodePayload,
      workflowId: workflow.workflowId,
      workflowDescription: workflow.description,
      ...(nodeRef.kind === undefined ? {} : { nodeKind: nodeRef.kind }),
      upstream: [],
      transcript: (session.conversationTurns ?? []).map((turn) => ({
        conversationId: turn.conversationId,
        turnIndex: turn.turnIndex,
        fromSubWorkflowId: turn.fromSubWorkflowId,
        toSubWorkflowId: turn.toSubWorkflowId,
        fromManagerNodeId: turn.fromManagerNodeId,
        toManagerNodeId: turn.toManagerNodeId,
        communicationId: turn.communicationId,
        sentAt: turn.sentAt,
      })),
    });
    const executionMailbox = buildNodeExecutionMailbox({
      workflow,
      nodeRef,
      node: agentNodePayload,
      nodePayloads: loaded.value.bundle.nodePayloads,
      runtimeVariables: session.runtimeVariables,
      basePromptText: assembled.promptText,
      assembledArguments: assembled.arguments,
      upstreamInputs: [],
      ...(input.message === undefined
        ? {}
        : { managerMessage: input.message }),
    });
    try {
      await writeNodeExecutionMailboxArtifacts(artifactDir, executionMailbox);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "unknown execution mailbox persistence failure";
      const failedSession: WorkflowSessionState = {
        ...session,
        status: "failed",
        currentNodeId: input.nodeId,
        endedAt: nowIso(),
        lastError: `failed to persist execution mailbox at '${input.nodeId}': ${message}`,
      };
      const persisted = await saveSession(failedSession, input);
      return err({
        session: failedSession,
        exitCode: 1,
        message: persisted.ok
          ? failedSession.lastError ??
            "failed to persist execution mailbox"
          : persisted.error.message,
      });
    }
    const timeoutMs = resolveTimeoutMs(
      agentNodePayload,
      workflow.defaults.nodeTimeoutMs,
      input.defaultTimeoutMs,
    );
    let backendSession = resolveRequestedBackendSession(
      session,
      agentNodePayload,
    );
    const composedPrompts = composeExecutionPrompts({
      promptComposition: {
        workflow,
        nodeRef,
        node: agentNodePayload,
        nodePayloads: loaded.value.bundle.nodePayloads,
        runtimeVariables: session.runtimeVariables,
        basePromptText: assembled.promptText,
        assembledArguments: assembled.arguments,
        upstreamInputs: [],
        executionMailbox,
        ...(input.message === undefined
          ? {}
          : { managerMessage: input.message }),
      },
      includeSessionStartPrompt: backendSession?.mode !== "reuse",
    });
    const promptText = composedPrompts.promptText;
    const systemPromptText = composedPrompts.systemPromptText;
    const requestedBackendSessionMode = backendSession?.mode;
    let backendSessionId = backendSession?.sessionId;
    let backendSessionProvider: string | undefined;
    const startedAt = nowIso();
    let ambientManagerContext: AdapterAmbientManagerContext | undefined;
    let managerSessionId: string | undefined;
    const managerSessionStore = createManagerSessionStore(input);

    if (isManagerNodeKind(nodeRef.kind) && input.dryRun !== true) {
      managerSessionId = nextManagerSessionId(nodeExecId);
      const managerAuthToken = mintManagerAuthToken();
      ambientManagerContext = {
        environment: buildAmbientManagerControlPlaneEnvironment({
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          managerNodeId: input.nodeId,
          managerNodeExecId: nodeExecId,
          managerSessionId,
          authToken: managerAuthToken,
          ...(input.env === undefined ? {} : { env: input.env }),
        }),
      };
      await managerSessionStore.createOrResumeSession({
        managerSessionId,
        workflowId: workflow.workflowId,
        workflowExecutionId: session.sessionId,
        managerNodeId: input.nodeId,
        managerNodeExecId: nodeExecId,
        status: "active",
        createdAt: startedAt,
        updatedAt: startedAt,
        authTokenHash: hashManagerAuthToken(managerAuthToken),
        authTokenExpiresAt: new Date(
          new Date(startedAt).getTime() + timeoutMs + 5 * 60_000,
        ).toISOString(),
      });
    }

    const inputPayload = {
      sessionId: session.sessionId,
      workflowExecutionId: session.sessionId,
      workflowId: workflow.workflowId,
      nodeId: input.nodeId,
      nodeExecId,
      model: agentNodePayload.model,
      ...(agentNodePayload.systemPromptTemplate === undefined
        ? {}
        : { systemPromptTemplate: agentNodePayload.systemPromptTemplate }),
      promptTemplate: agentNodePayload.promptTemplate,
      ...(agentNodePayload.sessionStartPromptTemplate === undefined
        ? {}
        : {
            sessionStartPromptTemplate:
              agentNodePayload.sessionStartPromptTemplate,
          }),
      ...(systemPromptText === undefined ? {} : { systemPromptText }),
      promptText,
      arguments: assembled.arguments,
      variables: mergedVariables,
      upstreamOutputRefs: [],
      upstreamCommunications: [],
      executionMailbox,
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
      ...(input.message === undefined ? {} : { managerMessage: input.message }),
      dryRun: input.dryRun ?? false,
    };
    const inputJson = stableJson(inputPayload);
    await writeRawTextFile(
      path.join(artifactDir, "input.json"),
      `${inputJson}\n`,
    );

    let nodeStatus: NodeExecutionRecord["status"] = "succeeded";
    let outputValidationErrors: readonly JsonSchemaValidationError[] = [];
    let outputAttemptCount = 1;
    let finalOutputPayload: Readonly<Record<string, unknown>> | undefined;

    if (input.dryRun === true) {
      finalOutputPayload = {
        provider: "dry-run",
        model: agentNodePayload.model,
        ...(systemPromptText === undefined ? {} : { systemPromptText }),
        promptText,
        completionPassed: true,
        when: { always: true },
        payload: { skippedExecution: true },
      };
    } else {
      const maxAttempts = resolveOutputValidationAttempts(agentNodePayload);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        outputAttemptCount = attempt;
        const outputAttemptId =
          agentNodePayload.output === undefined
            ? undefined
            : nextOutputAttemptId(attempt);
        const attemptDir =
          outputAttemptId === undefined
            ? undefined
            : path.join(artifactDir, "output-attempts", outputAttemptId);
        const requestPath =
          attemptDir === undefined
            ? undefined
            : path.join(attemptDir, "request.json");
        const validationPath =
          attemptDir === undefined
            ? undefined
            : path.join(attemptDir, "validation.json");
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
                nodeId: input.nodeId,
                nodeExecId,
                outputAttemptId,
              });
        if (
          attemptDir !== undefined &&
          requestPath !== undefined &&
          candidatePath !== undefined
        ) {
          await mkdir(attemptDir, { recursive: true });
          await mkdir(path.dirname(candidatePath), { recursive: true });
          await rm(candidatePath, { force: true });
        }
        const executionPromptText =
          candidatePath === undefined
            ? promptText
            : buildOutputPromptText({
                basePromptText: promptText,
                node: agentNodePayload,
                candidatePath,
                validationErrors: outputValidationErrors,
              });
        const retryValidationFeedback = formatOutputValidationErrors(
          outputValidationErrors,
        );
        if (requestPath !== undefined && candidatePath !== undefined) {
          await writeJsonFile(requestPath, {
            attempt,
            promptText: executionPromptText,
            candidatePath,
            validationErrors: retryValidationFeedback,
          });
        }

        const execution = await executeAdapterWithTimeout(
          this.#adapter,
          {
            workflowId: workflow.workflowId,
            workflowExecutionId: session.sessionId,
            nodeId: input.nodeId,
            nodeExecId,
            node: agentNodePayload,
            mergedVariables,
            ...(systemPromptText === undefined ? {} : { systemPromptText }),
            promptText: executionPromptText,
            arguments: assembled.arguments,
            executionIndex,
            artifactDir,
            upstreamCommunicationIds: [],
            executionMailbox,
            ...(backendSession === undefined ? {} : { backendSession }),
            ...(ambientManagerContext === undefined
              ? {}
              : { ambientManagerContext }),
            ...(candidatePath === undefined ||
            agentNodePayload.output === undefined
              ? {}
              : {
                  output: {
                    ...(agentNodePayload.output.description === undefined
                      ? {}
                      : { description: agentNodePayload.output.description }),
                    ...(agentNodePayload.output.jsonSchema === undefined
                      ? {}
                      : { jsonSchema: agentNodePayload.output.jsonSchema }),
                    maxValidationAttempts: maxAttempts,
                    attempt,
                    candidatePath,
                    validationErrors: formatOutputValidationErrors(
                      outputValidationErrors,
                    ),
                    publication: buildOutputPublicationPolicy(),
                  },
                }),
          },
          timeoutMs,
        );

        try {
          if (!execution.ok) {
            if (
              execution.error.code === "invalid_output" &&
              agentNodePayload.output !== undefined &&
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
              if (attempt < maxAttempts) {
                continue;
              }
              nodeStatus = "failed";
              finalOutputPayload = {
                provider: "deterministic-local",
                model: agentNodePayload.model,
                promptText,
                completionPassed: false,
                when: {},
                payload: {},
                error: "output_validation_failed",
                validationErrors: outputValidationErrors,
              };
              break;
            }
            nodeStatus =
              execution.error.code === "timeout" ? "timed_out" : "failed";
            finalOutputPayload = {
              provider: "deterministic-local",
              model: agentNodePayload.model,
              promptText,
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
            agentNodePayload.output === undefined &&
            execution.value.candidateFilePath !== undefined
          ) {
            outputValidationErrors = [
              { path: "$", message: NON_CONTRACT_CANDIDATE_FILE_ERROR },
            ];
            nodeStatus = "failed";
            finalOutputPayload = {
              provider: execution.value.provider,
              model: execution.value.model,
              promptText,
              completionPassed: false,
              when: {},
              payload: {},
              error: "invalid_output",
              validationErrors: outputValidationErrors,
            };
            break;
          }

          const validation = await this.#validator.validate({
            node: agentNodePayload,
            execution: execution.value,
            ...(candidatePath === undefined
              ? {}
              : { expectedCandidatePath: candidatePath }),
          });
          if (!validation.ok && validation.error.payload !== undefined) {
            if (candidateArtifactPath !== undefined) {
              await writeJsonFile(
                candidateArtifactPath,
                validation.error.payload,
              );
            }
          }
          if (!validation.ok) {
            outputValidationErrors = validation.error.errors;
            if (validationPath !== undefined) {
              await writeJsonFile(validationPath, {
                valid: false,
                errors: outputValidationErrors,
                rejectedAt: nowIso(),
              });
            }
            if (attempt < maxAttempts && validation.error.retryable) {
              continue;
            }
            nodeStatus = "failed";
            finalOutputPayload = {
              provider: execution.value.provider,
              model: execution.value.model,
              promptText,
              completionPassed: false,
              when: {},
              payload: {},
              error: validation.error.retryable
                ? "output_validation_failed"
                : "invalid_output",
              validationErrors: validation.error.errors,
            };
            break;
          }
          if (candidateArtifactPath !== undefined) {
            await writeJsonFile(
              candidateArtifactPath,
              validation.value.payload,
            );
          }
          if (validationPath !== undefined) {
            await writeJsonFile(validationPath, {
              valid: true,
              errors: [],
              validatedAt: nowIso(),
            });
          }

          finalOutputPayload = {
            provider: execution.value.provider,
            model: execution.value.model,
            promptText,
            completionPassed: execution.value.completionPassed,
            when: execution.value.when,
            payload: validation.value.payload,
          };
          outputValidationErrors = validation.value.errors;
          break;
        } finally {
          if (candidatePath !== undefined) {
            await cleanupReservedCandidateSubmissionPath(candidatePath);
          }
        }
      }
    }

    const endedAt = nowIso();
    const nodeExecution: NodeExecutionRecord = {
      nodeId: input.nodeId,
      nodeExecId,
      status: nodeStatus,
      artifactDir,
      startedAt,
      endedAt,
      ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
      ...(outputValidationErrors.length === 0
        ? {}
        : { outputValidationErrors }),
      ...(backendSessionId === undefined ? {} : { backendSessionId }),
      ...(requestedBackendSessionMode === undefined
        ? {}
        : { backendSessionMode: requestedBackendSessionMode }),
    };

    const nextNodeBackendSessions = persistNodeBackendSession({
      session,
      node: agentNodePayload,
      nodeExecId,
      provider:
        backendSessionProvider ??
        finalOutputPayload?.["provider"]?.toString() ??
        "unknown-provider",
      endedAt,
      backendSession,
      ...(backendSessionId === undefined
        ? {}
        : { returnedSessionId: backendSessionId }),
    });

    if (managerSessionId !== undefined && ambientManagerContext !== undefined) {
      await managerSessionStore.createOrResumeSession({
        managerSessionId,
        workflowId: workflow.workflowId,
        workflowExecutionId: session.sessionId,
        managerNodeId: input.nodeId,
        managerNodeExecId: nodeExecId,
        status: nodeStatus === "succeeded" ? "completed" : "failed",
        createdAt: startedAt,
        updatedAt: endedAt,
        authTokenHash: hashManagerAuthToken(
          ambientManagerContext.environment.DIVEDRA_MANAGER_AUTH_TOKEN,
        ),
        authTokenExpiresAt: endedAt,
      });
    }

    session = {
      ...session,
      status: "running",
      currentNodeId: input.nodeId,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: {
        ...session.nodeExecutionCounts,
        [input.nodeId]: executionIndex,
      },
      nodeExecutions: [...session.nodeExecutions, nodeExecution],
      nodeBackendSessions: nextNodeBackendSessions,
      ...(finalOutputPayload !== undefined &&
      isRootScopeOutputNode(workflow, input.nodeId)
        ? {
            runtimeVariables: {
              ...session.runtimeVariables,
              workflowOutput: finalOutputPayload["payload"],
            },
          }
        : {}),
      ...(nodeStatus === "succeeded"
        ? {}
        : {
            lastError:
              finalOutputPayload?.["error"]?.toString() ?? "node call failed",
          }),
    };

    if (finalOutputPayload === undefined) {
      session = {
        ...session,
        lastError: "node execution produced no output",
      };
      const persisted = await saveSession(session, input);
      return err({
        session,
        nodeExecution,
        exitCode: 1,
        message: persisted.ok
          ? "node execution produced no output"
          : persisted.error.message,
      });
    }

    let outputRef: OutputRef | undefined;
    if (nodeStatus === "succeeded") {
      outputRef = await this.#publisher.publish({
        workflow,
        session,
        node: agentNodePayload,
        nodeExecution,
        artifactDir,
        inputJson,
        outputPayload: finalOutputPayload,
        timeoutMs,
        requestedBackendSessionMode,
      });
    } else {
      await writeRawTextFile(
        path.join(artifactDir, "output.json"),
        `${stableJson(finalOutputPayload)}\n`,
      );
      await writeJsonFile(path.join(artifactDir, "meta.json"), {
        nodeId: input.nodeId,
        nodeExecId,
        status: nodeStatus,
        startedAt,
        endedAt,
        model: agentNodePayload.model,
        timeoutMs,
        ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
        ...(outputValidationErrors.length === 0
          ? {}
          : { outputValidationErrors }),
      });
    }

    const persisted = await saveSession(session, input);
    if (!persisted.ok) {
      return err({
        session,
        nodeExecution,
        exitCode: 1,
        message: persisted.error.message,
      });
    }

    if (nodeStatus !== "succeeded" || outputRef === undefined) {
      return err({
        session,
        nodeExecution,
        exitCode: nodeStatus === "timed_out" ? 6 : 5,
        message:
          finalOutputPayload["error"]?.toString() ?? "node execution failed",
      });
    }

    return ok({
      session,
      nodeExecution,
      output: finalOutputPayload,
      outputRef,
      exitCode: 0,
    });
  }
}

export async function callNode(
  input: CallNodeInput,
  adapter?: NodeAdapter,
): Promise<Result<CallNodeSuccess, CallNodeFailure>> {
  const effectiveAdapter =
    adapter ??
    (input.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(input.mockScenario));
  return new ExecutionDispatcher(effectiveAdapter, input).dispatch(input);
}

function isTerminalSessionStatus(status: SessionStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}
