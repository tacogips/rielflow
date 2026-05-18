import type { DivedraOptions } from "../lib";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import type { ChatReplyDispatcher } from "../workflow/types";
import type { WorkflowSupervisorClient } from "../workflow/supervisor-client";
import type { WorkflowSupervisorDispatchClient } from "../workflow/supervisor-dispatch-client";
import type { ScheduledEventManager } from "./scheduled-event-manager";
import type { WorkflowScheduleRepository } from "./workflow-schedule-registry";
import type {
  EventReceiptStore,
  WorkflowTriggerExecutionPort,
} from "divedra-events/runtime-ports";

/**
 * Options for {@link import("./trigger-runner").createWorkflowTriggerRunner} and
 * supervisor dispatch resolver runs (subset used by `runSupervisorDispatchLlmResolver`).
 */
export interface WorkflowTriggerRunnerOptions extends DivedraOptions {
  readonly eventRoot?: string;
  readonly endpoint?: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly mockScenario?: MockNodeScenario;
  readonly dryRun?: boolean;
  readonly maxSteps?: number;
  readonly maxConcurrency?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  readonly eventReceiptStore?: EventReceiptStore;
  readonly workflowExecutionPort?: WorkflowTriggerExecutionPort;
  readonly supervisorClient?: WorkflowSupervisorClient;
  readonly supervisorDispatchClient?: WorkflowSupervisorDispatchClient;
  readonly scheduledEventManager?: ScheduledEventManager;
  readonly workflowScheduleRepository?: WorkflowScheduleRepository;
}
