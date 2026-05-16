import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../../shared/fs";
import {
  buildAdapterDivedraHookContext,
  normalizeOutputContractEnvelope,
} from "../adapter";
import {
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
} from "../adapter-execution";
import { DispatchingNodeAdapter } from "../adapters/dispatch";
import { claimFanoutStepBudget } from "../engine-fanout";
import {
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
} from "../history-continuation";
import { assembleNodeInput } from "../input-assembly";
import { validateJsonValueAgainstSchema } from "../json-schema";
import { loadWorkflowFromDisk } from "../load";
import { appendMailboxPromptGuidance } from "../mailbox-prompt-guidance";
import { parseManagerControlPayload } from "../manager-control";
import {
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
} from "../manager-session-store";
import { createExecutionCopyMutableWorkspace } from "../mutable-workspace";
import {
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
} from "../node-execution-mailbox";
import { describeWorkflowNodeKind, isManagerNodeRef } from "../node-role";
import { resolveEffectiveRoots } from "../paths";
import { composeExecutionPrompts } from "../prompt-composition";
import { err, ok } from "../result";
import {
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
} from "../runtime-addressing";
import {
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
} from "../runtime-db";
import { inspectWorkflowRuntimeReadiness } from "../runtime-readiness";
import { ScenarioNodeAdapter } from "../scenario-adapter";
import { evaluateCompletion, resolveLoopTransition } from "../semantics";
import {
  buildOutputRefForExecution,
  createSessionId,
  createSessionState,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
} from "../session";
import { loadSession, saveSession } from "../session-store";
import {
  buildSupervisionStallWatch,
  isSupervisionStallLastError,
} from "../superviser";
import {
  getNormalizedNodePayload,
  getStructuralEdges,
  getStructuralLoops,
  resolveWorkflowManagerStepId,
} from "../types";
import {
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
} from "../working-directory";
import {
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  addMillisecondsToIso,
  buildOptionalSkipOutput,
  buildOutputPromptText,
  buildOutputPublicationPolicy,
  buildReservedCandidateSubmissionPath,
  buildRetryValidationFeedback,
  cleanupReservedCandidateSubmissionPath,
  dedupeNodeIds,
  describeAmbiguousFanoutBranchRerunTarget,
  emitWorkflowRunEvent,
  evaluateEdge,
  findOwningManagerNodeId,
  findPendingOptionalNodeDecision,
  hasPendingPausedFanoutBranch,
  mergeVariables,
  nextManagerSessionId,
  nextNodeExecId,
  nextOutputAttemptId,
  notifyWorkflowProgress,
  nowIso,
  removePendingOptionalNodeDecision,
  resolveCandidatePayload,
  resolveOutputValidationAttempts,
  resolveTimeoutMs,
  resolveTimeoutRestartBudget,
  sha256Hex,
  sleep,
  stableJson,
  upsertPendingOptionalNodeDecision,
  workflowRunFailure,
} from "./types-and-session-state";
import { applyOptionalManagerDecisions } from "./cross-workflow-dispatch";
import {
  executeCrossWorkflowDispatchesForNode,
  executeLocalFanoutTransition,
} from "./fanout-dispatch";
import { runNestedSuperviserSessionDriver } from "./auto-improve-and-runner";
import {
  buildLatestOutputMailboxIndex,
  buildCommitMessageTemplate,
  buildScenarioExecutableNodePayload,
  buildUpstreamInputs,
  cloneSession,
  cloneSupervisionForContinuedRun,
  createInitialSupervisionRunState,
  isTerminalStatus,
  markCommunicationsConsumed,
  persistCommunicationArtifact,
  persistExternalMailboxInputCommunication,
  readBusinessPayload,
} from "./mailbox-communication-artifacts";
import { finalizeCompletedWorkflowRun } from "./result-finalization";

