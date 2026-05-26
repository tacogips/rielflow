import type {
  AdapterAmbientManagerContext,
  AdapterBackendSessionInput,
  AdapterLlmSessionMessage,
  AdapterProcessLog,
  NodeAdapter,
} from "../adapter";
import type { JsonSchemaValidationError } from "../json-schema";
import type { ManagerSessionStore } from "../manager-session-store";
import type { Result } from "../result";
import type {
  BackendSessionSelection,
  ResolvedStepExecutionAddress,
  StepIdentityFields,
} from "../runtime-addressing";
import type { NodeExecutionRecord, WorkflowSessionState } from "../session";
import type {
  AgentNodePayload,
  LoopRule,
  NodePayload,
  WorkflowEdge,
  WorkflowJson,
  WorkflowNodeRef,
} from "../types";
import type { LoadedWorkflowSuccess } from "./run-setup";
import type {
  EngineExecutionGuards,
  NormalizedWorkflowRunOptions,
  WorkflowRunFailure,
  WorkflowRunResult,
} from "./types-and-session-state";

export type FinalizeExecutedNodeResult =
  | Result<WorkflowRunResult, WorkflowRunFailure>
  | { readonly kind: "done"; readonly session: WorkflowSessionState }
  | {
      readonly kind: "restart";
      readonly session: WorkflowSessionState;
      readonly previousNodeExecId: string;
      readonly restartAttempt: number;
    };

export interface FinalizeExecutedNodeInput {
  readonly session: WorkflowSessionState;
  readonly options: NormalizedWorkflowRunOptions;
  readonly workflow: WorkflowJson;
  readonly loaded: LoadedWorkflowSuccess;
  readonly queue: readonly string[];
  readonly nodeId: string;
  readonly nodeRef: WorkflowNodeRef;
  readonly nodeExecId: string;
  readonly stepIdentityFields: StepIdentityFields;
  readonly nextExecutionCounter: number;
  readonly mailboxInstanceId: string;
  readonly nodeStatus: NodeExecutionRecord["status"];
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly restartAttempt: number;
  readonly outputAttemptCount: number;
  readonly outputValidationErrors: readonly JsonSchemaValidationError[];
  readonly backendSessionId: string | undefined;
  readonly backendSessionIdentityFields: StepIdentityFields | undefined;
  readonly backendSessionSelection: BackendSessionSelection | undefined;
  readonly backendSessionProvider: string | undefined;
  readonly backendSession: AdapterBackendSessionInput | undefined;
  readonly requestedBackendSessionMode:
    | AdapterBackendSessionInput["mode"]
    | undefined;
  readonly previousNodeExecId: string | undefined;
  readonly stepExecutionAddress: ResolvedStepExecutionAddress;
  readonly timeoutMs: number;
  readonly managerSessionId: string | undefined;
  readonly ambientManagerContext: AdapterAmbientManagerContext | undefined;
  readonly managerSessionStore: ManagerSessionStore;
  readonly executionTargetNoun: string;
  readonly outputPayload: Readonly<Record<string, unknown>>;
  readonly updatedCounts: Readonly<Record<string, number>>;
  readonly outgoingEdges: ReadonlyMap<string, readonly WorkflowEdge[]>;
  readonly maxLoopIterations: number;
  readonly loopRule: LoopRule | undefined;
  readonly effectiveAdapter: NodeAdapter;
  readonly guards: EngineExecutionGuards | undefined;
  readonly crossWorkflowInvocationStack: readonly string[];
  readonly workflowName: string;
  readonly workflowNodes: ReadonlyMap<string, WorkflowNodeRef>;
  readonly nodeMap: Readonly<Record<string, NodePayload>>;
  readonly isOptionalExecutionNode: boolean;
  readonly inputJson: string;
  readonly executionNodePayload: NodePayload;
  readonly upstreamCommunicationIds: readonly string[];
  readonly stuckRestartBackoffMs: number;
  readonly agentNodePayload: AgentNodePayload | null;
  readonly processLogs: readonly AdapterProcessLog[];
  readonly llmMessages: readonly AdapterLlmSessionMessage[];
}
