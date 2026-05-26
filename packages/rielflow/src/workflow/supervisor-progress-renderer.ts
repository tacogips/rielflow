import type { WorkflowRunEvent, WorkflowRunEventSink } from "./engine";

export interface SupervisorProgressRenderer {
  readonly verbose: boolean;
  handle(event: WorkflowRunEvent): void;
}

export interface SupervisorProgressRendererOptions {
  readonly verbose: boolean;
  readonly writeLine: (line: string) => void;
}

function formatWorkflowRunProgressEvent(
  event: WorkflowRunEvent,
): string | undefined {
  switch (event.type) {
    case "step-started":
      return [
        "workflow step start:",
        `sessionId=${event.workflowExecutionId}`,
        ...(event.workflowName === undefined
          ? []
          : [`workflow=${event.workflowName}`]),
        `stepId=${event.stepId}`,
        ...(event.nodeId === undefined ? [] : [`nodeId=${event.nodeId}`]),
        `nodeExecId=${event.nodeExecId}`,
        ...(event.attempt === undefined ? [] : [`attempt=${event.attempt}`]),
        ...(event.queuedStepIds === undefined
          ? []
          : [`queueRemaining=${event.queuedStepIds.length}`]),
      ].join(" ");
    case "step-completed":
    case "workflow-completed":
      return undefined;
  }
}

export function createSupervisorProgressRenderer(
  options: SupervisorProgressRendererOptions,
): SupervisorProgressRenderer {
  return {
    verbose: options.verbose,
    handle(event) {
      if (!options.verbose) {
        return;
      }
      const message = formatWorkflowRunProgressEvent(event);
      if (message !== undefined) {
        options.writeLine(message);
      }
    },
  };
}

export function createSupervisorProgressEventSink(
  renderer: SupervisorProgressRenderer,
): WorkflowRunEventSink {
  return {
    emit(event) {
      renderer.handle(event);
    },
  };
}
