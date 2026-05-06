/**
 * Internal direct step execution engine used only by {@link ./call-step.callStep}.
 * The CLI and package API expose `call-step` only (strict step-addressed execution).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../shared/fs";
import {
  buildAdapterDivedraHookContext,
  normalizeOutputContractEnvelope,
  type AdapterAmbientManagerContext,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "./adapter";
import { ScenarioNodeAdapter, type MockNodeScenario } from "./scenario-adapter";
import {
  executeAdapterWithTimeout,
  executeNativeNodeWithTimeout,
} from "./adapter-execution";
import { DispatchingNodeAdapter } from "./adapters/dispatch";
import { assembleNodeInput } from "./input-assembly";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "./json-schema";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "./node-execution-mailbox";
import { appendMailboxPromptGuidance } from "./mailbox-prompt-guidance";
import {
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "./load";
import { buildSupervisionStallWatch } from "./superviser";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
} from "./manager-session-store";
import { describeWorkflowNodeKind, isManagerNodeRef } from "./node-role";
import { composeExecutionPrompts } from "./prompt-composition";
import { err, ok, type Result } from "./result";
import { inspectWorkflowRuntimeReadiness } from "./runtime-readiness";
import {
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
} from "./runtime-addressing";
import {
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
} from "./runtime-db";
import {
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "./session-store";
import {
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
} from "./working-directory";
import {
  buildOutputRefForExecution,
  isTerminalWorkflowSessionStatus,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
  type NodeExecutionRecord,
  type OutputRef,
  type WorkflowSessionState,
} from "./session";
import {
  asAgentNodePayload,
  getNormalizedNodePayload,
  type AgentNodePayload,
  type ChatReplyDispatcher,
  type JsonObject,
  type LoadOptions,
  type NodePayload,
  type NodePromptVariant,
  type NodeSessionMode,
  type WorkflowJson,
} from "./types";
import type { SuperviserRuntimeControl } from "./superviser-control";

export interface DirectExecutionOverrides {
  readonly promptVariant?: string;
  readonly sessionMode?: NodeSessionMode;
  readonly timeoutMs?: number;
  /**
   * Prior step execution record to continue from (matches session
   * `nodeExecId`; CLI: `--resume-step-exec`).
   */
  readonly resumeStepExecId?: string;
}

export interface CallStepExecutionInput
  extends LoadOptions,
    SessionStoreOptions {
  readonly workflowId: string;
  readonly workflowRunId: string;
  readonly stepId: string;
  readonly workflowWorkingDirectory?: string;
  readonly message?: unknown;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  readonly defaultTimeoutMs?: number;
  readonly overrides?: DirectExecutionOverrides;
  /**
   * When calling nodes inside a nested auto-improve superviser workflow run
   * (`--nested-superviser`), pass the engine-owned control surface for
   * `divedra/*` superviser control add-ons.
   */
  readonly superviserControl?: SuperviserRuntimeControl;
}

export interface CallStepExecutionSuccess {
  readonly session: WorkflowSessionState;
  readonly nodeExecution: NodeExecutionRecord;
  readonly output: Readonly<Record<string, unknown>>;
  readonly outputRef: OutputRef;
  readonly exitCode: 0;
}

