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

export type WorkflowSelfImproveMode =
  | "report-only"
  | "report-and-auto-improve";

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

export type NodeSessionMode = "new" | "reuse";

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

export interface NodePromptVariant {
  readonly systemPromptTemplate?: string;
  readonly systemPromptTemplateFile?: string;
  readonly promptTemplate?: string;
  readonly promptTemplateFile?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionStartPromptTemplateFile?: string;
}

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
  readonly addon?: unknown;
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

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

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
