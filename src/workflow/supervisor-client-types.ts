import type { MockNodeScenario } from "./scenario-adapter";
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
  readonly asyncRun?: boolean;
  readonly onAsyncRun?: (input: {
    readonly supervisedRunId: string;
    readonly workflowExecutionId: string;
    readonly task: Promise<SupervisedWorkflowView>;
  }) => void;
};

export type SupervisedWorkflowCommandResult =
  | {
      readonly kind: "status";
      readonly workflowExecutionId?: string;
      readonly targetStatus?: WorkflowSessionState["status"];
    }
  | {
      readonly kind: "progress";
      readonly workflowExecutionId?: string;
      readonly targetStatus?: WorkflowSessionState["status"];
      readonly currentStepId?: string;
      readonly queuedStepIds: readonly string[];
      readonly completedStepCount: number;
      readonly nodeExecutionCount: number;
    }
  | {
      readonly kind: "inbox";
      readonly workflowExecutionId?: string;
      readonly pendingUserActionCount: number;
      readonly pendingUserActions: readonly {
        readonly nodeId: string;
        readonly nodeExecId: string;
        readonly userActionId: string;
        readonly pausedAt: string;
      }[];
    }
  | {
      readonly kind: "logs";
      readonly workflowExecutionId?: string;
      readonly nodeExecutionCount: number;
      readonly runtimeLogCount: number;
      readonly recentLogs: readonly {
        readonly level: string;
        readonly message: string;
        readonly nodeId: string | null;
        readonly nodeExecId: string | null;
        readonly at: string;
      }[];
      readonly exportArtifactDir: string;
    };

export interface SupervisedWorkflowView {
  readonly supervisedRun: EventSupervisedRunRecord;
  readonly activeTargetStatus?: WorkflowSessionState["status"];
  readonly commandResult?: SupervisedWorkflowCommandResult;
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
  readonly runnerPoolRunId?: string;
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
  readonly alias?: string;
  readonly workflowKey?: string;
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