export interface CallStepExecutionFailure {
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
  invocationTimeoutMs: number | undefined,
): number {
  if (invocationTimeoutMs !== undefined && invocationTimeoutMs > 0) {
    return invocationTimeoutMs;
  }
  if (node.timeoutMs !== undefined) {
    return node.timeoutMs;
  }
  if (overrideTimeoutMs !== undefined && overrideTimeoutMs > 0) {
    return overrideTimeoutMs;
  }
  return workflowTimeoutMs;
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

function buildScenarioExecutableNodePayload(input: {
  readonly node: NodePayload;
  readonly hasScenarioEntry: boolean;
  readonly allowScenarioFallback: boolean;
  readonly allowDryRun: boolean;
}): AgentNodePayload | null {
  const agentNodePayload = asAgentNodePayload(input.node);
  if (agentNodePayload !== null) {
    return agentNodePayload;
  }

  if (
    input.node.managerType === "code" &&
    (input.allowScenarioFallback || input.allowDryRun) &&
    input.node.promptTemplate !== undefined
  ) {
    return {
      ...input.node,
      nodeType: "agent",
      model: input.node.model ?? "deterministic-code-manager",
      promptTemplate: input.node.promptTemplate,
    };
  }

  if (
    input.hasScenarioEntry &&
    (input.node.nodeType === "command" ||
      input.node.nodeType === "container" ||
      input.node.nodeType === "addon")
  ) {
    const { nodeType: _nodeType, ...rest } = input.node;
    return {
      ...rest,
      nodeType: "agent",
      model: `scenario/${input.node.nodeType}`,
      promptTemplate: input.node.promptTemplate ?? "",
    };
  }

  return null;
}

function applyPromptVariantTemplateOverride(input: {
  readonly payload: NodePayload;
  readonly variant: NodePromptVariant;
  readonly templateField:
    | "systemPromptTemplate"
    | "promptTemplate"
    | "sessionStartPromptTemplate";
  readonly templateFileField:
    | "systemPromptTemplateFile"
    | "promptTemplateFile"
    | "sessionStartPromptTemplateFile";
}): NodePayload {
  const variantTemplate = input.variant[input.templateField];
  const variantTemplateFile = input.variant[input.templateFileField];
  if (variantTemplate === undefined && variantTemplateFile === undefined) {
    return input.payload;
  }

  const {
    [input.templateField]: _removedTemplate,
    [input.templateFileField]: _removedTemplateFile,
    ...payloadWithoutTemplatePair
  } = input.payload;

  return {
    ...payloadWithoutTemplatePair,
    ...(variantTemplate === undefined
      ? {}
      : { [input.templateField]: variantTemplate }),
    ...(variantTemplateFile === undefined
      ? {}
      : { [input.templateFileField]: variantTemplateFile }),
  };
}

function applyPromptVariantOverride(input: {
  readonly node: NodePayload;
  readonly promptVariant: string;
}): Result<NodePayload, string> {
  const variant = input.node.promptVariants?.[input.promptVariant];
  if (variant === undefined) {
    return err(
      `step '${input.node.id}' does not define prompt variant '${input.promptVariant}'`,
    );
  }

  const payload = [
    {
      templateField: "systemPromptTemplate" as const,
      templateFileField: "systemPromptTemplateFile" as const,
    },
    {
      templateField: "promptTemplate" as const,
      templateFileField: "promptTemplateFile" as const,
    },
    {
      templateField: "sessionStartPromptTemplate" as const,
      templateFileField: "sessionStartPromptTemplateFile" as const,
    },
  ].reduce(
    (currentPayload, templatePair) =>
      applyPromptVariantTemplateOverride({
        payload: currentPayload,
        variant,
        templateField: templatePair.templateField,
        templateFileField: templatePair.templateFileField,
      }),
    input.node,
  );

  return ok(payload);
}

function applyDirectExecutionOverrides(
  node: NodePayload,
  overrides: DirectExecutionOverrides | undefined,
): Result<NodePayload, string> {
  if (overrides === undefined) {
    return ok(node);
  }

  let resolvedNode = node;
  if (overrides.promptVariant !== undefined) {
    const promptVariantResult = applyPromptVariantOverride({
      node: resolvedNode,
      promptVariant: overrides.promptVariant,
    });
    if (!promptVariantResult.ok) {
      return promptVariantResult;
    }
    resolvedNode = promptVariantResult.value;
  }

  if (overrides.sessionMode !== undefined) {
    resolvedNode = {
      ...resolvedNode,
      sessionPolicy: {
        ...(resolvedNode.sessionPolicy === undefined
          ? {}
          : resolvedNode.sessionPolicy),
        mode: overrides.sessionMode,
      },
    };
  }

  return ok(resolvedNode);
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
    ...(ref.outputStepId === undefined ? [] : [`Step-ID: ${ref.outputStepId}`]),
    ...(ref.nodeRegistryId === undefined
      ? []
      : [`Node-Registry-ID: ${ref.nodeRegistryId}`]),
    `Run-ID: ${ref.workflowExecutionId}`,
    `Workflow-ID: ${ref.workflowId}`,
    `Node-Exec-ID: ${ref.nodeExecId}`,
    ...(ref.mailboxInstanceId === undefined
      ? []
      : [`Mailbox-Instance-ID: ${ref.mailboxInstanceId}`]),
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
        readonly completionPassed: boolean;
        readonly when: Readonly<Record<string, boolean>>;
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
      return ok({
        completionPassed: input.execution.completionPassed,
        when: input.execution.when,
        payload: input.execution.payload,
        errors: [],
      });
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

    let normalizedContractPayload: ReturnType<
      typeof normalizeOutputContractEnvelope
    >;
    try {
      normalizedContractPayload = normalizeOutputContractEnvelope(
        candidateResult.value,
        "node output candidate",
        {
          completionPassed: input.execution.completionPassed,
          when: input.execution.when,
        },
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "invalid output contract envelope";
      return err({
        errors: [{ path: "$", message }],
        retryable: true,
      });
    }

    const validationErrors =
      input.node.output.jsonSchema === undefined
        ? []
        : validateJsonValueAgainstSchema({
            schema: input.node.output.jsonSchema as JsonObject,
            value: normalizedContractPayload.payload,
          });
    if (validationErrors.length > 0) {
      return err({
        payload: normalizedContractPayload.payload,
        errors: validationErrors,
        retryable: true,
      });
    }

    return ok({
      completionPassed: normalizedContractPayload.completionPassed,
      when: normalizedContractPayload.when,
      payload: normalizedContractPayload.payload,
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
    readonly llmMessages?: readonly AdapterLlmSessionMessage[];
  }): Promise<OutputRef> {
    const nodeExecutionIdentityFields = toStepIdentityFields(
      input.nodeExecution,
    );
    const outputJson = stableJson(input.outputPayload);
    const outputRaw = `${outputJson}\n`;
    const inputHash = sha256Hex(input.inputJson);
    const outputHash = sha256Hex(outputJson);
    const outputRef = buildOutputRefForExecution({
      workflow: input.workflow,
      session: input.session,
      execution: input.nodeExecution,
    });
    const handoffPayload = {
      schemaVersion: 1,
      generatedAt: input.nodeExecution.endedAt,
      nodeId: input.nodeExecution.nodeId,
      ...nodeExecutionIdentityFields,
      ...(input.nodeExecution.mailboxInstanceId === undefined
        ? {}
        : { mailboxInstanceId: input.nodeExecution.mailboxInstanceId }),
      outputRef,
      inputHash: `sha256:${inputHash}`,
      outputHash: `sha256:${outputHash}`,
      nextNodes: [],
    };
    const metaPayload = {
      nodeId: input.nodeExecution.nodeId,
      ...nodeExecutionIdentityFields,
      nodeExecId: input.nodeExecution.nodeExecId,
      ...(input.nodeExecution.mailboxInstanceId === undefined
        ? {}
        : { mailboxInstanceId: input.nodeExecution.mailboxInstanceId }),
      status: input.nodeExecution.status,
      startedAt: input.nodeExecution.startedAt,
      endedAt: input.nodeExecution.endedAt,
      model: input.node.model,
      timeoutMs: input.timeoutMs,
      ...(input.nodeExecution.promptVariant === undefined
        ? {}
        : { promptVariant: input.nodeExecution.promptVariant }),
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
          ...nodeExecutionIdentityFields,
          nodeExecId: input.nodeExecution.nodeExecId,
          executionOrdinal:
            input.nodeExecution.executionOrdinal ??
            input.session.nodeExecutionCounter,
          ...(input.nodeExecution.mailboxInstanceId === undefined
            ? {}
            : { mailboxInstanceId: input.nodeExecution.mailboxInstanceId }),
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
          ...(input.nodeExecution.promptVariant === undefined
            ? {}
            : { promptVariant: input.nodeExecution.promptVariant }),
          ...(input.nodeExecution.timeoutMs === undefined
            ? {}
            : { timeoutMs: input.nodeExecution.timeoutMs }),
          ...(input.requestedBackendSessionMode === undefined
            ? {}
            : { backendSessionMode: input.requestedBackendSessionMode }),
          ...(input.nodeExecution.backendSessionId === undefined
            ? {}
            : { backendSessionId: input.nodeExecution.backendSessionId }),
          ...(input.llmMessages === undefined
            ? {}
            : { llmMessages: input.llmMessages }),
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
    input: CallStepExecutionInput,
  ): Promise<Result<CallStepExecutionSuccess, CallStepExecutionFailure>> {
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
    if (isTerminalWorkflowSessionStatus(session.status)) {
      return err({
        session,
        exitCode: 1,
        message: `cannot call step '${input.stepId}' on terminal session '${session.sessionId}' with status '${session.status}'`,
      });
    }
    if (session.workflowId !== input.workflowId) {
      return err({
        session,
        exitCode: 1,
        message: `workflow id mismatch: session '${session.sessionId}' belongs to '${session.workflowId}', not '${input.workflowId}'`,
      });
    }

    const loaded = await loadWorkflowFromDisk(
      session.workflowName,
      mergeLoadOptionsForSessionMutableBundle(input, session),
    );
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
    const nodeRef = workflow.nodes.find((entry) => entry.id === input.stepId);
    const nodePayload = getNormalizedNodePayload(
      loaded.value.bundle,
      input.stepId,
    );
    if (nodeRef === undefined || nodePayload === undefined) {
      return err({
        session,
        exitCode: 1,
        message: `missing step definition for '${input.stepId}'`,
      });
    }
    const stepExecutionAddress = resolveRequiredStepExecutionAddress(
      workflow,
      input.stepId,
    );
    if (stepExecutionAddress === undefined) {
      return err({
        session,
        exitCode: 1,
        message: `missing step definition for '${input.stepId}'`,
      });
    }
    const stepIdentityFields = toStepIdentityFields(stepExecutionAddress);
    if (nodeRef.execution?.mode === "optional") {
      return err({
        session,
        exitCode: 1,
        message: `step '${input.stepId}' is optional and must be executed through the workflow scheduler after an owning-manager decision`,
      });
    }
    if (nodePayload.nodeType === "user-action") {
      return err({
        session,
        exitCode: 1,
        message: `step '${input.stepId}' requests nodeType='user-action', but direct step execution is not supported`,
      });
    }

    const nodeWithOverrides = applyDirectExecutionOverrides(
      nodePayload,
      input.overrides,
    );
    if (!nodeWithOverrides.ok) {
      return err({
        session,
        exitCode: 2,
        message: nodeWithOverrides.error,
      });
    }
    const executionTargetNode = nodeWithOverrides.value;

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
          onlyStepIds: new Set([input.stepId]),
        },
      );
      if (!readiness.ready) {
        return err({
          session,
          exitCode: 1,
          message: `workflow runtime readiness failed: ${readiness.blockers.join("; ")}`,
        });
      }
    }
    const agentNodePayload = buildScenarioExecutableNodePayload({
      node: executionTargetNode,
      hasScenarioEntry: input.mockScenario?.[input.stepId] !== undefined,
      allowScenarioFallback: input.mockScenario !== undefined,
      allowDryRun: input.dryRun === true,
    });
    const nativeNodePayload =
      agentNodePayload === null &&
      (executionTargetNode.nodeType === "command" ||
        executionTargetNode.nodeType === "container" ||
        executionTargetNode.nodeType === "addon")
        ? executionTargetNode
        : null;
    const executionNodePayload = agentNodePayload ?? executionTargetNode;
    if (agentNodePayload === null && nativeNodePayload === null) {
      return err({
        session,
        exitCode: 1,
        message: `step '${input.stepId}' is missing executable fields`,
      });
    }
    let workflowWorkingDirectory: string;
    try {
      workflowWorkingDirectory = resolveWorkflowExecutionWorkingDirectory({
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.workflowWorkingDirectory === undefined
          ? {}
          : { workflowWorkingDirectory: input.workflowWorkingDirectory }),
      });
    } catch (error: unknown) {
      return err({
        session,
        exitCode: 2,
        message:
          error instanceof Error
            ? error.message
            : "workingDirectory must be a non-empty path when provided",
      });
    }

    const nextExecutionCounter = session.nodeExecutionCounter + 1;
    const executionIndex = (session.nodeExecutionCounts[input.stepId] ?? 0) + 1;
    const nodeExecId = nextNodeExecId(nextExecutionCounter);
    const mailboxInstanceId = nodeExecId;
    const artifactDir = path.join(
      loaded.value.artifactWorkflowRoot,
      "executions",
      session.sessionId,
      "nodes",
      input.stepId,
      nodeExecId,
    );
    await mkdir(artifactDir, { recursive: true });

    const mergedVariables = {
      ...executionNodePayload.variables,
      ...session.runtimeVariables,
    };

    const assembled = assembleNodeInput({
      runtimeVariables: session.runtimeVariables,
      node: executionNodePayload,
      workflowId: workflow.workflowId,
      workflowDescription: workflow.description,
      nodeKind: describeWorkflowNodeKind(nodeRef),
      upstream: [],
      transcript: (session.conversationTurns ?? []).map((turn) => ({
        conversationId: turn.conversationId,
        turnIndex: turn.turnIndex,
        fromManagerStepId: turn.fromManagerStepId,
        toManagerStepId: turn.toManagerStepId,
        communicationId: turn.communicationId,
        sentAt: turn.sentAt,
      })),
    });
    const executionMailbox = buildNodeExecutionMailbox({
      workflow,
      nodeRef,
      node: executionNodePayload,
      ...stepIdentityFields,
      mailboxInstanceId,
      nodePayloads: loaded.value.bundle.nodePayloads,
      runtimeVariables: session.runtimeVariables,
      basePromptText: assembled.promptText,
      assembledArguments: assembled.arguments,
      upstreamInputs: [],
      ...(input.message === undefined ? {} : { managerMessage: input.message }),
    });
    let mailboxDir: string;
    try {
      const mailboxPaths = await writeNodeExecutionMailboxArtifacts(
        artifactDir,
        executionMailbox,
      );
      mailboxDir = mailboxPaths.rootDir;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "unknown execution mailbox persistence failure";
      const failedSession: WorkflowSessionState = {
        ...session,
        status: "failed",
        currentNodeId: input.stepId,
        endedAt: nowIso(),
        lastError: `failed to persist execution mailbox for step '${input.stepId}': ${message}`,
      };
      const persisted = await saveSession(failedSession, input);
      return err({
        session: failedSession,
        exitCode: 1,
        message: persisted.ok
          ? (failedSession.lastError ?? "failed to persist execution mailbox")
          : persisted.error.message,
      });
    }
    const timeoutMs = resolveTimeoutMs(
      executionNodePayload,
      workflow.defaults.nodeTimeoutMs,
      input.defaultTimeoutMs,
      input.overrides?.timeoutMs,
    );
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
            ...(backendSessionIdentityFields ?? {}),
            ...(backendSessionSelection?.inheritFromStepId === undefined
              ? {}
              : {
                  inheritFromStepId: backendSessionSelection.inheritFromStepId,
                }),
          });
    const composedPrompts = composeExecutionPrompts({
      promptComposition: {
        workflow,
        nodeRef,
        node: executionNodePayload,
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
      includeSessionStartPrompt:
        agentNodePayload !== null && backendSession?.mode !== "reuse",
    });
    const promptText = appendMailboxPromptGuidance({
      promptText: composedPrompts.promptText,
    });
    const systemPromptText = composedPrompts.systemPromptText;
    const requestedBackendSessionMode = backendSession?.mode;
    let backendSessionId = backendSession?.sessionId;
    let backendSessionProvider: string | undefined;
    const startedAt = nowIso();
    let ambientManagerContext: AdapterAmbientManagerContext | undefined;
    let managerSessionId: string | undefined;
    const managerSessionStore = createManagerSessionStore(input);

    if (isManagerNodeRef(nodeRef) && input.dryRun !== true) {
      managerSessionId = nextManagerSessionId(nodeExecId);
      const managerAuthToken = mintManagerAuthToken();
      ambientManagerContext = {
        environment: buildAmbientManagerControlPlaneEnvironment({
          workflowId: workflow.workflowId,
          workflowExecutionId: session.sessionId,
          managerStepId: input.stepId,
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
        managerStepId: input.stepId,
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
      nodeId: input.stepId,
      ...stepIdentityFields,
      nodeExecId,
      mailboxInstanceId,
      nodeType: executionNodePayload.nodeType ?? "agent",
      ...(agentNodePayload === null
        ? {}
        : { executionBackend: agentNodePayload.executionBackend }),
      ...(agentNodePayload === null ? {} : { model: agentNodePayload.model }),
      ...(agentNodePayload?.systemPromptTemplate === undefined
        ? {}
        : { systemPromptTemplate: agentNodePayload.systemPromptTemplate }),
      promptTemplate: executionNodePayload.promptTemplate,
      ...(agentNodePayload?.sessionStartPromptTemplate === undefined
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
      ...(input.overrides?.promptVariant === undefined
        ? {}
        : { promptVariant: input.overrides.promptVariant }),
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
      ...(input.overrides?.resumeStepExecId === undefined
        ? {}
        : { resumedFromNodeExecId: input.overrides.resumeStepExecId }),
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
    let processLogs: readonly AdapterProcessLog[] = [];
    let llmMessages: readonly AdapterLlmSessionMessage[] = [];

    if (input.dryRun === true) {
      finalOutputPayload = {
        provider: "dry-run",
        model:
          agentNodePayload?.model ??
          `${executionNodePayload.nodeType ?? "agent"}-dry-run`,
        ...(systemPromptText === undefined ? {} : { systemPromptText }),
        promptText,
        completionPassed: true,
        when: { always: true },
        payload: { skippedExecution: true },
      };
    } else {
      const maxAttempts = resolveOutputValidationAttempts(executionNodePayload);
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        outputAttemptCount = attempt;
        const outputAttemptId =
          executionNodePayload.output === undefined
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
          outputAttemptId === undefined || agentNodePayload === null
            ? undefined
            : buildReservedCandidateSubmissionPath({
                workflowId: workflow.workflowId,
                workflowExecutionId: session.sessionId,
                nodeId: input.stepId,
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
          candidatePath === undefined || agentNodePayload === null
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
            executionBackend:
              agentNodePayload?.executionBackend ??
              executionNodePayload.nodeType ??
              "agent",
            model: agentNodePayload?.model ?? executionNodePayload.nodeType,
            promptText: executionPromptText,
            candidatePath,
            validationErrors: retryValidationFeedback,
          });
        }

        const supervisionStall = buildSupervisionStallWatch(session, input);
        const execution =
          agentNodePayload !== null
            ? await executeAdapterWithTimeout(
                this.#adapter,
                {
                  workflowId: workflow.workflowId,
                  workflowExecutionId: session.sessionId,
                  nodeId: input.stepId,
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
                  arguments: assembled.arguments,
                  executionIndex,
                  artifactDir,
                  upstreamCommunicationIds: [],
                  executionMailbox,
                  divedraHookContext: buildAdapterDivedraHookContext({
                    workflowId: workflow.workflowId,
                    workflowExecutionId: session.sessionId,
                    nodeId: input.stepId,
                    nodeExecId,
                    mailboxDir,
                    ...(agentNodePayload.executionBackend === undefined
                      ? {}
                      : { agentBackend: agentNodePayload.executionBackend }),
                  }),
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
                            : {
                                description:
                                  agentNodePayload.output.description,
                              }),
                          ...(agentNodePayload.output.jsonSchema === undefined
                            ? {}
                            : {
                                jsonSchema: agentNodePayload.output.jsonSchema,
                              }),
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
                supervisionStall,
              )
            : await executeNativeNodeWithTimeout({
                workflowDirectory: loaded.value.workflowDirectory,
                workflowWorkingDirectory,
                artifactWorkflowRoot: loaded.value.artifactWorkflowRoot,
                workflowId: workflow.workflowId,
                workflowDescription: workflow.description,
                workflowExecutionId: session.sessionId,
                nodeId: input.stepId,
                nodeExecId,
                node: executionNodePayload,
                workflowDefaults: workflow.defaults,
                runtimeVariables: session.runtimeVariables,
                mergedVariables,
                arguments: assembled.arguments,
                artifactDir,
                executionMailbox,
                ...(input.eventReplyDispatcher === undefined
                  ? {}
                  : { chatReplyDispatcher: input.eventReplyDispatcher }),
                ...(input.env === undefined ? {} : { env: input.env }),
                ...(input.superviserControl === undefined
                  ? {}
                  : { superviserControl: input.superviserControl }),
                timeoutMs,
                ...(supervisionStall === undefined ? {} : { supervisionStall }),
              });

        try {
          if (!execution.ok) {
            processLogs = [
              ...processLogs,
              ...(execution.error.processLogs ?? []),
            ];
            if (
              execution.error.code === "invalid_output" &&
              executionNodePayload.output !== undefined &&
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
                model:
                  agentNodePayload?.model ??
                  executionNodePayload.nodeType ??
                  "node",
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
              model:
                agentNodePayload?.model ??
                executionNodePayload.nodeType ??
                "node",
              promptText,
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
          llmMessages = [
            ...llmMessages,
            ...(execution.value.llmMessages ?? []),
          ];
          if (execution.value.backendSession?.sessionId !== undefined) {
            backendSession = {
              mode: "reuse",
              sessionId: execution.value.backendSession.sessionId,
            };
            backendSessionId = execution.value.backendSession.sessionId;
          }
          if (
            executionNodePayload.output === undefined &&
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
            node: executionNodePayload,
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
            completionPassed: validation.value.completionPassed,
            when: validation.value.when,
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
    try {
      await saveProcessLogsToRuntimeDb(
        {
          sessionId: session.sessionId,
          nodeId: input.stepId,
          nodeExecId,
          processLogs,
          at: endedAt,
          ...(stepExecutionAddress.stepId === undefined
            ? {}
            : { executionLogTarget: "step" as const }),
        },
        input,
      );
    } catch {
      // runtime DB process logs are best-effort
    }
    const nodeExecution: NodeExecutionRecord = {
      nodeId: input.stepId,
      ...stepIdentityFields,
      nodeExecId,
      executionOrdinal: nextExecutionCounter,
      mailboxInstanceId,
      status: nodeStatus,
      artifactDir,
      startedAt,
      endedAt,
      ...(outputAttemptCount === 1 ? {} : { outputAttemptCount }),
      ...(outputValidationErrors.length === 0
        ? {}
        : { outputValidationErrors }),
      ...(input.overrides?.promptVariant === undefined
        ? {}
        : { promptVariant: input.overrides.promptVariant }),
      timeoutMs,
      ...(backendSessionId === undefined ? {} : { backendSessionId }),
      ...(requestedBackendSessionMode === undefined
        ? {}
        : { backendSessionMode: requestedBackendSessionMode }),
    };

    const nextNodeBackendSessions =
      agentNodePayload === null
        ? (session.nodeBackendSessions ?? {})
        : persistNodeBackendSession({
            session,
            node: agentNodePayload,
            nodeExecId,
            ...stepIdentityFields,
            ...(stepExecutionAddress.inheritFromStepId === undefined
              ? {}
              : { inheritFromStepId: stepExecutionAddress.inheritFromStepId }),
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
        managerStepId: input.stepId,
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
      currentNodeId: input.stepId,
      nodeExecutionCounter: nextExecutionCounter,
      nodeExecutionCounts: {
        ...session.nodeExecutionCounts,
        [input.stepId]: executionIndex,
      },
      nodeExecutions: [...session.nodeExecutions, nodeExecution],
      nodeBackendSessions: nextNodeBackendSessions,
      ...(finalOutputPayload !== undefined &&
      isWorkflowOutputKindNode(workflow, input.stepId)
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
            lastError: (() => {
              const p = finalOutputPayload?.["payload"];
              if (typeof p === "object" && p !== null) {
                const m = (p as Readonly<Record<string, unknown>>)[
                  "providerErrorMessage"
                ];
                if (typeof m === "string" && m.length > 0) {
                  return m;
                }
              }
              return (
                finalOutputPayload?.["error"]?.toString() ?? "step call failed"
              );
            })(),
          }),
    };

    if (finalOutputPayload === undefined) {
      session = {
        ...session,
        lastError: "step execution produced no output",
      };
      const persisted = await saveSession(session, input);
      return err({
        session,
        nodeExecution,
        exitCode: 1,
        message: persisted.ok
          ? "step execution produced no output"
          : persisted.error.message,
      });
    }

    let outputRef: OutputRef | undefined;
    if (nodeStatus === "succeeded") {
      outputRef = await this.#publisher.publish({
        workflow,
        session,
        node: executionNodePayload,
        nodeExecution,
        artifactDir,
        inputJson,
        outputPayload: finalOutputPayload,
        timeoutMs,
        requestedBackendSessionMode,
        llmMessages,
      });
    } else {
      await writeRawTextFile(
        path.join(artifactDir, "output.json"),
        `${stableJson(finalOutputPayload)}\n`,
      );
      await writeJsonFile(path.join(artifactDir, "meta.json"), {
        nodeId: input.stepId,
        ...stepIdentityFields,
        nodeExecId,
        mailboxInstanceId,
        status: nodeStatus,
        startedAt,
        endedAt,
        model: executionNodePayload.model,
        ...(input.overrides?.promptVariant === undefined
          ? {}
          : { promptVariant: input.overrides.promptVariant }),
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
          finalOutputPayload["error"]?.toString() ?? "step execution failed",
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

export async function callStepExecution(
  input: CallStepExecutionInput,
  adapter?: NodeAdapter,
): Promise<Result<CallStepExecutionSuccess, CallStepExecutionFailure>> {
  const effectiveAdapter =
    adapter ??
    (input.mockScenario === undefined
      ? new DispatchingNodeAdapter()
      : new ScenarioNodeAdapter(input.mockScenario));
  return new ExecutionDispatcher(effectiveAdapter, input).dispatch(input);
}
