import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../../shared/fs";
import {
  normalizeOutputContractEnvelope,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
} from "../adapter";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "../json-schema";
import { err, ok, type Result } from "../result";
import { toStepIdentityFields } from "../runtime-addressing";
import { saveNodeExecutionToRuntimeDb } from "../runtime-db";
import type { MockNodeScenario } from "../scenario-adapter";
import {
  buildOutputRefForExecution,
  type NodeExecutionRecord,
  type OutputRef,
  type WorkflowSessionState,
} from "../session";
import type { SessionStoreOptions } from "../session-store";
import type { SuperviserRuntimeControl } from "../superviser-control";
import {
  asAgentNodePayload,
  type AgentNodePayload,
  type ChatReplyDispatcher,
  type JsonObject,
  type LoadOptions,
  type NodePayload,
  type NodePromptVariant,
  type NodeSessionMode,
  type WorkflowJson,
} from "../types";

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
export function nowIso(): string {
  return new Date().toISOString();
}
export function stableJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
export function nextNodeExecId(counter: number): string {
  return `exec-${String(counter).padStart(6, "0")}`;
}
export function nextManagerSessionId(nodeExecId: string): string {
  return `mgrsess-${nodeExecId}`;
}
export function resolveTimeoutMs(
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
export const MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS = 8;
export const MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH = 240;
export const NON_CONTRACT_CANDIDATE_FILE_ERROR =
  "adapter output.candidateFilePath is only supported when node.output is configured";
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
    sections.push(
      contract.jsonSchema === undefined
        ? "Return a corrected JSON object."
        : "Return a corrected JSON object that satisfies the schema.",
    );
  }
  return sections.join("\n");
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
export function buildScenarioExecutableNodePayload(input: {
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
export function applyPromptVariantTemplateOverride(input: {
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
export function applyPromptVariantOverride(input: {
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
export function applyDirectExecutionOverrides(
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
export function buildCommitMessageTemplate(
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
export class OutputValidator {
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
export class MailboxPublisher {
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
