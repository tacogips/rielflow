import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  normalizeOutputContractEnvelope,
  type AdapterBackendSessionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterOutputContractInput,
  type AdapterProcessLog,
} from "./adapter";
import type { AdapterExecutionFailure } from "./adapter-execution";
import {
  type JsonSchemaValidationError,
  validateJsonValueAgainstSchema,
} from "./json-schema";
import { ok, type Result } from "./result";
import {
  buildOutputPromptText,
  buildOutputPublicationPolicy,
  buildReservedCandidateSubmissionPath,
  buildRetryValidationFeedback,
  cleanupReservedCandidateSubmissionPath,
  nextOutputAttemptId,
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  resolveCandidatePayload,
  resolveOutputValidationAttempts,
} from "./runtime-execution-contracts";
import type { NodeExecutionRecord } from "./session";
import type { AgentNodePayload, JsonObject, NodePayload } from "./types";
import { atomicWriteJsonFile as writeJsonFile } from "../shared/fs";

export interface OutputAttemptExecutionInput {
  readonly executionPromptText: string;
  readonly outputContract?: AdapterOutputContractInput;
  readonly backendSession?: AdapterBackendSessionInput;
}

export interface OutputAttemptRunnerInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly artifactDir: string;
  readonly agentNodePayload: AgentNodePayload | null;
  readonly executionNodePayload: NodePayload;
  readonly basePromptText: string;
  readonly systemPromptText?: string;
  readonly initialOutputValidationErrors?: readonly JsonSchemaValidationError[];
  readonly initialProcessLogs?: readonly AdapterProcessLog[];
  readonly initialLlmMessages?: readonly AdapterLlmSessionMessage[];
  readonly initialBackendSession?: AdapterBackendSessionInput;
  readonly clearValidationErrorsOnExecutionFailure: boolean;
  readonly executeAttempt: (
    input: OutputAttemptExecutionInput,
  ) => Promise<Result<AdapterExecutionOutput, AdapterExecutionFailure>>;
}

export interface OutputAttemptRunnerResult {
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly nodeStatus: NodeExecutionRecord["status"];
  readonly outputValidationErrors: readonly JsonSchemaValidationError[];
  readonly outputAttemptCount: number;
  readonly processLogs: readonly AdapterProcessLog[];
  readonly llmMessages: readonly AdapterLlmSessionMessage[];
  readonly backendSession?: AdapterBackendSessionInput;
  readonly backendSessionId?: string;
  readonly backendSessionProvider?: string;
}

function failedOutputPayload(input: {
  readonly provider: string;
  readonly model: string;
  readonly promptText: string;
  readonly error: string;
  readonly validationErrors?: readonly JsonSchemaValidationError[];
  readonly payload?: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    provider: input.provider,
    model: input.model,
    promptText: input.promptText,
    completionPassed: false,
    when: {},
    payload: input.payload ?? {},
    error: input.error,
    ...(input.validationErrors === undefined
      ? {}
      : { validationErrors: input.validationErrors }),
  };
}

function deterministicFailureModel(input: {
  readonly agentNodePayload: AgentNodePayload | null;
  readonly executionNodePayload: NodePayload;
}): string {
  return (
    input.agentNodePayload?.model ??
    input.executionNodePayload.nodeType ??
    "node"
  );
}

function buildAdapterOutputContract(input: {
  readonly agentNodePayload: AgentNodePayload | null;
  readonly outputCandidatePath: string | undefined;
  readonly maxOutputAttempts: number;
  readonly outputAttempt: number;
  readonly retryValidationFeedback: readonly JsonSchemaValidationError[];
}): AdapterOutputContractInput | undefined {
  if (
    input.agentNodePayload === null ||
    input.agentNodePayload.output === undefined
  ) {
    return undefined;
  }
  if (input.outputCandidatePath === undefined) {
    throw new Error("candidate path must exist when node.output is configured");
  }
  return {
    ...(input.agentNodePayload.output.description === undefined
      ? {}
      : { description: input.agentNodePayload.output.description }),
    ...(input.agentNodePayload.output.jsonSchema === undefined
      ? {}
      : { jsonSchema: input.agentNodePayload.output.jsonSchema }),
    maxValidationAttempts: input.maxOutputAttempts,
    attempt: input.outputAttempt,
    candidatePath: input.outputCandidatePath,
    validationErrors: input.retryValidationFeedback,
    publication: buildOutputPublicationPolicy(),
  };
}

