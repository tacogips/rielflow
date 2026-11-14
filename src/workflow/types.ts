import type { NodeValidationResult } from "./validate/node-validation-result";

export type CliAgentBackend =
  | "codex-agent"
  | "claude-code-agent"
  | "cursor-cli-agent";

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
  readonly fanoutConcurrency?: number;
  readonly supervision?: WorkflowSupervisionDefaults;
  readonly timeoutPolicy?: WorkflowTimeoutPolicy;
  readonly containerRuntime?: ContainerRuntimeDefaults;
  readonly selfImprove?: WorkflowSelfImproveDefaults;
}

export type WorkflowSelfImproveMode = "report-only" | "report-and-auto-improve";

export interface WorkflowSelfImproveDefaults {
  readonly enabled?: boolean;
  readonly mode?: WorkflowSelfImproveMode;
  readonly defaultLogLimit?: number;
}

export interface WorkflowSelfImprovePolicy {
  readonly enabled: boolean;
  readonly mode: WorkflowSelfImproveMode;
  readonly defaultLogLimit: number;
}

export interface WorkflowSupervisionDefaults {
  readonly superviserWorkflowId?: string;
  readonly monitorIntervalMs?: number;
  readonly stallTimeoutMs?: number;
  readonly maxSupervisedAttempts?: number;
  readonly maxWorkflowPatches?: number;
  readonly workflowMutationMode?: "execution-copy" | "in-place";
  readonly allowTargetedRerun?: boolean;
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
  readonly executablePreflight?: boolean;
}

export interface NodeAddonResolveResult {
  readonly payload?: NodePayload;
  readonly issues?: readonly ValidationIssue[];
  readonly nodeValidationResults?: readonly NodeValidationResult[];
}

export type NodeAddonPayloadResolver = (
  input: NodeAddonResolveInput,
) => NodeAddonResolveResult | undefined;

export type Awaitable<T> = T | Promise<T>;

export interface NodeAddonValidateInput {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly resolvedPayload?: NodePayload;
  readonly path: string;
  readonly executablePreflight: boolean;
}

export type NodeAddonValidateResult =
  | NodeValidationResult
  | readonly NodeValidationResult[];

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
  readonly validate?: (
    input: NodeAddonValidateInput,
  ) => Awaitable<NodeAddonValidateResult>;
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
  /** Present on the authored registry when the node carries loop/output semantics in the graph. */
  readonly kind?: NodeKind;
  readonly repeat?: WorkflowNodeRepeatPolicy;
}

export interface WorkflowStepTransition {
  readonly toStepId: string;
  readonly toWorkflowId?: string;
  /** Parent workflow step to queue after the callee workflow completes (required when `toWorkflowId` is set). */
  readonly resumeStepId?: string;
  readonly label?: string;
  readonly fanout?: WorkflowStepFanout;
}

export type WorkflowFanoutFailurePolicy = "fail-fast" | "collect-all";

export type WorkflowFanoutResultOrder = "input";

export interface WorkflowFanoutWriteOwnership {
  readonly mode: "read-only" | "disjoint-paths" | "isolated-workspace";
  readonly paths?: readonly string[];
  readonly directories?: readonly string[];
}

