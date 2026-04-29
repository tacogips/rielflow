import type {
  SupervisedWorkflowView,
  SupervisorEngineOverrides,
  WorkflowSupervisorClient,
} from "../workflow/supervisor-client";
import type { EventBinding, EventSupervisorCommand } from "./types";

export type { SupervisorEngineOverrides };

export interface EventSupervisorRouter {
  dispatch(input: {
    readonly command: EventSupervisorCommand;
    readonly binding: EventBinding;
    readonly runtimeVariables: Readonly<Record<string, unknown>>;
    readonly engine?: SupervisorEngineOverrides;
  }): Promise<SupervisedWorkflowView>;
}

export function createEventSupervisorRouter(input: {
  readonly client: WorkflowSupervisorClient;
}): EventSupervisorRouter {
  return {
    dispatch(dispatchInput) {
      return input.client.dispatchCommand(dispatchInput);
    },
  };
}
