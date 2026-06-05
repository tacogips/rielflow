import type { ResolvedChatPersonaRouterAddon } from "./chat-persona-router-types";
import type {
  CliAgentBackend,
  NodeSessionPolicy,
  SuperviserControlAddonName,
  WorkflowNodeAddonEnvBinding,
} from "./types";

export interface ChatReplyWorkerConfig {
  readonly textTemplate: string;
  readonly replyAsTemplate?: string;
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

export type GoogleSpeechToTextRecognitionMode = "sync" | "long-running";
export type GoogleSpeechToTextOutputFormat = "json" | "srt" | "vtt";

export interface GoogleSpeechToTextAddonConfig {
  readonly audioPathTemplate?: string;
  readonly gcsUriTemplate?: string;
  readonly languageCodeTemplate: string;
  readonly alternativeLanguageCodes?: readonly string[];
  readonly encoding?: string;
  readonly sampleRateHertz?: number;
  readonly audioChannelCount?: number;
  readonly model?: string;
  readonly useEnhanced?: boolean;
  readonly enableAutomaticPunctuation?: boolean;
  readonly enableWordTimeOffsets?: boolean;
  readonly enableWordConfidence?: boolean;
  readonly profanityFilter?: boolean;
  readonly maxAlternatives?: number;
  readonly recognitionMode?: GoogleSpeechToTextRecognitionMode;
  readonly outputFormats?: readonly GoogleSpeechToTextOutputFormat[];
  readonly outputBaseNameTemplate?: string;
}

export interface AgentWorkerAddonConfig {
  readonly model: string;
  readonly promptTemplate: string;
  readonly systemPromptTemplate?: string;
  readonly sessionStartPromptTemplate?: string;
  readonly sessionPolicy?: NodeSessionPolicy;
  readonly timeoutMs?: number;
}

export interface WorkflowPackageSandboxReviewAddonConfig {
  readonly executionBackend: CliAgentBackend;
  readonly model: string;
  readonly decisionPolicy?: "advisory" | "block-on-high";
  readonly maxEvidenceBytes?: number;
  readonly systemPromptTemplate?: string;
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
    readonly replyAs?: string;
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
  readonly name: "rielflow/chat-reply-worker";
  readonly version: "1";
  readonly config: ChatReplyWorkerConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedXGatewayReadAddon {
  readonly name: "rielflow/x-gateway-read";
  readonly version: "1";
  readonly config: XGatewayReadAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedXGatewayAddon {
  readonly name: "rielflow/x-gateway";
  readonly version: "1";
  readonly config: XGatewayAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedMailGatewayReadAddon {
  readonly name: "rielflow/mail-gateway-read";
  readonly version: "1";
  readonly config: MailGatewayReadAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedMailGatewayAddon {
  readonly name: "rielflow/mail-gateway";
  readonly version: "1";
  readonly config: MailGatewayAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedGitCommitAddon {
  readonly name: "rielflow/git-commit";
  readonly version: "1";
  readonly config: GitCommitAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedGitPushAddon {
  readonly name: "rielflow/git-push";
  readonly version: "1";
  readonly config: GitPushAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedGoogleSpeechToTextAddon {
  readonly name: "rielflow/google-speech-to-text";
  readonly version: "1";
  readonly config: GoogleSpeechToTextAddonConfig;
  readonly env?: Readonly<Record<string, WorkflowNodeAddonEnvBinding>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedCodexWorkerAddon {
  readonly name: "rielflow/codex-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedClaudeCodeWorkerAddon {
  readonly name: "rielflow/claude-code-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedCodexSdkWorkerAddon {
  readonly name: "rielflow/codex-sdk-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedClaudeSdkWorkerAddon {
  readonly name: "rielflow/claude-sdk-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedCursorSdkWorkerAddon {
  readonly name: "rielflow/cursor-sdk-worker";
  readonly version: "1";
  readonly config: AgentWorkerAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export type ResolvedAgentWorkerAddon =
  | ResolvedCodexWorkerAddon
  | ResolvedClaudeCodeWorkerAddon
  | ResolvedCodexSdkWorkerAddon
  | ResolvedClaudeSdkWorkerAddon
  | ResolvedCursorSdkWorkerAddon;

export interface ResolvedWorkflowPackageSandboxReviewAddon {
  readonly name: "rielflow/workflow-package-sandbox-review";
  readonly version: "1";
  readonly config: WorkflowPackageSandboxReviewAddonConfig;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ResolvedSuperviserControlAddon {
  readonly name: SuperviserControlAddonName;
  readonly version: "1";
}

export type ResolvedNodeAddon =
  | ResolvedChatReplyWorkerAddon
  | ResolvedChatPersonaRouterAddon
  | ResolvedXGatewayReadAddon
  | ResolvedXGatewayAddon
  | ResolvedMailGatewayReadAddon
  | ResolvedMailGatewayAddon
  | ResolvedGitCommitAddon
  | ResolvedGitPushAddon
  | ResolvedGoogleSpeechToTextAddon
  | ResolvedAgentWorkerAddon
  | ResolvedWorkflowPackageSandboxReviewAddon
  | ResolvedSuperviserControlAddon;
