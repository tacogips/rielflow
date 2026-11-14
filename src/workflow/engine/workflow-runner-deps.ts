// @ts-nocheck
// biome-ignore-all lint/correctness/noUnusedImports: shared dependency module intentionally centralizes imports for extracted lifecycle phases.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  atomicWriteJsonFile as writeJsonFile,
  atomicWriteTextFile as writeRawTextFile,
} from "../../shared/fs";
import {
  buildAdapterDivedraHookContext,
  normalizeOutputContractEnvelope,
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
import { claimFanoutStepBudget } from "../engine-fanout";
import {
  loadContinuationRelatedSnapshots,
  resolveContinuationAnchorPlacement,
} from "../history-continuation";
import { assembleNodeInput } from "../input-assembly";
import {
  validateJsonValueAgainstSchema,
  type JsonSchemaValidationError,
} from "../json-schema";
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
import { err, ok, type Result } from "../result";
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
  type CommunicationRecord,
  type FanoutGroupRunRecord,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "../session";
import { loadSession, saveSession } from "../session-store";
import {
  buildSupervisionStallWatch,
  isSupervisionStallLastError,
} from "../superviser";
import type {
  JsonObject,
  LoopRule,
  SupervisionRunState,
  WorkflowEdge,
} from "../types";
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
import type {
  CancellationProbe,
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunFailure,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./types-and-session-state";
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
  executeNativeNodeWithTimeout,
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
};
