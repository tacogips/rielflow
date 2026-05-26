import { describe, expect, test } from "vitest";
import {
  createSupervisorProgressEventSink,
  createSupervisorProgressRenderer,
} from "./supervisor-progress-renderer";

describe("createSupervisorProgressRenderer", () => {
  test("renders verbose step-started workflow-run events", () => {
    const lines: string[] = [];
    const renderer = createSupervisorProgressRenderer({
      verbose: true,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    renderer.handle({
      type: "step-started",
      workflowExecutionId: "sess-1",
      workflowName: "workflow-a",
      workflowId: "workflow-a",
      stepId: "writer",
      nodeId: "writer-node",
      nodeExecId: "exec-1",
      attempt: 2,
      queuedStepIds: ["review"],
    });

    expect(lines).toEqual([
      "workflow step start: sessionId=sess-1 workflow=workflow-a stepId=writer nodeId=writer-node nodeExecId=exec-1 attempt=2 queueRemaining=1",
    ]);
  });

  test("keeps non-verbose and terminal workflow-run events quiet", () => {
    const lines: string[] = [];
    const renderer = createSupervisorProgressRenderer({
      verbose: false,
      writeLine: (line) => {
        lines.push(line);
      },
    });

    renderer.handle({
      type: "step-started",
      workflowExecutionId: "sess-1",
      stepId: "writer",
      nodeExecId: "exec-1",
    });
    renderer.handle({
      type: "workflow-completed",
      workflowExecutionId: "sess-1",
      status: "completed",
    });

    expect(lines).toEqual([]);
  });

  test("event sink delegates workflow-run events to the renderer", () => {
    const lines: string[] = [];
    const renderer = createSupervisorProgressRenderer({
      verbose: true,
      writeLine: (line) => {
        lines.push(line);
      },
    });
    const sink = createSupervisorProgressEventSink(renderer);

    sink.emit({
      type: "step-started",
      workflowExecutionId: "sess-sink",
      stepId: "main",
      nodeExecId: "exec-sink",
    });

    expect(lines).toEqual([
      "workflow step start: sessionId=sess-sink stepId=main nodeExecId=exec-sink",
    ]);
  });
});
