export type CliAgentBackend = "codex-agent" | "claude-code-agent";

export type NodeExecutionBackend =
  | CliAgentBackend
  | "official/openai-sdk"
  | "official/anthropic-sdk";

export type NodeKind =
  | "task"
  | "branch-judge"
  | "loop-judge"
  | "root-manager"
  | "subworkflow-manager"
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
  readonly maxLoopIterations: number;
  readonly nodeTimeoutMs: number;
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

export interface WorkflowNodeRepeatPolicy {
  readonly while: string;
  readonly restartAt?: string;
  readonly maxIterations?: number;
}

export interface WorkflowNodeRef {
  readonly id: string;
  readonly nodeFile: string;
  readonly kind?: NodeKind;
  readonly role?: NodeRole;
  readonly control?: NodeControlKind;
  readonly completion?: CompletionRule;
  readonly execution?: WorkflowNodeExecutionPolicy;
  readonly group?: string;
  readonly repeat?: WorkflowNodeRepeatPolicy;
}

export interface WorkflowCallRef {
  readonly id: string;
  readonly workflowId: string;
  readonly callerNodeId: string;
  readonly resultNodeId?: string;
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

export type SubWorkflowInputSourceType =
  | "human-input"
  | "workflow-output"
  | "node-output"
  | "sub-workflow-output";

export interface SubWorkflowInputSource {
  readonly type: SubWorkflowInputSourceType;
  readonly workflowId?: string;
  readonly nodeId?: string;
  readonly subWorkflowId?: string;
  readonly selectionPolicy?: OutputSelectionPolicy;
}

export type SubWorkflowBlockType = "plain" | "branch-block" | "loop-body";

export interface SubWorkflowBlock {
  readonly type: SubWorkflowBlockType;
  readonly loopId?: string;
}

export interface SubWorkflowRef {
  readonly id: string;
  readonly description: string;
  readonly managerNodeId: string;
  readonly inputNodeId: string;
  readonly outputNodeId: string;
  readonly nodeIds: readonly string[];
  readonly inputSources: readonly SubWorkflowInputSource[];
  readonly block?: SubWorkflowBlock;
}

export interface SubWorkflowConversation {
  readonly id: string;
  readonly participants: readonly string[];
  readonly maxTurns: number;
  readonly stopWhen: string;
}

export interface WorkflowJson {
  readonly workflowId: string;
  readonly description: string;
  readonly defaults: WorkflowDefaults;
  readonly prompts?: WorkflowPrompts;
  readonly managerNodeId: string;
  readonly hasManagerNode?: boolean;
  readonly entryNodeId?: string;
  readonly workflowCalls?: readonly WorkflowCallRef[];
  readonly subWorkflows: readonly SubWorkflowRef[];
  readonly subWorkflowConversations?: readonly SubWorkflowConversation[];
  readonly nodes: readonly WorkflowNodeRef[];
  readonly edges: readonly WorkflowEdge[];
  readonly loops?: readonly LoopRule[];
  readonly branching: {
    readonly mode: "fan-out";
  };
}

export interface ArgumentBinding {
  readonly targetPath: string;
  readonly source:
    | "variables"
    | "node-output"
    | "sub-workflow-output"
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

export type NodeType = "agent" | "command" | "container" | "user-action";

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
  readonly dockerfilePath?: string;
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

export interface NodePayload {
  readonly id: string;
  readonly description?: string;
  readonly nodeType?: NodeType;
  readonly model?: string;
  readonly executionBackend?: NodeExecutionBackend;
  readonly sessionPolicy?: NodeSessionPolicy;
  readonly systemPromptTemplate?: string;
  readonly systemPromptTemplateFile?: string;
  readonly promptTemplate?: string;
  readonly promptTemplateFile?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionStartPromptTemplateFile?: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly command?: CommandExecution;
  readonly container?: ContainerExecution;
  readonly durability?: NodeDurability;
  readonly userAction?: UserActionNodeConfig;
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

export interface VisNode {
  readonly id: string;
  readonly order: number;
}

export interface WorkflowVisJson {
  readonly nodes: readonly VisNode[];
  readonly uiMeta?: Readonly<Record<string, unknown>>;
}

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

export interface NormalizedWorkflowBundle {
  readonly workflow: WorkflowJson;
  readonly workflowVis: WorkflowVisJson;
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
  readonly workflowRoot?: string;
  readonly artifactRoot?: string;
  readonly rootDataDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
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
