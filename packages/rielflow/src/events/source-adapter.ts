import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
} from "../workflow/types";
import type {
  EventArtifactRef,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";
import type { ScheduledEventManager } from "./scheduled-event-manager";
import type { WorkflowTriggerResult } from "./trigger-runner";

export interface EventSourceDispatchOutcome {
  readonly receipts: readonly WorkflowTriggerResult[];
}

export type SequentialListTerminalStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface SequentialListCompletionInput {
  readonly sourceId: string;
  readonly itemId: string;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly signal: AbortSignal;
}

export interface SequentialListTerminalResult {
  readonly status: SequentialListTerminalStatus;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly error?: string;
}

export interface SequentialListCompletionObserver {
  waitForTerminal(
    input: SequentialListCompletionInput,
  ): Promise<SequentialListTerminalResult>;
}

export interface RawExternalEvent {
  readonly sourceId: string;
  readonly source?: EventSourceConfig;
  readonly receivedAt: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawRef?: EventArtifactRef;
  readonly eventDataRoot?: string;
  readonly readOnly?: boolean;
  readonly diagnosticSink?: EventSourceDiagnosticSink;
}

export interface EventSourceCapabilities {
  readonly eventTypes: readonly string[];
  readonly supportsStart: boolean;
  readonly webhook: boolean;
  readonly chatReply?: boolean;
}

export interface EventSourceStartInput {
  readonly source: EventSourceConfig;
  readonly dispatch: (
    event: ExternalEventEnvelope,
    raw?: unknown,
  ) => Promise<EventSourceDispatchOutcome> | Promise<void>;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: typeof fetch;
  readonly diagnosticSink?: EventSourceDiagnosticSink;
  readonly scheduledEventManager?: ScheduledEventManager;
  readonly eventDataRoot?: string;
  readonly readOnly?: boolean;
  readonly sequentialListCompletionObserver?: SequentialListCompletionObserver;
}

export interface EventSourceHandle {
  readonly sourceId: string;
  stop(): Promise<void>;
}

export interface EventSourceDiagnostic {
  readonly sourceId: string;
  readonly httpStatus?: number;
  readonly errorClass: string;
}

export type EventSourceDiagnosticSink = (
  diagnostic: EventSourceDiagnostic,
) => void;

export interface EventSourceChatReplyInput {
  readonly source: EventSourceConfig;
  readonly request: ChatReplyDispatchRequest;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
}

export interface EventSourceAcceptedEventInput {
  readonly source: EventSourceConfig;
  readonly event: ExternalEventEnvelope;
  readonly raw?: unknown;
  readonly eventDataRoot?: string;
  readonly readOnly?: boolean;
  readonly diagnosticSink?: EventSourceDiagnosticSink;
  readonly now: () => Date;
}

export interface EventSourceAdapter {
  readonly kind: string;
  readonly capabilities: EventSourceCapabilities;
  start(input: EventSourceStartInput): Promise<EventSourceHandle>;
  normalize(input: RawExternalEvent): Promise<ExternalEventEnvelope>;
  recordAcceptedEvent?(input: EventSourceAcceptedEventInput): Promise<void>;
  dispatchChatReply?(
    input: EventSourceChatReplyInput,
  ): Promise<ChatReplyDispatchResult>;
}
