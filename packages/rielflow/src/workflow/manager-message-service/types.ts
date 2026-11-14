import type { CommunicationService } from "../communication-service";
import type {
  ManagerIntentSummary,
  ManagerSessionStore,
} from "../manager-session-store";
import type { ManagerControlAction } from "../manager-control";
import type { SessionStoreOptions } from "../session-store";
import type { ManagerMessagePayloadRef } from "../session";

export interface DataDirFileRef {
  readonly path: string;
  readonly mediaType?: string;
}

export interface SendManagerMessageInput {
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly managerSessionId: string;
  readonly message?: string;
  readonly actions?: readonly ManagerControlAction[];
  readonly attachments?: readonly DataDirFileRef[];
  readonly idempotencyKey?: string;
}

export interface SendManagerMessageResult {
  readonly accepted: boolean;
  readonly managerMessageId: string;
  readonly parsedIntent: readonly ManagerIntentSummary[];
  readonly createdCommunicationIds: readonly string[];
  readonly queuedNodeIds: readonly string[];
  readonly rejectionReason?: string;
}

export interface ManagerMessageServiceDependencies {
  readonly now?: () => string;
  readonly managerSessionStore?: ManagerSessionStore;
  readonly communicationService?: CommunicationService;
}

export interface ManagerMessageService {
  sendManagerMessage(
    input: SendManagerMessageInput,
    options?: SessionStoreOptions,
  ): Promise<SendManagerMessageResult>;
}

export interface PersistedManagerMessageArtifacts {
  readonly artifactDir: string;
  readonly outputRaw: string;
  readonly payloadRef: ManagerMessagePayloadRef;
}
