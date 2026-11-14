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
import {
  resolveCandidatePayload,
  resolveRuntimeTimeoutMs,
  publishNodeOutputArtifacts,
  sha256Hex,
  stableJson,
} from "../runtime-execution-contracts";
export {
  MAX_OUTPUT_VALIDATION_FEEDBACK_ERRORS,
  MAX_OUTPUT_VALIDATION_FEEDBACK_MESSAGE_LENGTH,
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  buildOutputPromptText,
  buildOutputPublicationPolicy,
  buildReservedCandidateSubmissionPath,
  cleanupReservedCandidateSubmissionPath,
  formatOutputValidationErrors,
  nextManagerSessionId,
  nextNodeExecId,
  nextOutputAttemptId,
  readCandidatePayloadFromFile,
  resolveCandidatePayload,
  resolveOutputValidationAttempts,
  sha256Hex,
  stableJson,
  type CandidatePayloadResolutionError,
} from "../runtime-execution-contracts";
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
export function resolveTimeoutMs(
  node: NodePayload,
  workflowTimeoutMs: number,
  overrideTimeoutMs: number | undefined,
  invocationTimeoutMs: number | undefined,
): number {
  return resolveRuntimeTimeoutMs({
    candidates: [
      {
        timeoutMs: invocationTimeoutMs,
        source: "invocation",
        requirePositive: true,
      },
      { timeoutMs: node.timeoutMs, source: "node" },
      {
        timeoutMs: overrideTimeoutMs,
        source: "override",
        requirePositive: true,
      },
    ],
    fallback: { timeoutMs: workflowTimeoutMs, source: "workflow-default" },
  }).timeoutMs;
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

    await publishNodeOutputArtifacts({
      artifactDir: input.artifactDir,
      outputRaw,
      metaPayload,
      handoffPayload,
      commitMessageTemplate: buildCommitMessageTemplate(
        inputHash,
        outputHash,
        outputRef,
      ),
    });

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
