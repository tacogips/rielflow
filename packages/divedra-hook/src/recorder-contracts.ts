import type { LoadOptions } from "divedra-core";

export type HookEventStatus =
  | "recorded"
  | "blocked"
  | "handler_failed"
  | "recording_failed";

export interface HookEventSaveInput {
  readonly hookEventId: string;
  readonly workflowId: string;
  readonly workflowExecutionId: string;
  readonly nodeId: string;
  readonly nodeExecId: string;
  readonly managerSessionId?: string;
  readonly vendor: string;
  readonly agentSessionId: string;
  readonly rawEventName: string;
  readonly eventName: string;
  readonly cwd: string;
  readonly transcriptPath?: string | null;
  readonly model?: string;
  readonly turnId?: string;
  readonly payloadHash: string;
  readonly payloadRefJson?: string;
  readonly responseJson?: string;
  readonly status: HookEventStatus;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HookEventStore {
  saveHookEvent(row: HookEventSaveInput, options?: LoadOptions): Promise<void>;
}