export interface WorkflowStepFanout {
  readonly groupId: string;
  readonly itemsFrom: string;
  readonly itemVariable?: string;
  readonly concurrency?: number;
  readonly joinStepId: string;
  readonly failurePolicy?: WorkflowFanoutFailurePolicy;
  readonly resultOrder?: WorkflowFanoutResultOrder;
  readonly writeOwnership?: WorkflowFanoutWriteOwnership;
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
  readonly stallTimeoutMs?: number;
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
  readonly stallTimeoutMs?: number;
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

/**
 * Authored `workflow.json.nodes[]` entries use the strict step-addressed registry
 * surface: reusable node identity plus file/add-on binding and registry-local
 * execution metadata only.
 */
export interface AuthoredWorkflowNodeRef extends WorkflowNodeRegistryRef {}

export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  readonly when: string;
  readonly priority?: number;
  readonly fanout?: WorkflowStepFanout;
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
 * Authored `workflow.json` step-addressed surface (`design-workflow-json.md`). Former
 * top-level node or structural authoring aliases are compile-time and validation-time
 * errors; see `REJECTED_AUTHORED_*` exports in `authored-workflow.ts`.
 */
export interface AuthoredWorkflowJson {
  readonly workflowId: string;
  readonly description?: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly managerStepId?: string;
  readonly entryStepId?: string;
  readonly nodes: readonly AuthoredWorkflowNodeRef[];
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
        ...(transition.fanout === undefined
          ? {}
          : { fanout: transition.fanout }),
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
export function resolveWorkflowManagerStepId(workflow: WorkflowJson): string {
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

export interface NodeInputContract {
  readonly description?: string;
  readonly jsonSchema?: JsonObject;
}

export type NodeType =
  | "agent"
  | "command"
  | "container"
  | "sleep"
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

export interface SleepNodeConfig {
  readonly durationMs?: number;
  readonly until?: string;
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

export interface GitCommitAddonConfig {
  readonly commitMessageTemplate: string;
  readonly committedFilesTemplate: string;
  readonly gitPath?: string;
}

export interface GitPushAddonConfig {
  readonly gitPath?: string;
  readonly remoteTemplate?: string;
  readonly branchTemplate?: string;
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
  readonly outputDestinationId?: string;
  readonly outputDestinationIds?: readonly string[];
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
  /**
   * Optional provider-neutral external-output audit payload persisted in
   * `event_reply_dispatches.request_json` alongside transport fields.
   */
  readonly dispatchAuditMetadata?: Readonly<Record<string, unknown>>;
}

/** Context for deterministic business-final external mailbox messages. */
export interface WorkflowExternalOutputContext {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly sourceNodeId: string;
  readonly sourceNodeExecId: string;
  readonly createdAt: string;
}

export interface ChatReplyDispatchResult {
  readonly status: "sent" | "queued";
  readonly provider: string;
  readonly dispatchId?: string;
  readonly providerMessageId?: string;
  readonly destinationResults?: readonly ChatReplyDestinationDispatchResult[];
}

export interface ChatReplyDestinationDispatchResult {
  readonly destinationId?: string;
  readonly sourceId: string;
  readonly idempotencyKey: string;
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

export interface ResolvedGitCommitAddon {
  readonly name: "divedra/git-commit";
  readonly version: "1";
  readonly config: GitCommitAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedGitPushAddon {
  readonly name: "divedra/git-push";
  readonly version: "1";
  readonly config: GitPushAddonConfig;
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
  | ResolvedGitCommitAddon
  | ResolvedGitPushAddon
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
  readonly sleep?: SleepNodeConfig;
  readonly userAction?: UserActionNodeConfig;
  readonly addon?: ResolvedNodeAddon;
  readonly argumentsTemplate?: Readonly<Record<string, unknown>>;
  readonly argumentBindings?: readonly ArgumentBinding[];
  readonly templateEngine?: string;
  readonly timeoutMs?: number;
  readonly stallTimeoutMs?: number;
  readonly input?: NodeInputContract;
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

export interface WorkflowNodePatch {
  readonly executionBackend?: NodeExecutionBackend;
  readonly model?: string;
  readonly effort?: string;
}

export type WorkflowNodePatchMap = Readonly<Record<string, WorkflowNodePatch>>;

export interface NormalizedWorkflowBundle {
  readonly workflow: WorkflowJson;
  readonly nodePayloads: Readonly<Record<string, NodePayload>>;
}

/**
 * Resolve a normalized bundle payload by runtime execution id. The primary key is the
 * normalized runtime node id (`workflow.nodes[].id`, which is the step id for current
 * step-addressed workflows), with a defensive fallback to `nodeFile` for callers that
 * receive a partially remapped payload dictionary.
 */
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
  readonly executablePreflight?: boolean;
  readonly nodePatch?: WorkflowNodePatchMap;
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
export const DEFAULT_NODE_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_CONTAINER_RUNNER_KIND: ContainerRunnerKind = "docker";
export const DEFAULT_WORKFLOW_ROOT = "./.divedra";

/** Subdirectories inside the root data directory (`DIVEDRA_ARTIFACT_DIR` / computed default). */
export const ROOT_DATA_WORKFLOW_SUBDIR = "workflow";
export const ROOT_DATA_SESSIONS_SUBDIR = "sessions";
export const ROOT_DATA_FILES_SUBDIR = "files";

export const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type {
  AutoImprovePolicy,
  GetWorkflowExecutionDetailsAddonInput,
  GetWorkflowExecutionDetailsControlArguments,
  GetWorkflowExecutionDetailsOutput,
  GetWorkflowStatusAddonInput,
  GetWorkflowStatusControlArguments,
  GetWorkflowStatusOutput,
  LoadWorkflowDefinitionAddonInput,
  LoadWorkflowDefinitionControlArguments,
  LoadWorkflowDefinitionOutput,
  MutableWorkflowWorkspace,
  RerunTargetWorkflowOutput,
  RerunWorkflowAddonInput,
  RerunWorkflowControlArguments,
  SaveWorkflowDefinitionAddonInput,
  SaveWorkflowDefinitionControlArguments,
  SaveWorkflowDefinitionOutput,
  StartTargetWorkflowControlArguments,
  StartTargetWorkflowOutput,
  StartWorkflowAddonInput,
  SupervisionIncident,
  SupervisionRemediationAction,
  SupervisionRemediationRecord,
  SupervisionRunState,
  SupervisionRunStatus,
  SupervisionStallWatch,
  SupervisionSummary,
  SuperviserControlAuth,
  WorkflowPatchRevisionInput,
  WorkflowPatchRevisionRecord,
} from "./types-supervision";
