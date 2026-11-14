import type { MockNodeScenario } from "./scenario-adapter";
import type { WorkflowSessionState } from "./session";
import type { LoadOptions } from "./types";

export type WorkflowSupervisorAction =
  | "start"
  | "status"
  | "progress"
  | "inbox"
  | "read"
  | "logs"
  | "export"
  | "stop"
  | "cancel"
  | "restart"
  | "rerun"
  | "input"
  | "submit"
  | "resume";

export interface WorkflowSupervisorBinding {
  readonly id: string;
  readonly sourceId: string;
  readonly workflowName?: string;
  readonly inputMapping?: unknown;
  readonly execution?: {
    readonly supervisorWorkflowName?: string;
    readonly maxRestartsOnFailure?: number;
    readonly autoImprove?: boolean | { readonly enabled?: boolean };
    readonly control?: Readonly<Record<string, unknown>>;
    readonly async?: boolean;
  };
}

export type SupervisedWorkflowStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "restarting"
  | "completed"
  | "failed";

export interface SupervisedWorkflowRunRecord {
  readonly supervisedRunId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly supervisorWorkflowName: string;
  readonly supervisorExecutionId?: string;
  readonly targetWorkflowName: string;
  readonly activeTargetExecutionId?: string;
  readonly status: SupervisedWorkflowStatus;
  readonly restartCount: number;
  readonly maxRestartsOnFailure: number;
  readonly autoImproveEnabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkflowSupervisorCommand {
  readonly commandId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly correlationKey: string;
  readonly action: WorkflowSupervisorAction;
  readonly args?: readonly string[];
  readonly targetWorkflowName: string;
  readonly supervisedRunId?: string;
  readonly targetWorkflowExecutionId?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly reason?: string;
  readonly receivedEventReceiptId: string;
}

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
  readonly supervisedRun: SupervisedWorkflowRunRecord;
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
  readonly bindingSnapshot: WorkflowSupervisorBinding;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
}

export interface StopSupervisedWorkflowInput extends LoadOptions {
  readonly runnerPoolRunId?: string;
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
  readonly alias?: string;
  readonly workflowKey?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly idempotencyKey?: string;
  readonly reason?: string;
}

export interface RestartSupervisedWorkflowInput extends LoadOptions {
  readonly runnerPoolRunId?: string;
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
  readonly alias?: string;
  readonly workflowKey?: string;
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
  readonly runnerPoolRunId?: string;
  readonly supervisedRunId?: string;
  readonly workflowExecutionId?: string;
  readonly alias?: string;
  readonly workflowKey?: string;
  readonly sourceId?: string;
  readonly bindingId?: string;
  readonly correlationKey?: string;
  readonly targetWorkflowName?: string;
  readonly bindingSnapshot?: WorkflowSupervisorBinding;
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
    readonly command: WorkflowSupervisorCommand;
    readonly binding: WorkflowSupervisorBinding;
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