export const workflowRunnerDeps = {
  mkdir,
  rm,
  path,
  writeJsonFile,
  writeRawTextFile,
  buildAdapterDivedraHookContext,
  normalizeOutputContractEnvelope,
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
  DispatchingNodeAdapter,
  claimFanoutStepBudget,
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
  assembleNodeInput,
  validateJsonValueAgainstSchema,
  loadWorkflowFromDisk,
  appendMailboxPromptGuidance,
  parseManagerControlPayload,
  buildAmbientManagerControlPlaneEnvironment,
  createManagerSessionStore,
  hashManagerAuthToken,
  mintManagerAuthToken,
  createExecutionCopyMutableWorkspace,
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
  describeWorkflowNodeKind,
  isManagerNodeRef,
  resolveEffectiveRoots,
  composeExecutionPrompts,
  err,
  ok,
  isWorkflowOutputKindNode,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
  inspectWorkflowRuntimeReadiness,
  ScenarioNodeAdapter,
  evaluateCompletion,
  resolveLoopTransition,
  buildOutputRefForExecution,
  createSessionId,
  createSessionState,
  persistNodeBackendSession,
  resolveRequestedBackendSession,
  loadSession,
  saveSession,
  buildSupervisionStallWatch,
  isSupervisionStallLastError,
  getNormalizedNodePayload,
  getStructuralEdges,
  getStructuralLoops,
  resolveWorkflowManagerStepId,
  resolveNodeExecutionWorkingDirectory,
  resolveWorkflowExecutionWorkingDirectory,
  NON_CONTRACT_CANDIDATE_FILE_ERROR,
  addMillisecondsToIso,
  buildOptionalSkipOutput,
  buildOutputPromptText,
  buildOutputPublicationPolicy,
  buildReservedCandidateSubmissionPath,
  buildRetryValidationFeedback,
  cleanupReservedCandidateSubmissionPath,
  dedupeNodeIds,
  describeAmbiguousFanoutBranchRerunTarget,
  emitWorkflowRunEvent,
  evaluateEdge,
  findOwningManagerNodeId,
  findPendingOptionalNodeDecision,
  hasPendingPausedFanoutBranch,
  mergeVariables,
  nextManagerSessionId,
  nextNodeExecId,
  nextOutputAttemptId,
  notifyWorkflowProgress,
  nowIso,
  removePendingOptionalNodeDecision,
  resolveCandidatePayload,
  resolveOutputValidationAttempts,
  resolveTimeoutMs,
  resolveTimeoutRestartBudget,
  sha256Hex,
  sleep,
  stableJson,
  upsertPendingOptionalNodeDecision,
  workflowRunFailure,
  applyOptionalManagerDecisions,
  executeCrossWorkflowDispatchesForNode,
  executeLocalFanoutTransition,
  runNestedSuperviserSessionDriver,
  buildLatestOutputMailboxIndex,
  buildCommitMessageTemplate,
  buildScenarioExecutableNodePayload,
  buildUpstreamInputs,
  cloneSession,
  cloneSupervisionForContinuedRun,
  createInitialSupervisionRunState,
  isTerminalStatus,
  markCommunicationsConsumed,
  persistCommunicationArtifact,
  persistExternalMailboxInputCommunication,
  readBusinessPayload,
  finalizeCompletedWorkflowRun,
} as const;

export type WorkflowRunnerDeps = typeof workflowRunnerDeps;

export type WorkflowRunnerFileSystemPort = Pick<
  WorkflowRunnerDeps,
  "mkdir" | "rm" | "path" | "writeJsonFile" | "writeRawTextFile"
>;

export type WorkflowRunnerAdapterPort = Pick<
  WorkflowRunnerDeps,
  | "buildAdapterDivedraHookContext"
  | "normalizeOutputContractEnvelope"
  | "executeAdapterWithTimeout"
  | "executePackageNodeWithTimeout"
  | "DispatchingNodeAdapter"
  | "ScenarioNodeAdapter"
