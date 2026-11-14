import type {
  ChatReplyDispatcher,
  LoadOptions,
  WorkflowSupervisorDispatchClient,
} from "rielflow-core";
import type {
  EventBinding,
  EventReceiptRecord,
  EventReceiptStatus,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";

export interface EventReceiptBeginResult {
  readonly record: EventReceiptRecord;
  readonly artifactDir: string;
  readonly duplicateOf?: string;
}

export interface EventReceiptBeginInput {
  readonly event: ExternalEventEnvelope;
  readonly binding?: EventBinding;
  readonly raw?: unknown;
  readonly status?: EventReceiptStatus;
}

export interface EventReceiptUpdateInput {
  readonly record: EventReceiptRecord;
  readonly artifactDir?: string;
  readonly status: EventReceiptStatus;
  readonly workflowExecutionId?: string;
  readonly supervisedRunId?: string;
  readonly supervisorExecutionId?: string;
  readonly supervisorConversationId?: string;
  readonly supervisorDecisionId?: string;
  readonly inputPayload?: unknown;
  readonly dispatchPayload?: unknown;
  readonly error?: string;
}

export interface EventReceiptStore {
  begin(
    input: EventReceiptBeginInput,
    options?: LoadOptions,
  ): Promise<EventReceiptBeginResult>;
  update(
    input: EventReceiptUpdateInput,
    options?: LoadOptions,
  ): Promise<EventReceiptRecord>;
}

export interface WorkflowTriggerExecutionResult {
  readonly workflowName: string;
  readonly workflowExecutionId: string;
  readonly sessionId?: string;
  readonly status: string;
  readonly accepted?: boolean;
  readonly exitCode?: number;
}

export interface WorkflowTriggerExecuteInput {
  readonly workflowName: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
  readonly async?: boolean;
}

export interface WorkflowTriggerResumeInput {
  readonly workflowName: string;
  readonly sessionId: string;
  readonly options: LoadOptions;
}

export interface WorkflowTriggerExecutionPort {
  execute(
    input: WorkflowTriggerExecuteInput,
  ): Promise<WorkflowTriggerExecutionResult>;
  resume(
    input: WorkflowTriggerResumeInput,
  ): Promise<WorkflowTriggerExecutionResult>;
}

export interface EventTriggerRuntimePorts {
  readonly receiptStore?: EventReceiptStore;
  readonly workflowExecution?: WorkflowTriggerExecutionPort;
  readonly supervisorDispatchClient?: WorkflowSupervisorDispatchClient;
  readonly replyDispatcher?: ChatReplyDispatcher;
}

export interface EventTriggerDispatchInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly raw?: unknown;
}
