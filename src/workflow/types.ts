export type CliAgentBackend = "codex-agent" | "claude-code-agent";

export type NodeExecutionBackend =
  | CliAgentBackend
  | "official/openai-sdk"
  | "official/anthropic-sdk";

export type NodeKind =
  | "task"
  | "branch-judge"
  | "loop-judge"
  | "input"
  | "output";

export type NodeRole = "manager" | "worker";

export type NodeControlKind = "none" | "branch-judge" | "loop-judge";

export type CompletionType =
  | "checklist"
  | "score-threshold"
  | "validator-result"
  | "none";

export interface CompletionRule {
  readonly type: CompletionType;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface WorkflowDefaults {
  readonly nodeTimeoutMs: number;
  readonly maxLoopIterations: number;
  readonly timeoutPolicy?: WorkflowTimeoutPolicy;
  readonly containerRuntime?: ContainerRuntimeDefaults;
}

export interface WorkflowPrompts {
  readonly divedraPromptTemplate?: string;
  readonly workerSystemPromptTemplate?: string;
}

export interface WorkflowNodeExecutionPolicy {
  readonly mode?: "required" | "optional";
  readonly decisionBy?: "owning-manager";
}

export interface WorkflowNodeAddonEnvBinding {
  readonly fromEnv: string;
  readonly required?: boolean;
}

export interface WorkflowNodeAddonRef {
  readonly name: string;
  readonly version?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface WorkflowTimeoutPolicy {
  readonly onTimeout: "fail" | "retry-same-step" | "jump-to-step";
  readonly maxRetries?: number;
  readonly retryTimeoutIncrementMs?: number;
  readonly jumpStepId?: string;
  readonly reuseBackendSession?: boolean;
}

export interface NodeAddonResolveInput {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}

export interface NodeAddonResolveResult {
  readonly payload?: NodePayload;
  readonly issues?: readonly ValidationIssue[];
}

export type NodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => NodeAddonResolveResult | undefined;

export type Awaitable<T> = T | Promise<T>;

export type AsyncNodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => Awaitable<NodeAddonResolveResult | undefined>;

export type NodeAddonDefinitionResolver = (
  input: NodeAddonResolveInput,
) => Awaitable<NodeAddonResolveResult>;

export interface NodeAddonDefinition {
  readonly name: string;
  readonly version?: string;
  readonly resolve: NodeAddonDefinitionResolver;
}

export interface WorkflowNodeRepeatPolicy {
  readonly while: string;
  readonly restartAt?: string;
  readonly maxIterations?: number;
}

export interface WorkflowNodeRegistryRef {
  readonly id: string;
  readonly nodeFile?: string;
  readonly addon?: WorkflowNodeAddonRef;
  readonly execution?: WorkflowNodeExecutionPolicy;
}

export interface WorkflowStepTransition {
  readonly toStepId: string;
  readonly toWorkflowId?: string;
  /** Parent workflow step to queue after the callee workflow completes (required when `toWorkflowId` is set). */
  readonly resumeStepId?: string;
  readonly label?: string;
}

export interface WorkflowStepSessionPolicy {
  readonly mode?: NodeSessionMode;
  readonly inheritFromStepId?: string;
}

export interface WorkflowStepRef {
  readonly id: string;
  readonly stepFile?: string;
  readonly nodeId: string;
  readonly description?: string;
  readonly role?: NodeRole;
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly sessionPolicy?: WorkflowStepSessionPolicy;
  readonly transitions?: readonly WorkflowStepTransition[];
}

export interface AuthoredWorkflowStepRef {
  readonly id: string;
  readonly stepFile?: string;
  readonly nodeId?: string;
  readonly description?: string;
  readonly role?: NodeRole;
  readonly promptVariant?: string;
  readonly timeoutMs?: number;
  readonly sessionPolicy?: WorkflowStepSessionPolicy;
  readonly transitions?: readonly WorkflowStepTransition[];
}

export interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly addon?: WorkflowNodeAddonRef;
  readonly kind?: NodeKind;
  readonly role?: NodeRole;
  readonly control?: NodeControlKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
  readonly group?: string;
  readonly repeat?: WorkflowNodeRepeatPolicy;
}

export interface AuthoredWorkflowNodeRef {
  readonly id: string;
  readonly nodeFile?: string;
  readonly addon?: WorkflowNodeAddonRef;
  readonly node?: unknown;
  readonly kind?: NodeKind;
  readonly role?: NodeRole;
  readonly control?: NodeControlKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
  readonly group?: string;
  readonly repeat?: WorkflowNodeRepeatPolicy;
}

export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  readonly when: string;
  readonly priority?: number;
}

