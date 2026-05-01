import type { DivedraOptions } from "../lib";
import type { MockNodeScenario } from "../workflow/adapter";
import type { ChatReplyDispatcher } from "../workflow/types";
import type { WorkflowSupervisorClient } from "../workflow/supervisor-client";

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
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly readOnly?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  readonly supervisorClient?: WorkflowSupervisorClient;
}