>;

export type WorkflowRunnerPersistencePort = Pick<
  WorkflowRunnerDeps,
  | "createManagerSessionStore"
  | "saveNodeExecutionToRuntimeDb"
  | "saveProcessLogsToRuntimeDb"
  | "loadSession"
  | "saveSession"
>;

export type WorkflowRunnerAuthoringPort = Pick<
  WorkflowRunnerDeps,
  | "loadContinuationRelatedSnapshots"
  | "resolveContinuationAnchorPlacement"
  | "validateJsonValueAgainstSchema"
  | "loadWorkflowFromDisk"
  | "appendMailboxPromptGuidance"
  | "resolveEffectiveRoots"
  | "composeExecutionPrompts"
  | "inspectWorkflowRuntimeReadiness"
  | "getNormalizedNodePayload"
  | "getStructuralEdges"
  | "getStructuralLoops"
  | "resolveWorkflowManagerStepId"
  | "resolveNodeExecutionWorkingDirectory"
  | "resolveWorkflowExecutionWorkingDirectory"
>;

export type WorkflowRunnerExecutionPort = Omit<
  WorkflowRunnerDeps,
  | keyof WorkflowRunnerFileSystemPort
  | keyof WorkflowRunnerAdapterPort
  | keyof WorkflowRunnerPersistencePort
  | keyof WorkflowRunnerAuthoringPort
>;

export type WorkflowRunSetupPort = Pick<
  WorkflowRunnerDeps,
  | "DispatchingNodeAdapter"
  | "loadWorkflowFromDisk"
  | "createManagerSessionStore"
  | "createExecutionCopyMutableWorkspace"
  | "resolveEffectiveRoots"
  | "err"
  | "ok"
  | "inspectWorkflowRuntimeReadiness"
  | "ScenarioNodeAdapter"
  | "loadSession"
  | "getStructuralLoops"
  | "resolveWorkflowExecutionWorkingDirectory"
  | "createInitialSupervisionRunState"
>;

export const workflowRunSetupPort: WorkflowRunSetupPort = {
  DispatchingNodeAdapter,
  loadWorkflowFromDisk,
  createManagerSessionStore,
  createExecutionCopyMutableWorkspace,
  resolveEffectiveRoots,
  err,
  ok,
  inspectWorkflowRuntimeReadiness,
  ScenarioNodeAdapter,
  loadSession,
  getStructuralLoops,
  resolveWorkflowExecutionWorkingDirectory,
  createInitialSupervisionRunState,
};

export type WorkflowSessionEntryPort = Pick<
  WorkflowRunnerDeps,
  | "loadContinuationRelatedSnapshots"
  | "resolveContinuationAnchorPlacement"
  | "err"
  | "ok"
  | "createSessionId"
  | "createSessionState"
  | "saveSession"
  | "resolveWorkflowManagerStepId"
  | "describeAmbiguousFanoutBranchRerunTarget"
  | "hasPendingPausedFanoutBranch"
  | "workflowRunFailure"
  | "runNestedSuperviserSessionDriver"
  | "cloneSession"
  | "cloneSupervisionForContinuedRun"
  | "isTerminalStatus"
  | "persistExternalMailboxInputCommunication"
>;

export const workflowSessionEntryPort: WorkflowSessionEntryPort = {
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
  err,
  ok,
  createSessionId,
  createSessionState,
  saveSession,
  resolveWorkflowManagerStepId,
  describeAmbiguousFanoutBranchRerunTarget,
  hasPendingPausedFanoutBranch,
  workflowRunFailure,
  runNestedSuperviserSessionDriver,
  cloneSession,
  cloneSupervisionForContinuedRun,
  isTerminalStatus,
  persistExternalMailboxInputCommunication,
};