export interface LoopRule {
  readonly id: string;
  readonly judgeNodeId: string;
  readonly maxIterations?: number;
  readonly continueWhen: string;
  readonly exitWhen: string;
  readonly backoffMs?: number;
}

export type OutputSelectionMode =
  | "explicit"
  | "latest-succeeded"
  | "latest-any"
  | "by-loop-iteration";

export interface OutputSelectionPolicy {
  readonly mode: OutputSelectionMode;
  readonly nodeExecId?: string;
  readonly loopIteration?: number;
}

/**
 * Authored `workflow.json` step-addressed surface (`design-workflow-json.md`). Legacy
 * top-level node/structural aliases are compile-time and validation-time errors; see
 * `REJECTED_AUTHORED_*` exports in `validate.ts` (not session/runtime `managerRuntimeId`).
 */
export interface AuthoredWorkflowJson {
  readonly workflowId: string;
  readonly description?: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly managerStepId?: string;
  readonly entryStepId?: string;
  readonly nodes: readonly (
    | AuthoredWorkflowNodeRef
    | WorkflowNodeRegistryRef
  )[];
  readonly steps?: readonly AuthoredWorkflowStepRef[];
}

/**
 * Normalized workflow from validation/load: step-addressed workflow definition plus the runtime
 * node list synthesized from those steps for execution, inspection, and prompt composition.
 */
export interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly hasManagerNode?: boolean;
  readonly managerStepId?: string;
  readonly entryStepId: string;
  readonly nodeRegistry: readonly WorkflowNodeRegistryRef[];
  readonly steps: readonly WorkflowStepRef[];
  readonly nodes: readonly WorkflowNodeRef[];
}

export function isStepAddressedWorkflow(
  workflow: Pick<WorkflowJson, "entryStepId" | "steps">,
): workflow is Pick<WorkflowJson, "entryStepId" | "steps"> & {
  readonly entryStepId: string;
  readonly steps: readonly WorkflowStepRef[];
} {
  void workflow;
  return true;
}

function buildRepeatExitExpression(whileExpression: string): string {
  return `!(${whileExpression})`;
}

function buildRepeatLoops(
  nodes: readonly Pick<WorkflowNodeRef, "id" | "repeat">[],
): readonly LoopRule[] {
  return nodes.flatMap((node) =>
    node.repeat === undefined
      ? []
      : [
          {
            id: `repeat-${node.id}`,
            judgeNodeId: node.id,
            continueWhen: node.repeat.while,
            exitWhen: buildRepeatExitExpression(node.repeat.while),
            ...(node.repeat.maxIterations === undefined
              ? {}
              : { maxIterations: node.repeat.maxIterations }),
          } satisfies LoopRule,
        ],
  );
}

/**
 * Loop rules are derived from node-local `repeat` policies on the synthesized runtime node list.
 */
export function getStructuralLoops(
  workflow: Pick<WorkflowJson, "nodes">,
): readonly LoopRule[] {
  const derivedRepeatLoops = buildRepeatLoops(workflow.nodes);
  return derivedRepeatLoops;
}

/**
 * Step-addressed workflows derive local routing edges from `steps[].transitions`.
 */
export function getStructuralEdges(
  workflow: Pick<WorkflowJson, "steps">,
): readonly WorkflowEdge[] {
  return workflow.steps.flatMap((step) =>
    (step.transitions ?? [])
      .filter((transition) => transition.toWorkflowId === undefined)
      .map((transition) => ({
        from: step.id,
        to: transition.toStepId,
        when: transition.label ?? "always",
      })),
  );
}

/**
 * Primary entry **runtime** id for new-session bootstrap and UI/runtime previews.
 */
export function resolveWorkflowEntryRuntimeId(workflow: WorkflowJson): string {
  return workflow.entryStepId;
}

