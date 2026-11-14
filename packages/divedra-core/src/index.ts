// Core package contract: expose workflow runtime and supervision primitives
// without pulling in CLI, server transport, or native add-on ownership.
export type * from "./workflow-model";
export {
  CLI_AGENT_BACKENDS,
  isCliAgentBackend,
  NODE_EXECUTION_BACKEND,
  NODE_EXECUTION_BACKENDS,
  NODE_EXECUTION_BACKEND_LIST_TEXT,
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "./workflow-model";
export {
  noopWorkflowRunEventSink,
  runWorkflow,
  type WorkflowRunOptions,
  type WorkflowRunEvent,
  type WorkflowRunEventOptions,
  type WorkflowRunEventSink,
} from "../../divedra/src/workflow/engine";
export {
  loadWorkflowFromCatalog,
  loadWorkflowFromDisk,
  mergeLoadOptionsForSessionMutableBundle,
} from "../../divedra/src/workflow/load";
export {
  DEFAULT_SELF_IMPROVE_LOG_LIMIT,
  executeWorkflowSelfImprove,
  getWorkflowSelfImproveReport,
  listWorkflowSelfImproveReports,
  resolveWorkflowSelfImprovePolicy,
  type ExecuteWorkflowSelfImproveInput,
  type WorkflowPurposeAchievement,
  type WorkflowSelfImproveBackupResult,
  type WorkflowSelfImproveFinding,
  type WorkflowSelfImproveGitCommitResult,
  type WorkflowSelfImproveMode,
  type WorkflowSelfImprovePatchResult,
  type WorkflowSelfImprovePolicy,
  type WorkflowSelfImproveReport,
  type WorkflowSelfImproveReportListInput,
  type WorkflowSelfImproveReportLookupInput,
  type WorkflowSelfImproveReportSummary,
  type WorkflowSelfImproveResult,
  type WorkflowSelfImproveSourceNodeExecution,
  type WorkflowSelfImproveSourceMode,
  type WorkflowSelfImproveSourceRun,
} from "../../divedra/src/workflow/self-improve";
export {
  applyWorkflowNodePatch,
  applyWorkflowNodePatchToRawPayloads,
  normalizeWorkflowNodePatchMap,
  readWorkflowNodePatch,
  type ApplyWorkflowNodePatchInput,
  type ApplyWorkflowNodePatchToRawPayloadsInput,
  type ParseWorkflowNodePatchInput,
} from "../../divedra/src/workflow/node-patches";
export {
  listWorkflowCatalogSources,
  resolveAddonSource,
  resolveWorkflowCreateSource,
  resolveWorkflowScopeSelector,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "../../divedra/src/workflow/catalog";
export {
  listSessions,
  loadSession,
  saveSession,
  type SessionStoreOptions,
} from "../../divedra/src/workflow/session-store";
export {
  normalizeSessionState,
  resolveCurrentStepId,
  resolveCurrentStepIdFromWorkflow,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "../../divedra/src/workflow/session";
export {
  listEventReplyDispatchesFromRuntimeDb,
  listRuntimeHookEvents,
  resolveRuntimeDbPath,
  listRuntimeLlmSessionMessages,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  listRuntimeSessions,
} from "../../divedra/src/workflow/runtime-db";
export {
  createCommunicationService,
  type CommunicationArtifactSnapshot,
  type CommunicationAttemptSnapshot,
  type CommunicationGraphqlView,
  type CommunicationLookupInput,
  type ReplayCommunicationInput,
  type ReplayCommunicationResult,
  type RetryCommunicationDeliveryInput,
  type RetryCommunicationDeliveryResult,
} from "../../divedra/src/workflow/communication-service";
export {
  createManagerSessionStore,
  hashManagerAuthToken,
  verifyManagerAuthToken,
  resolveAmbientManagerExecutionContext,
  type AmbientManagerExecutionContext,
  type IdempotentMutationLookup,
  type IdempotentMutationRecord,
  type ManagerControlMode,
  type ManagerIntentSummary,
  type ManagerMessageRecord,
  type ManagerSessionRecord,
  type ManagerSessionStore,
} from "../../divedra/src/workflow/manager-session-store";
export {
  createManagerMessageService,
  type DataDirFileRef,
  type ManagerMessageService,
  type SendManagerMessageInput,
  type SendManagerMessageResult,
} from "../../divedra/src/workflow/manager-message-service";
export {
  parseManagerControlActions,
  parseManagerControlPayload,
  type ManagerControlAction,
  type ManagerControlActionType,
  type ParsedManagerControl,
} from "../../divedra/src/workflow/manager-control";
export type {
  AgentNodePayload,
  AgentWorkerAddonConfig,
  AsyncNodeAddonPayloadResolver,
  AutoImprovePolicy,
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
  ChatReplyDispatchTarget,
  ChatReplyDispatcher,
  ChatReplyWorkerConfig,
  CliAgentBackend,
  ContainerExecution,
  ContainerRunnerKind,
  GitCommitAddonConfig,
  GitPushAddonConfig,
  JsonObject,
  LoadOptions,
  MailGatewayAddonConfig,
  MailGatewayReadAddonConfig,
  MutableWorkflowWorkspace,
  NodeAddonDefinition,
  NodeAddonDefinitionResolver,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  NodeAddonValidateInput,
  NodeAddonValidateResult,
  NodeExecutionBackend,
  NodeOutputContract,
  NodePayload,
  ResolvedAddonSource,
  ResolvedAgentWorkerAddon,
  ResolvedChatReplyWorkerAddon,
  ResolvedClaudeCodeWorkerAddon,
  ResolvedCodexWorkerAddon,
  ResolvedGitCommitAddon,
  ResolvedGitPushAddon,
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedNodeAddon,
  ResolvedSuperviserControlAddon,
  ResolvedWorkflowSource,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
  SupervisionIncident,
  SupervisionRemediationAction,
  SupervisionRemediationRecord,
  SupervisionRunState,
  SupervisionRunStatus,
  SupervisionStallWatch,
  SupervisionSummary,
  SuperviserControlAddonName,
  ValidationIssue,
  WorkflowPatchRevisionInput,
  WorkflowPatchRevisionRecord,
  WorkflowDefaults,
  WorkflowJson,
  WorkflowNodeAddonRef,
  WorkflowNodeAddonEnvBinding,
  WorkflowNodePatch,
  WorkflowNodePatchMap,
  WorkflowScopeSelector,
  WorkflowSourceScope,
  XGatewayAddonConfig,
  XGatewayReadAddonConfig,
} from "../../divedra/src/workflow/types";
export {
  describeSuperviserControlAddon,
  getSuperviserControlAddonProviderOperationId,
  isSuperviserControlAddonName,
} from "../../divedra/src/workflow/types";
export {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "./node-template-fields";
export { renderPromptTemplate } from "./render";
export { buildPromptTemplateVariables } from "./prompt-template-context";
export {
  AdapterExecutionError,
  normalizeOutputContractEnvelope,
  parseJsonObjectCandidate,
  type AdapterExecutionContext,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterLlmSessionMessage,
  type AdapterProcessLog,
  type NodeAdapter,
} from "../../divedra/src/workflow/adapter";
export { normalizeTextBusinessPayload } from "../../divedra/src/workflow/json-boundary";
export type { NodeExecutionMailbox } from "../../divedra/src/workflow/node-execution-mailbox";
export { err, ok, type Result } from "./result";
export {
  validateJsonSchemaDefinition,
  validateJsonValueAgainstSchema,
} from "./json-schema";
export {
  NodeValidationResult,
  hasInvalidNodeValidationResult,
  type NodeValidationResultInput,
  type NodeValidationSource,
  type NodeValidationStatus,
} from "../../divedra/src/workflow/validate/node-validation-result";
export { callStep } from "../../divedra/src/workflow/call-step";
export type {
  CallStepFailure,
  CallStepInput,
  CallStepOverrides,
  CallStepSuccess,
} from "../../divedra/src/workflow/call-step";
export { deriveWorkflowVisualization } from "../../divedra/src/workflow/visualization";
export {
  buildFanoutGroupSummaries,
  buildInspectionSummary,
  getSupervisionSummary,
  type FanoutGroupSummary,
  type WorkflowInspectionCounts,
  type WorkflowInspectionSummary,
} from "../../divedra/src/workflow/inspect";
export {
  buildWorkflowUsageCatalog,
  buildWorkflowUsageSummary,
  type WorkflowUsageCatalog,
  type WorkflowUsageSummary,
} from "../../divedra/src/workflow/usage";
export {
  buildMutableWorkflowWorkspace,
  createExecutionCopyMutableWorkspace,
  readWorkflowPatchRevisionsFromArtifact,
  recordWorkflowPatchRevision,
  type MutableWorkspaceFailure,
} from "../../divedra/src/workflow/mutable-workspace";
export {
  buildSupervisionStallWatch,
  getEngineSupervisionPatcherId,
  isSupervisionStallLastError,
  planSupervisionRemediation,
  resolveSupervisionRerunAnchor,
  resolveSupervisionRerunTarget,
  SUPERVISION_STALL_ERROR_PREFIX,
  type StartSupervisedRunInput,
  type SupervisionRemediationDecision,
  type SupervisionRemediationPlan,
} from "../../divedra/src/workflow/superviser";
export {
  executeSuperviserControlNativeOperation,
  type SuperviserRuntimeControl,
} from "../../divedra/src/workflow/superviser-control";
export {
  normalizeWorkflowWorkingDirectoryOverride,
  resolveNodeExecutionWorkingDirectory,
} from "../../divedra/src/workflow/working-directory";
export {
  createWorkflowSupervisorDispatchClient,
  type DispatchSupervisorConversationInput,
  type StartManagedWorkflowInput,
  type StopManagedWorkflowInput,
  type SubmitManagedWorkflowInput,
  type SupervisorRuntimeCapabilitySet,
  type WorkflowSupervisorDispatchClient,
  type WorkflowSupervisorDispatchView,
} from "../../divedra/src/workflow/supervisor-dispatch-client";
export {
  createWorkflowSupervisorGraphqlClient,
  postDispatchSupervisorConversationThroughGraphql,
  type WorkflowSupervisorGraphqlClientOptions,
} from "../../divedra/src/workflow/supervisor-graphql-client";
export {
  createWorkflowSupervisorClient,
  type RestartSupervisedWorkflowInput,
  type StartSupervisedWorkflowInput,
  type StopSupervisedWorkflowInput,
  type SubmitSupervisedWorkflowInput,
  type SupervisedWorkflowLookup,
  type SupervisedWorkflowView,
  type SupervisorEngineOverrides,
  type WorkflowSupervisorClient,
} from "../../divedra/src/workflow/supervisor-client";
export {
  createSupervisorRunnerPool,
  type SupervisorRunnerPool,
  type SupervisorRunnerPoolHandle,
} from "../../divedra/src/workflow/supervisor-runner-pool";
export {
  createSupervisorProgressEventSink,
  createSupervisorProgressRenderer,
  type SupervisorProgressRenderer,
  type SupervisorProgressRendererOptions,
} from "../../divedra/src/workflow/supervisor-progress-renderer";
export { createLifecycleSupervisionPolicyInput } from "../../divedra/src/workflow/auto-improve-policy";
export type { AutoImprovePolicyInput } from "../../divedra/src/workflow/auto-improve-policy";
export {
  atomicWriteJsonFile,
  atomicWriteTextFile,
} from "../../divedra/src/shared/fs";
