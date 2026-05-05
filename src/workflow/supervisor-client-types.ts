import type { MockNodeScenario } from "./adapter";
import type { WorkflowSessionState } from "./session";
import type { LoadOptions } from "./types";
import type {
  EventBinding,
  EventSupervisedRunRecord,
  EventSupervisorCommand,
} from "../events/types";

export type SupervisorEngineOverrides = {
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
};

export interface SupervisedWorkflowView {
  readonly supervisedRun: EventSupervisedRunRecord;
  readonly activeTargetStatus?: WorkflowSessionState["status"];
}

export interface StartSupervisedWorkflowInput extends LoadOptions {
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly targetWorkflowName: string;
  readonly idempotencyKey?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly bindingSnapshot: EventBinding;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface StopSupervisedWorkflowInput extends LoadOptions {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface RestartSupervisedWorkflowInput extends LoadOptions {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly idempotencyKey?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxSteps?: number;
}

export interface SupervisedWorkflowLookup extends LoadOptions {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly idempotencyKey?: string;
}

export interface SubmitSupervisedWorkflowInput extends LoadOptions {
  readonly supervisedRunId?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly targetWorkflowName?: string;
  readonly bindingSnapshot?: EventBinding;
  readonly idempotencyKey?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface WorkflowSupervisorClient {
  dispatchCommand(input: {
    readonly command: EventSupervisorCommand;
    readonly binding: EventBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView>;
  start(input: StartSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  stop(input: StopSupervisedWorkflowInput): Promise<SupervisedWorkflowView>;
  restart(
    input: RestartSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
  status(input: SupervisedWorkflowLookup): Promise<SupervisedWorkflowView>;
  submitInput(
    input: SubmitSupervisedWorkflowInput,
  ): Promise<SupervisedWorkflowView>;
}