/**
 * Primary manager/entry **runtime** id for engine routing, mailbox handoff, and new-session
 * bootstrap. Returns `managerStepId ?? entryStepId` in the same step-id space as `session.queue`.
 */
export function resolveWorkflowManagerRuntimeId(
  workflow: WorkflowJson,
): string {
  return workflow.managerStepId ?? workflow.entryStepId;
}

export interface ArgumentBinding {
  readonly targetPath: string;
  readonly source:
    | "variables"
    | "node-output"
    | "workflow-output"
    | "human-input"
    | "conversation-transcript";
  readonly sourceRef?: Readonly<Record<string, unknown>> | string;
  readonly sourcePath?: string;
  readonly required?: boolean;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface NodeOutputContract {
  readonly description?: string;
  readonly jsonSchema?: JsonObject;
  readonly maxValidationAttempts?: number;
}

export type NodeType =
  | "agent"
  | "command"
  | "container"
  | "user-action"
  | "addon";

export type NodeSessionMode = "new" | "reuse";

export interface NodeSessionPolicy {
  readonly mode: NodeSessionMode;
}

export type ContainerRunnerKind =
  | "podman"
  | "docker"
  | "nerdctl"
  | "apple-container";

export interface ContainerRuntimeDefaults {
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
}

export interface CommandExecution {
  readonly scriptPath: string;
  readonly argvTemplate?: readonly string[];
  readonly envTemplate?: Readonly<Record<string, string>>;
  readonly workingDirectory?: string;
}

export interface ContainerBuild {
  readonly contextPath: string;
  readonly containerfilePath?: string;
  readonly target?: string;
}

export interface ContainerWorkspace {
  readonly mode?: "none" | "ephemeral";
  readonly mountPath?: string;
}

export interface ContainerResources {
  readonly cpuMax?: number;
  readonly memoryMaxMb?: number;
  readonly pidsMax?: number;
}

export interface ContainerExecution {
  readonly runnerKind?: ContainerRunnerKind;
  readonly runnerPath?: string;
  readonly image?: string;
  readonly build?: ContainerBuild;
  readonly entrypoint?: readonly string[];
  readonly argsTemplate?: readonly string[];
  readonly envTemplate?: Readonly<Record<string, string>>;
  readonly workingDirectory?: string;
  readonly workspace?: ContainerWorkspace;
  readonly resources?: ContainerResources;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

export interface NodeDurability {
  readonly mode: "disabled" | "node-persistent";
  readonly mountPath?: string;
}

export interface UserActionNodeConfig {
  readonly messageToolIds: readonly string[];
  readonly notificationToolIds?: readonly string[];
  readonly replyPolicy?: "first-valid-reply-wins";
  readonly allowStructuredReply?: boolean;
  readonly allowFreeTextReply?: boolean;
}

export interface ChatReplyWorkerConfig {
  readonly textTemplate: string;
  readonly visibility?: "public" | "ephemeral";
  readonly threadPolicy?: "same-thread" | "conversation-root";
  readonly onMissingTarget?: "fail" | "intent-only" | "dry-run";
}

export interface XGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

export interface XGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

export interface MailGatewayReadAddonConfig {
  readonly queryTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

export interface MailGatewayAddonConfig {
  readonly documentTemplate: string;
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

export interface AgentWorkerAddonConfig {
  readonly model: string;
  readonly promptTemplate: string;
  readonly systemPromptTemplate?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionPolicy?: NodeSessionPolicy;
  readonly timeoutMs?: number;
}

export interface ChatReplyDispatchTarget {
  readonly sourceId: string;
  readonly provider: string;
  readonly eventId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly actorId?: string;
}

export interface ChatReplyDispatchRequest {
  readonly target: ChatReplyDispatchTarget;
  readonly message: {
    readonly text: string;
  };
  readonly visibility: "public" | "ephemeral";
  readonly threadPolicy: "same-thread" | "conversation-root";
  readonly idempotencyKey: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
}

export interface ChatReplyDispatchResult {
  readonly status: "sent" | "queued";
  readonly provider: string;
  readonly dispatchId?: string;
  readonly providerMessageId?: string;
}

export interface ChatReplyDispatcher {
  dispatchChatReply(
    request: ChatReplyDispatchRequest,
  ): Promise<ChatReplyDispatchResult>;
}

export interface ResolvedChatReplyWorkerAddon {
  readonly name: "divedra/chat-reply-worker";
  readonly version: "1";
  readonly config: ChatReplyWorkerConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedXGatewayReadAddon {
  readonly name: "divedra/x-gateway-read";
  readonly version: "1";
  readonly config: XGatewayReadAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedXGatewayAddon {
  readonly name: "divedra/x-gateway";
  readonly version: "1";
  readonly config: XGatewayAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedMailGatewayReadAddon {
  readonly name: "divedra/mail-gateway-read";
  readonly version: "1";
  readonly config: MailGatewayReadAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedMailGatewayAddon {
  readonly name: "divedra/mail-gateway";
  readonly version: "1";
  readonly config: MailGatewayAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedCodexWorkerAddon {
  readonly name: "divedra/codex-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedClaudeCodeWorkerAddon {
  readonly name: "divedra/claude-code-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export type ResolvedAgentWorkerAddon =
  | ResolvedCodexWorkerAddon
  | ResolvedClaudeCodeWorkerAddon;

/**
 * Phase-2 nested superviser control-plane add-ons. Invoked as `nodeType: "addon"`
 * and executed natively when a {@link import("./superviser-control").SuperviserRuntimeControl}
 * handle is present on the execution input (nested superviser session).
 */
export const SUPERVISER_CONTROL_ADDON_NAMES = [
  "divedra/start-workflow",
  "divedra/get-workflow-status",
  "divedra/get-workflow-execution-details",
  "divedra/rerun-workflow",
  "divedra/load-workflow-definition",
  "divedra/save-workflow-definition",
] as const;

export type SuperviserControlAddonName =
  (typeof SUPERVISER_CONTROL_ADDON_NAMES)[number];

const SUPERVISER_CONTROL_ADDON_METADATA = {
  "divedra/start-workflow": {
    description:
      "Start the supervised target workflow (nested superviser control; phase-2).",
    providerOperationId: "start-workflow",
  },
  "divedra/get-workflow-status": {
    description:
      "Read high-level target workflow session status (nested superviser control; phase-2).",
    providerOperationId: "get-workflow-status",
  },
  "divedra/get-workflow-execution-details": {
    description:
      "Read extended target session details (nested superviser control; phase-2).",
    providerOperationId: "get-workflow-execution-details",
  },
  "divedra/rerun-workflow": {
    description:
      "Rerun the target workflow (nested superviser control; phase-2).",
    providerOperationId: "rerun-workflow",
  },
  "divedra/load-workflow-definition": {
    description:
      "Load the mutable target workflow definition bundle (nested superviser control; phase-2).",
    providerOperationId: "load-workflow-definition",
  },
  "divedra/save-workflow-definition": {
    description:
      "Write an updated target workflow definition revision (nested superviser control; phase-2).",
    providerOperationId: "save-workflow-definition",
  },
} as const satisfies Record<
  SuperviserControlAddonName,
  {
    readonly description: string;
    readonly providerOperationId: string;
  }
>;

const SUPERVISER_CONTROL_ADDON_NAME_SET: ReadonlySet<string> = new Set(
  SUPERVISER_CONTROL_ADDON_NAMES,
);

export function isSuperviserControlAddonName(
  name: string,
): name is SuperviserControlAddonName {
  return SUPERVISER_CONTROL_ADDON_NAME_SET.has(name);
}

export function describeSuperviserControlAddon(
  name: SuperviserControlAddonName,
): string {
  return SUPERVISER_CONTROL_ADDON_METADATA[name].description;
}

export function getSuperviserControlAddonProviderOperationId(
  name: SuperviserControlAddonName,
): string {
  return SUPERVISER_CONTROL_ADDON_METADATA[name].providerOperationId;
}

export interface ResolvedSuperviserControlAddon {
  readonly name: SuperviserControlAddonName;
  readonly version: "1";
}

export type ResolvedNodeAddon =
  | ResolvedChatReplyWorkerAddon
  | ResolvedXGatewayReadAddon
  | ResolvedXGatewayAddon
  | ResolvedMailGatewayReadAddon
  | ResolvedMailGatewayAddon
  | ResolvedAgentWorkerAddon
  | ResolvedSuperviserControlAddon;

export interface NodePayload {
  readonly id: string;
  readonly description?: string;
  readonly nodeType?: NodeType;
  readonly managerType?: "code" | "llm";
  readonly workingDirectory?: string;
  readonly model?: string;
  readonly executionBackend?: NodeExecutionBackend;
  readonly sessionPolicy?: NodeSessionPolicy;
  readonly systemPromptTemplate?: string;
  readonly systemPromptTemplateFile?: string;
  readonly promptTemplate?: string;
  readonly promptTemplateFile?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionStartPromptTemplateFile?: string;
  readonly promptVariants?: Readonly<Record<string, NodePromptVariant>>;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly command?: CommandExecution;
  readonly container?: ContainerExecution;
  readonly durability?: NodeDurability;
  readonly userAction?: UserActionNodeConfig;
  readonly addon?: ResolvedNodeAddon;
  readonly argumentsTemplate?: Readonly<Record<string, unknown>>;
  readonly argumentBindings?: readonly ArgumentBinding[];
  readonly templateEngine?: string;
  readonly timeoutMs?: number;
  readonly output?: NodeOutputContract;
}

export interface AgentNodePayload extends NodePayload {
  readonly nodeType?: "agent";
  readonly model: string;
  readonly promptTemplate: string;
}

export interface NodePromptVariant {
  readonly systemPromptTemplate?: string;
  readonly systemPromptTemplateFile?: string;
  readonly promptTemplate?: string;
  readonly promptTemplateFile?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionStartPromptTemplateFile?: string;
}

export function asAgentNodePayload(node: NodePayload): AgentNodePayload | null {
  if ((node.nodeType ?? "agent") !== "agent") {
    return null;
  }
  if (
    typeof node.model !== "string" ||
    node.model.length === 0 ||
    typeof node.promptTemplate !== "string"
  ) {
    return null;
  }
  return node as AgentNodePayload;
}

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

export interface NormalizedWorkflowBundle {
  readonly workflow: WorkflowJson;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}

export function getNormalizedNodePayload(
  bundle: Pick<NormalizedWorkflowBundle, "workflow" | "nodePayloads">,
  nodeId: string,
): NodePayload | undefined {
  const payload = bundle.nodePayloads[nodeId];
  if (payload !== undefined) {
    return payload;
  }

  const nodeFile = bundle.workflow.nodes.find(
    (entry) => entry.id === nodeId,
  )?.nodeFile;
  return nodeFile === undefined ? undefined : bundle.nodePayloads[nodeFile];
}

export interface LoadOptions {
  /**
   * When set, load and save the workflow bundle from this directory instead of
   * `${workflowRoot}/<name>`. Used for execution-copy supervision workspaces.
   */
  readonly workflowBundleDirectoryOverride?: string;
  readonly workflowRoot?: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly userRoot?: string;
  readonly projectRoot?: string;
  readonly addonRoot?: string;
  readonly resolvedWorkflowSource?: ResolvedWorkflowSource;
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly sessionStoreRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly nodeAddons?: readonly NodeAddonDefinition[];
  readonly asyncNodeAddonResolvers?: readonly AsyncNodeAddonPayloadResolver[];
  readonly nodeAddonResolvers?: readonly NodeAddonPayloadResolver[];
}

export type WorkflowScopeSelector = "auto" | "project" | "user";
export type WorkflowSourceScope = "direct" | "project" | "user";
export type AddonSourceScope = "direct" | "project" | "user";

export interface ResolvedWorkflowSource {
  readonly scope: WorkflowSourceScope;
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
  readonly legacyProjectRoot?: boolean;
}

export interface ResolvedAddonSource {
  readonly scope: AddonSourceScope;
  readonly addonRoot: string;
  readonly addonName: string;
  readonly version: string;
  readonly addonDirectory: string;
  readonly manifestPath: string;
  readonly scopeRoot?: string;
}

export interface EffectiveRoots {
  readonly workflowRoot: string;
  readonly artifactRoot: string;
  readonly rootDataDir: string;
  readonly attachmentRoot: string;
}

export const DEFAULT_MAX_LOOP_ITERATIONS = 3;
export const DEFAULT_NODE_TIMEOUT_MS = 120000;
export const DEFAULT_CONTAINER_RUNNER_KIND: ContainerRunnerKind = "podman";
export const DEFAULT_WORKFLOW_ROOT = "./.divedra";

/** Subdirectories inside the root data directory (`DIVEDRA_ARTIFACT_DIR` / computed default). */
export const ROOT_DATA_WORKFLOW_SUBDIR = "workflow";
export const ROOT_DATA_SESSIONS_SUBDIR = "sessions";
export const ROOT_DATA_FILES_SUBDIR = "files";

export const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

// --- auto-improve / superviser mode (design-auto-improve-superviser-mode) ---

/**
 * Input policy for supervised `--auto-improve` runs. Persisted on the session when active.
 */
export interface AutoImprovePolicy {
  readonly enabled: true;
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly maxSupervisedAttempts: number;
  readonly maxWorkflowPatches: number;
  readonly workflowMutationMode: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
}

/**
 * Polls the runtime session snapshot row (`sessions.updated_at` from
 * `saveSessionSnapshotToRuntimeDb`) while a step executes; on stale snapshots,
 * the adapter or native step execution is aborted (design: persisted timestamps).
 */
export interface SupervisionStallWatch {
  readonly sessionId: string;
  readonly monitorIntervalMs: number;
  readonly stallTimeoutMs: number;
  readonly loadOptions: LoadOptions;
}

export interface SupervisionIncident {
  readonly incidentId: string;
  readonly supervisedAttemptId: string;
  readonly category: "failure" | "stall" | "budget-exhausted";
  readonly summary: string;
  readonly detectedAt: string;
}

/** Normalized remediation choice recorded after an incident (impl-plan superviser module). */
export type SupervisionRemediationAction =
  | "rerun-workflow"
  | "rerun-step"
  | "patch-workflow"
  | "stop-supervision";

export interface SupervisionRemediationRecord {
  readonly remediationId: string;
  readonly incidentId: string;
  readonly decidedAt: string;
  readonly action: SupervisionRemediationAction;
  readonly targetStepId?: string;
  readonly reason: string;
}

export type SupervisionRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "stopped";

/**
 * Durable supervision cycle state stored on the workflow session record when auto-improve is active.
 * Policy and remediation history are required for resume-safe supervision (design-auto-improve-superviser-mode).
 */
export interface SupervisionRunState {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly status: SupervisionRunStatus;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  /** Active policy for this cycle; omitted in older persisted sessions until backfilled. */
  readonly policy?: AutoImprovePolicy;
  /**
   * When phase-2 nested superviser execution is active, the session id of the
   * superviser workflow run that owns this supervision cycle.
   */
  readonly nestedSuperviserSessionId?: string;
  /**
   * Absolute path to the workflow bundle directory (canonical source for in-place, or
   * execution-scoped copy under the artifact root). Used to resume loads after restart.
   */
  readonly mutableWorkflowDir?: string;
  readonly incidents: readonly SupervisionIncident[];
  /** Remediation decisions applied during this cycle, newest last. */
  readonly remediations?: readonly SupervisionRemediationRecord[];
}

/**
 * Library/GraphQL-friendly snapshot derived from {@link SupervisionRunState}.
 */
export interface SupervisionSummary {
  readonly supervisionRunId: string;
  readonly targetWorkflowId: string;
  readonly superviserWorkflowId: string;
  readonly status: SupervisionRunStatus;
  readonly attemptCount: number;
  readonly workflowPatchCount: number;
  readonly latestIncidentId?: string;
  readonly latestRemediationId?: string;
  readonly mutableWorkflowDir?: string;
  readonly nestedSuperviserSessionId?: string;
}

/**
 * Shared request fields for nested-superviser control add-on `arguments` (phase 2).
 * The runtime issues a {@link SuperviserControlAuth} when launching the nested superviser;
 * each control call must repeat it so the engine can scope operations to the active cycle.
 */
export interface SuperviserControlAuth {
  readonly supervisionRunId: string;
  readonly targetSessionId: string;
}

export interface StartWorkflowAddonInput {
  readonly workflowId: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly autoImprove?: AutoImprovePolicy;
}

export interface GetWorkflowStatusAddonInput {
  readonly sessionId: string;
}

export interface GetWorkflowExecutionDetailsAddonInput {
  readonly sessionId: string;
}

export interface RerunWorkflowAddonInput {
  readonly sessionId: string;
  /**
   * When omitted, nested `SuperviserRuntimeControl` resolves a step id from the
   * target session and workflow (current step, else manager/entry anchor) so
   * `runWorkflow` receives `rerunFromStepId` with `rerunFromSessionId`.
   */
  readonly rerunFromStepId?: string;
}

export interface LoadWorkflowDefinitionAddonInput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
}

export interface SaveWorkflowDefinitionAddonInput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
  /**
   * `workflow` + `nodePayloads` bundle to write via {@link import("./save").saveWorkflowToDisk}.
   */
  readonly bundle: {
    readonly workflow: Readonly<Record<string, unknown>>;
    readonly nodePayloads: Readonly<Record<string, unknown>>;
  };
}

export interface StartTargetWorkflowOutput {
  readonly sessionId: string;
  /** Mirrors {@link import("./session").SessionStatus} (string union, keeps types acyclic). */
  readonly status: string;
}

export interface GetWorkflowStatusOutput {
  readonly sessionId: string;
  readonly status: string;
  readonly workflowId: string;
  readonly currentNodeId?: string;
  readonly lastError?: string;
}

export interface GetWorkflowExecutionDetailsOutput {
  readonly session: Readonly<Record<string, unknown>>;
}

export interface RerunTargetWorkflowOutput {
  readonly sessionId: string;
  readonly status: string;
}

export interface LoadWorkflowDefinitionOutput {
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
  /**
   * Normalized `workflow.json` object plus any node payload records the load path produced.
   * Shape follows `loadWorkflowFromDisk` bundle view used by the runtime.
   */
  readonly bundle: Readonly<Record<string, unknown>>;
}

export interface SaveWorkflowDefinitionOutput {
  readonly saved: true;
  readonly workflowId: string;
  readonly mutableWorkflowDir: string;
}

/**
 * Add-on `arguments` must include {@link SuperviserControlAuth} fields plus
 * the fields for the selected operation; see `superviser-control.ts` parsing helpers.
 */
export type StartTargetWorkflowControlArguments = SuperviserControlAuth &
  StartWorkflowAddonInput;
export type GetWorkflowStatusControlArguments = SuperviserControlAuth &
  GetWorkflowStatusAddonInput;
export type GetWorkflowExecutionDetailsControlArguments =
  SuperviserControlAuth & GetWorkflowExecutionDetailsAddonInput;
export type RerunWorkflowControlArguments = SuperviserControlAuth &
  RerunWorkflowAddonInput;
export type LoadWorkflowDefinitionControlArguments = SuperviserControlAuth &
  LoadWorkflowDefinitionAddonInput;
export type SaveWorkflowDefinitionControlArguments = SuperviserControlAuth &
  SaveWorkflowDefinitionAddonInput;

/**
 * Locates a workflow bundle the superviser may mutate. For `execution-copy`, files live under
 * the artifact root; `in-place` reuses the canonical source directory (design-auto-improve-superviser-mode).
 */
export interface MutableWorkflowWorkspace {
  readonly workflowId: string;
  readonly sourceWorkflowDir: string;
  readonly mutableWorkflowDir: string;
  readonly mutationMode: "execution-copy" | "in-place";
}

/**
 * Provenance for a superviser-driven workflow definition patch (impl-plan: revision tracking).
 */
export interface WorkflowPatchRevisionInput {
  readonly supervisionRunId: string;
  readonly mutableWorkflowDir: string;
  readonly reason: string;
  readonly patchedByStepId: string;
}

/**
 * A recorded patch revision stored under
 * `<artifactRoot>/supervision/<supervisionRunId>/patch-revisions.json`.
 */
export interface WorkflowPatchRevisionRecord {
  readonly patchRevisionId: string;
  readonly recordedAt: string;
  readonly reason: string;
  readonly patchedByStepId: string;
  readonly mutableWorkflowDir: string;
}
