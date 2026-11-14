import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../../shared/fs";
import {
  buildAdapterDivedraHookContext,
  type AdapterAmbientManagerContext,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "../adapter";
import {
  executeAdapterWithTimeout,
  executeNativeNodeWithTimeout,
} from "../adapter-execution";
import { DispatchingNodeAdapter } from "../adapters/dispatch";
import { assembleNodeInput } from "../input-assembly";
import type { JsonSchemaValidationError } from "../json-schema";
import {
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "../load";
import { appendMailboxPromptGuidance } from "../mailbox-prompt-guidance";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
} from "../manager-session-store";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "../node-execution-mailbox";
import { describeWorkflowNodeKind, isManagerNodeRef } from "../node-role";
import { composeExecutionPrompts } from "../prompt-composition";
import { err, ok, type Result } from "../result";
import {
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
} from "../runtime-addressing";
import { saveProcessLogsToRuntimeDb } from "../runtime-db";
import { inspectWorkflowRuntimeReadiness } from "../runtime-readiness";
import {
  isTerminalWorkflowSessionStatus,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
  type NodeExecutionRecord,
  type OutputRef,
  type WorkflowSessionState,
} from "../session";
import { loadSession, saveSession } from "../session-store";
import { buildSupervisionStallWatch } from "../superviser";
import { getNormalizedNodePayload, type LoadOptions } from "../types";
import {
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
} from "../working-directory";

import {
  type CallStepExecutionFailure,
  type CallStepExecutionInput,
  type CallStepExecutionSuccess,
  nowIso,
  stableJson,
  nextNodeExecId,
  nextManagerSessionId,
  resolveTimeoutMs,
  resolveOutputValidationAttempts,
  buildOutputPublicationPolicy,
  nextOutputAttemptId,
  buildReservedCandidateSubmissionPath,
  cleanupReservedCandidateSubmissionPath,
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  formatOutputValidationErrors,
  buildOutputPromptText,
  buildScenarioExecutableNodePayload,
  applyDirectExecutionOverrides,
  OutputValidator,
  MailboxPublisher,
} from "./direct-step-helpers";
import {
  buildMissingDirectStepSession,
  describeDirectStepFailure,
} from "./direct-step-session-updates";
export class ExecutionDispatcher {
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
      const session = buildMissingDirectStepSession(input);
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
      return err({ session, exitCode: 2, message: nodeWithOverrides.error });
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
        const supervisionStall = buildSupervisionStallWatch(session, input, {
          ...(executionNodePayload.stallTimeoutMs === undefined
            ? {}
            : { stallTimeoutMs: executionNodePayload.stallTimeoutMs }),
        });
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
    } catch {}
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
            lastError: describeDirectStepFailure(finalOutputPayload),
          }),
    };
    if (finalOutputPayload === undefined) {
      session = { ...session, lastError: "step execution produced no output" };
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
