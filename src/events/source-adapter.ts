import type {
  ChatReplyDispatchRequest,
  ChatReplyDispatchResult,
} from "../workflow/types";
import type {
  EventArtifactRef,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

export interface RawExternalEvent {
  readonly sourceId: string;
  readonly receivedAt: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawRef?: EventArtifactRef;
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
  ) => Promise<void>;
  readonly signal: AbortSignal;
  readonly now: () => Date;
}

export interface EventSourceHandle {
  readonly sourceId: string;
  stop(): Promise<void>;
}

export interface EventSourceChatReplyInput {
  readonly source: EventSourceConfig;
  readonly request: ChatReplyDispatchRequest;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl: typeof fetch;
}

export interface EventSourceAdapter {
  readonly kind: string;
  readonly capabilities: EventSourceCapabilities;
  start(input: EventSourceStartInput): Promise<EventSourceHandle>;
  normalize(input: RawExternalEvent): Promise<ExternalEventEnvelope>;
  dispatchChatReply?(
    input: EventSourceChatReplyInput,
  ): Promise<ChatReplyDispatchResult>;
}