export type WorkflowNodeExecutionPort = Pick<
  WorkflowRunnerDeps,
  | "mkdir"
  | "path"
  | "writeRawTextFile"
  | "claimFanoutStepBudget"
  | "loadContinuationRelatedSnapshots"
  | "assembleNodeInput"
  | "appendMailboxPromptGuidance"
  | "buildAmbientManagerControlPlaneEnvironment"
  | "hashManagerAuthToken"
  | "mintManagerAuthToken"
  | "buildNodeExecutionMailbox"
  | "writeNodeExecutionMailboxArtifacts"
  | "describeWorkflowNodeKind"
  | "isManagerNodeRef"
  | "composeExecutionPrompts"
  | "err"
  | "ok"
  | "resolveBackendSessionSelection"
  | "resolveRequiredStepExecutionAddress"
  | "toStepIdentityFields"
  | "resolveRequestedBackendSession"
  | "loadSession"
  | "saveSession"
  | "getNormalizedNodePayload"
  | "getStructuralEdges"
  | "addMillisecondsToIso"
  | "buildOutputPublicationPolicy"
  | "dedupeNodeIds"
  | "emitWorkflowRunEvent"
  | "findOwningManagerNodeId"
  | "findPendingOptionalNodeDecision"
  | "mergeVariables"
  | "nextManagerSessionId"
  | "nextNodeExecId"
  | "notifyWorkflowProgress"
  | "nowIso"
  | "resolveOutputValidationAttempts"
  | "resolveTimeoutMs"
  | "stableJson"
  | "upsertPendingOptionalNodeDecision"
  | "workflowRunFailure"
  | "buildLatestOutputMailboxIndex"
  | "buildScenarioExecutableNodePayload"
  | "buildUpstreamInputs"
  | "isTerminalStatus"
  | "finalizeCompletedWorkflowRun"
>;

export const workflowNodeExecutionPort: WorkflowNodeExecutionPort = {
  mkdir,
  path,
  writeRawTextFile,
  claimFanoutStepBudget,
  loadContinuationRelatedSnapshots,
  assembleNodeInput,
  appendMailboxPromptGuidance,
  buildAmbientManagerControlPlaneEnvironment,
  hashManagerAuthToken,
  mintManagerAuthToken,
  buildNodeExecutionMailbox,
  writeNodeExecutionMailboxArtifacts,
  describeWorkflowNodeKind,
  isManagerNodeRef,
  composeExecutionPrompts,
  err,
  ok,
  resolveBackendSessionSelection,
  resolveRequiredStepExecutionAddress,
  toStepIdentityFields,
  resolveRequestedBackendSession,
  loadSession,
  saveSession,
  getNormalizedNodePayload,
  getStructuralEdges,
  addMillisecondsToIso,
  buildOutputPublicationPolicy,
  dedupeNodeIds,
  emitWorkflowRunEvent,
  findOwningManagerNodeId,
  findPendingOptionalNodeDecision,
  mergeVariables,
  nextManagerSessionId,
  nextNodeExecId,
  notifyWorkflowProgress,
  nowIso,
  resolveOutputValidationAttempts,
  resolveTimeoutMs,
  stableJson,
  upsertPendingOptionalNodeDecision,
  workflowRunFailure,
  buildLatestOutputMailboxIndex,
  buildScenarioExecutableNodePayload,
  buildUpstreamInputs,
  isTerminalStatus,
  finalizeCompletedWorkflowRun,
};

export type WorkflowNodeOutputAttemptPort = Pick<
  WorkflowRunnerDeps,
  | "buildAdapterDivedraHookContext"
  | "executeAdapterWithTimeout"
  | "executePackageNodeWithTimeout"
  | "buildSupervisionStallWatch"
  | "resolveNodeExecutionWorkingDirectory"
>;

export const workflowNodeOutputAttemptPort: WorkflowNodeOutputAttemptPort = {
  buildAdapterDivedraHookContext,
  executeAdapterWithTimeout,
  executePackageNodeWithTimeout,
  buildSupervisionStallWatch,
  resolveNodeExecutionWorkingDirectory,
};