export async function runOutputAttempts(
  input: OutputAttemptRunnerInput,
): Promise<OutputAttemptRunnerResult> {
  let outputValidationErrors = input.initialOutputValidationErrors ?? [];
  let outputAttemptCount = 1;
  let processLogs = input.initialProcessLogs ?? [];
  let llmMessages = input.initialLlmMessages ?? [];
  let backendSession = input.initialBackendSession;
  let backendSessionId = input.initialBackendSession?.sessionId;
  let backendSessionProvider: string | undefined;
  let nodeStatus: NodeExecutionRecord["status"] = "succeeded";
  let finalizedOutput: Readonly<Record<string, unknown>> | undefined;
  const hasOutputContract = input.executionNodePayload.output !== undefined;
  const maxOutputAttempts = hasOutputContract
    ? resolveOutputValidationAttempts(input.executionNodePayload)
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
        : path.join(input.artifactDir, "output-attempts", outputAttemptId);
    const candidateArtifactPath =
      attemptDir === undefined
        ? undefined
        : path.join(attemptDir, "candidate.json");
    const candidatePath =
      outputAttemptId === undefined || input.agentNodePayload === null
        ? undefined
        : buildReservedCandidateSubmissionPath({
            workflowId: input.workflowId,
            workflowExecutionId: input.workflowExecutionId,
            nodeId: input.nodeId,
            nodeExecId: input.nodeExecId,
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
      candidatePath === undefined || input.agentNodePayload === null
        ? input.basePromptText
        : buildOutputPromptText({
            basePromptText: input.basePromptText,
            node: input.agentNodePayload,
            candidatePath,
            validationErrors: outputValidationErrors,
          });
    const retryValidationFeedback = buildRetryValidationFeedback(
      outputValidationErrors,
    );

    if (requestPath !== undefined && candidatePath !== undefined) {
      await writeJsonFile(requestPath, {
        attempt: outputAttempt,
        executionBackend:
          input.agentNodePayload?.executionBackend ??
          input.executionNodePayload.nodeType ??
          "agent",
        model:
          input.agentNodePayload?.model ?? input.executionNodePayload.nodeType,
        promptText: executionPromptText,
        candidatePath,
        validationErrors: retryValidationFeedback,
      });
    }

    try {
      const outputCandidatePath = hasOutputContract ? candidatePath : undefined;
      if (
        hasOutputContract &&
        input.agentNodePayload !== null &&
        outputCandidatePath === undefined
      ) {
        throw new Error(
          "candidate path must exist when node.output is configured",
        );
      }
      const outputContract = hasOutputContract
        ? buildAdapterOutputContract({
            agentNodePayload: input.agentNodePayload,
            outputCandidatePath,
            maxOutputAttempts,
            outputAttempt,
            retryValidationFeedback,
          })
        : undefined;
      const execution = await input.executeAttempt({
        executionPromptText,
        ...(backendSession === undefined ? {} : { backendSession }),
        ...(outputContract === undefined ? {} : { outputContract }),
      });

      if (!execution.ok) {
        processLogs = [...processLogs, ...(execution.error.processLogs ?? [])];
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
            rejectedAt: new Date().toISOString(),
          });
          if (outputAttempt < maxOutputAttempts) {
            continue;
          }
          nodeStatus = "failed";
          finalizedOutput = failedOutputPayload({
            provider: "deterministic-local",
            model: deterministicFailureModel(input),
            promptText: input.basePromptText,
            error: "output_validation_failed",
            validationErrors: outputValidationErrors,
          });
          break;
        }
        if (input.clearValidationErrorsOnExecutionFailure) {
          outputValidationErrors = [];
        }
        nodeStatus =
          execution.error.code === "timeout" ? "timed_out" : "failed";
        finalizedOutput = failedOutputPayload({
          provider: "deterministic-local",
          model: deterministicFailureModel(input),
          promptText: input.basePromptText,
          error: execution.error.code,
          payload:
            execution.error.code === "provider_error" &&
            execution.error.message.length > 0
              ? { providerErrorMessage: execution.error.message }
              : {},
        });
        break;
      }

      backendSessionProvider = execution.value.provider;
      processLogs = [...processLogs, ...(execution.value.processLogs ?? [])];
      llmMessages = [...llmMessages, ...(execution.value.llmMessages ?? [])];
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
        finalizedOutput = failedOutputPayload({
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          error: "invalid_output",
          validationErrors: outputValidationErrors,
        });
        break;
      }

      if (!hasOutputContract) {
        finalizedOutput = {
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          completionPassed: execution.value.completionPassed,
          when: execution.value.when,
          payload: execution.value.payload,
        };
        break;
      }

      const candidateResult =
        outputCandidatePath === undefined
          ? ok(execution.value.payload)
          : await resolveCandidatePayload({
              expectedCandidatePath: outputCandidatePath,
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
            rejectedAt: new Date().toISOString(),
          });
        }
        if (
          candidateResult.error.retryable &&
          outputAttempt < maxOutputAttempts
        ) {
          continue;
        }
        nodeStatus = "failed";
        finalizedOutput = failedOutputPayload({
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          error: candidateResult.error.retryable
            ? "output_validation_failed"
            : "invalid_output",
          validationErrors: outputValidationErrors,
        });
        break;
      }

      let normalizedContractPayload: ReturnType<
        typeof normalizeOutputContractEnvelope
      >;
      try {
        normalizedContractPayload = normalizeOutputContractEnvelope(
          candidateResult.value,
          "node output candidate",
          {
            completionPassed: execution.value.completionPassed,
            when: execution.value.when,
          },
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "invalid output contract envelope";
        outputValidationErrors = [{ path: "$", message }];
        if (validationPath !== undefined) {
          await writeJsonFile(validationPath, {
            valid: false,
            errors: outputValidationErrors,
            rejectedAt: new Date().toISOString(),
          });
        }
        if (outputAttempt < maxOutputAttempts) {
          continue;
        }
        nodeStatus = "failed";
        finalizedOutput = failedOutputPayload({
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          error: "output_validation_failed",
          validationErrors: outputValidationErrors,
        });
        break;
      }

      if (candidateArtifactPath !== undefined) {
        await writeJsonFile(
          candidateArtifactPath,
          normalizedContractPayload.payload,
        );
      }
      const schema = input.executionNodePayload.output?.jsonSchema;
      const validationErrors =
        schema === undefined
          ? []
          : validateJsonValueAgainstSchema({
              schema: schema as JsonObject,
              value: normalizedContractPayload.payload,
            });
      outputValidationErrors = validationErrors;
      if (validationPath !== undefined) {
        await writeJsonFile(validationPath, {
          valid: validationErrors.length === 0,
          errors: validationErrors,
          validatedAt: new Date().toISOString(),
        });
      }
      if (validationErrors.length === 0) {
        finalizedOutput = {
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          completionPassed: normalizedContractPayload.completionPassed,
          when: normalizedContractPayload.when,
          payload: normalizedContractPayload.payload,
        };
        break;
      }
      if (outputAttempt === maxOutputAttempts) {
        nodeStatus = "failed";
        finalizedOutput = failedOutputPayload({
          provider: execution.value.provider,
          model: execution.value.model,
          promptText: input.basePromptText,
          error: "output_validation_failed",
          validationErrors,
        });
        break;
      }
    } finally {
      if (candidatePath !== undefined) {
        await cleanupReservedCandidateSubmissionPath(candidatePath);
      }
    }
  }

  return {
    outputPayload:
      finalizedOutput ??
      failedOutputPayload({
        provider: "deterministic-local",
        model: deterministicFailureModel(input),
        promptText: input.basePromptText,
        error: "provider_error",
      }),
    nodeStatus,
    outputValidationErrors,
    outputAttemptCount,
    processLogs,
    llmMessages,
    ...(backendSession === undefined ? {} : { backendSession }),
    ...(backendSessionId === undefined ? {} : { backendSessionId }),
    ...(backendSessionProvider === undefined ? {} : { backendSessionProvider }),
  };
}