export type WorkflowStepInputPort = Pick<
  WorkflowRunnerDeps,
  | "mkdir"
  | "path"
  | "writeJsonFile"
  | "writeRawTextFile"
  | "nowIso"
  | "stableJson"
  | "removePendingOptionalNodeDecision"
  | "loadSession"
  | "saveSession"
  | "ok"
  | "buildOptionalSkipOutput"
  | "evaluateEdge"
  | "resolveLoopTransition"
  | "buildOutputRefForExecution"
  | "sha256Hex"
  | "buildCommitMessageTemplate"
  | "saveNodeExecutionToRuntimeDb"
  | "markCommunicationsConsumed"
  | "err"
  | "persistCommunicationArtifact"
  | "resolveWorkflowManagerStepId"
  | "dedupeNodeIds"
  | "isWorkflowOutputKindNode"
>;

export const workflowStepInputPort: WorkflowStepInputPort = {
  mkdir,
  path,
  writeJsonFile,
  writeRawTextFile,
  nowIso,
  stableJson,
  removePendingOptionalNodeDecision,
  loadSession,
  saveSession,
  ok,
  buildOptionalSkipOutput,
  evaluateEdge,
  resolveLoopTransition,
  buildOutputRefForExecution,
  sha256Hex,
  buildCommitMessageTemplate,
  saveNodeExecutionToRuntimeDb,
  markCommunicationsConsumed,
  err,
  persistCommunicationArtifact,
  resolveWorkflowManagerStepId,
  dedupeNodeIds,
  isWorkflowOutputKindNode,
};

export type WorkflowStepResultFinalizationPort = Pick<
  WorkflowRunnerDeps,
  | "path"
  | "writeJsonFile"
  | "writeRawTextFile"
  | "parseManagerControlPayload"
  | "hashManagerAuthToken"
  | "isManagerNodeRef"
  | "err"
  | "isWorkflowOutputKindNode"
  | "saveNodeExecutionToRuntimeDb"
  | "saveProcessLogsToRuntimeDb"
  | "evaluateCompletion"
  | "resolveLoopTransition"
  | "buildOutputRefForExecution"
  | "persistNodeBackendSession"
  | "saveSession"
  | "isSupervisionStallLastError"
  | "resolveWorkflowManagerStepId"
  | "dedupeNodeIds"
  | "emitWorkflowRunEvent"
  | "evaluateEdge"
  | "nowIso"
  | "resolveTimeoutRestartBudget"
  | "sha256Hex"
  | "sleep"
  | "stableJson"
  | "workflowRunFailure"
  | "applyOptionalManagerDecisions"
  | "buildCommitMessageTemplate"
  | "markCommunicationsConsumed"
  | "persistCommunicationArtifact"
  | "readBusinessPayload"
>;

export const workflowStepResultFinalizationPort: WorkflowStepResultFinalizationPort =
  {
    path,
    writeJsonFile,
    writeRawTextFile,
    parseManagerControlPayload,
    hashManagerAuthToken,
    isManagerNodeRef,
    err,
    isWorkflowOutputKindNode,
    saveNodeExecutionToRuntimeDb,
    saveProcessLogsToRuntimeDb,
    evaluateCompletion,
    resolveLoopTransition,
    buildOutputRefForExecution,
    persistNodeBackendSession,
    saveSession,
    isSupervisionStallLastError,
    resolveWorkflowManagerStepId,
    dedupeNodeIds,
    emitWorkflowRunEvent,
    evaluateEdge,
    nowIso,
    resolveTimeoutRestartBudget,
    sha256Hex,
    sleep,
    stableJson,
    workflowRunFailure,
    applyOptionalManagerDecisions,
    buildCommitMessageTemplate,
    markCommunicationsConsumed,
    persistCommunicationArtifact,
    readBusinessPayload,
  };
