import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { LoadedWorkflow } from "../workflow/load";
import { resolveNodeExecutionMailboxArtifactPaths } from "../workflow/node-execution-mailbox";
import type { WorkflowSessionState } from "../workflow/session";
import type { NodePayload } from "../workflow/types";
import { buildHistoryDetailPaneState } from "./opentui-detail-content";
import {
  OPEN_TUI_EMPTY_SELECT_VALUE,
  formatTimestampForDisplay,
  resolveSystemTimeZoneLabel,
  type RuntimeSessionView,
} from "./opentui-model";

function makeLoadedWorkflow(workerPayload: NodePayload): LoadedWorkflow {
  return {
    workflowName: "demo",
    workflowDirectory: "/tmp/demo",
    artifactWorkflowRoot: "/tmp/artifacts/demo",
    bundle: {
      workflow: {
        workflowId: "demo",
        description: "demo workflow",
        defaults: {
          maxLoopIterations: 3,
          nodeTimeoutMs: 120_000,
        },
        managerNodeId: "manager",
        subWorkflows: [],
        nodes: [
          {
            id: "manager",
            kind: "root-manager",
            nodeFile: "node-manager.json",
            completion: { type: "none" },
          },
          {
            id: "worker",
            kind: "task",
            nodeFile: "node-worker.json",
            completion: { type: "none" },
          },
        ],
        edges: [],
        loops: [],
        branching: { mode: "fan-out" },
      },
      workflowVis: {
        nodes: [
          { id: "manager", order: 0 },
          { id: "worker", order: 1 },
        ],
      },
      nodePayloads: {
        manager: {
          id: "manager",
          model: "manager-model",
          promptTemplate: "Manage the workflow",
          variables: {},
        },
        worker: workerPayload,
      },
    },
  };
}

const temporaryArtifactDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryArtifactDirs.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function createNodeExecutionArtifactDir(): Promise<string> {
  const artifactDir = await mkdtemp(
    path.join(tmpdir(), "divedra-opentui-detail-"),
  );
  temporaryArtifactDirs.push(artifactDir);
  const mailboxPaths = resolveNodeExecutionMailboxArtifactPaths(artifactDir);
  await mkdir(mailboxPaths.inboxDir, { recursive: true });
  await mkdir(mailboxPaths.outboxDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, "input.json"),
    '{\n  "request": "hello"\n}\n',
    "utf8",
  );
  await writeFile(
    path.join(artifactDir, "meta.json"),
    '{\n  "status": "succeeded"\n}\n',
    "utf8",
  );
  await writeFile(
    mailboxPaths.metaPath,
    '{\n  "transport": "mailbox"\n}\n',
    "utf8",
  );
  await writeFile(
    mailboxPaths.inputPath,
    '{\n  "kind": "inbox"\n}\n',
    "utf8",
  );
  await writeFile(
    path.join(mailboxPaths.outboxDir, "output.json"),
    '{\n  "kind": "outbox"\n}\n',
    "utf8",
  );
  return artifactDir;
}

function makeRuntimeSessionView(artifactDir: string): RuntimeSessionView {
  const session: WorkflowSessionState = {
    sessionId: "sess-1",
    workflowName: "demo",
    workflowId: "demo",
    status: "completed",
    startedAt: "2026-03-26T00:00:00.000Z",
    endedAt: "2026-03-26T00:01:00.000Z",
    queue: [],
    currentNodeId: "worker",
    nodeExecutionCounter: 1,
    nodeExecutionCounts: { worker: 1 },
    transitions: [],
    nodeExecutions: [
      {
        nodeId: "worker",
        nodeExecId: "nodeexec-1",
        status: "succeeded",
        artifactDir,
        startedAt: "2026-03-26T00:00:10.000Z",
        endedAt: "2026-03-26T00:00:20.000Z",
        backendSessionId: "codex-session-1",
      },
    ],
    communicationCounter: 0,
    communications: [],
    runtimeVariables: {},
  };

  return {
    session,
    nodeExecutions: [
      {
        sessionId: "sess-1",
        nodeExecId: "nodeexec-1",
        nodeId: "worker",
        status: "succeeded",
        artifactDir,
        startedAt: "2026-03-26T00:00:10.000Z",
        endedAt: "2026-03-26T00:00:20.000Z",
        attempt: 1,
        outputAttemptCount: 1,
        outputValidationErrors: null,
        backendSessionMode: "reuse",
        backendSessionId: "codex-session-1",
        restartedFromNodeExecId: null,
        inputHash: "input-hash",
        outputHash: "output-hash",
        inputJson: '{"request":"hello"}',
        outputJson: '{"ok":true}',
        createdAt: "2026-03-26T00:00:20.000Z",
      },
    ],
    nodeLogs: [
      {
        id: 1,
        sessionId: "sess-1",
        nodeExecId: "nodeexec-1",
        nodeId: "worker",
        level: "info",
        message: "worker completed",
        payloadJson: null,
        at: "2026-03-26T00:00:20.000Z",
      },
    ],
  };
}

describe("buildHistoryDetailPaneState", () => {
  test("builds an empty summary placeholder when no node is selected", async () => {
    const artifactDir = await createNodeExecutionArtifactDir();
    const state = await buildHistoryDetailPaneState({
      detailMode: "summary",
      detailViewerBody: "",
      detailViewerTitle: "",
      historyViewMode: "subworkflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: makeLoadedWorkflow({
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "Do work",
        variables: {},
      }),
      managerMessages: [],
      runtimeSessionView: makeRuntimeSessionView(artifactDir),
      selectedNodeExecution: undefined,
    });

    expect(state.summaryHeaderVisible).toBe(true);
    expect(state.summaryHeaderText).toBe("Select a workflow node.");
    expect(state.summaryVisible).toBe(true);
    expect(state.textVisible).toBe(false);
    expect(state.summaryOptions[0]?.value).toBe(OPEN_TUI_EMPTY_SELECT_VALUE);
  });

  test("builds summary content and agent-session rows for a selected execution", async () => {
    const artifactDir = await createNodeExecutionArtifactDir();
    const runtimeSessionView = makeRuntimeSessionView(artifactDir);
    const selectedNodeExecution = runtimeSessionView.session.nodeExecutions[0];
    const state = await buildHistoryDetailPaneState({
      detailMode: "summary",
      detailViewerBody: "",
      detailViewerTitle: "",
      historyViewMode: "workflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: makeLoadedWorkflow({
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "Do work",
        variables: {},
      }),
      managerMessages: [],
      runtimeSessionView,
      selectedNodeExecution,
    });

    expect(state.summaryHeaderVisible).toBe(true);
    expect(state.summaryHeaderText).toContain("Workflow run: sess-1");
    expect(state.summaryHeaderText).toContain("Node execution: nodeexec-1");
    expect(state.summaryHeaderText).toContain(
      `Timezone: ${resolveSystemTimeZoneLabel()}`,
    );
    expect(state.summaryHeaderText).toContain(
      `Node start: ${formatTimestampForDisplay("2026-03-26T00:00:10.000Z")}`,
    );
    expect(state.summaryHeaderText).toContain(
      `Node end: ${formatTimestampForDisplay("2026-03-26T00:00:20.000Z")}`,
    );
    expect(state.summaryVisible).toBe(true);
    expect(state.textVisible).toBe(false);
    expect(state.summaryOptions[0]?.name).toBe("AI agent session (codex-agent)");
    expect(state.summaryOptions[1]?.name).toBe("Execution input (input.json)");
  });

  test("renders outbox detail content with the mailbox outbox artifact", async () => {
    const artifactDir = await createNodeExecutionArtifactDir();
    const runtimeSessionView = makeRuntimeSessionView(artifactDir);
    const selectedNodeExecution = runtimeSessionView.session.nodeExecutions[0];
    const state = await buildHistoryDetailPaneState({
      detailMode: "outbox",
      detailViewerBody: "",
      detailViewerTitle: "",
      historyViewMode: "workflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: makeLoadedWorkflow({
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "Do work",
        variables: {},
      }),
      managerMessages: [],
      runtimeSessionView,
      selectedNodeExecution,
    });

    expect(state.summaryVisible).toBe(false);
    expect(state.textVisible).toBe(true);
    expect(state.textContent).toContain("Execution output.json:");
    expect(state.textContent).toContain('"ok":true');
    expect(state.textContent).toContain("Mailbox outbox/output.json:");
    expect(state.textContent).toContain('"kind": "outbox"');
  });

  test("renders workflow logs with localized workflow timestamps", async () => {
    const artifactDir = await createNodeExecutionArtifactDir();
    const runtimeSessionView = makeRuntimeSessionView(artifactDir);
    const state = await buildHistoryDetailPaneState({
      detailMode: "session-logs",
      detailViewerBody: "",
      detailViewerTitle: "",
      historyViewMode: "workflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: makeLoadedWorkflow({
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "Do work",
        variables: {},
      }),
      managerMessages: [],
      runtimeSessionView,
      selectedNodeExecution: runtimeSessionView.session.nodeExecutions[0],
    });

    expect(state.summaryVisible).toBe(false);
    expect(state.textVisible).toBe(true);
    expect(state.textContent).toContain("Workflow run logs for sess-1");
    expect(state.textContent).toContain(
      `Timezone: ${resolveSystemTimeZoneLabel()}`,
    );
    expect(state.textContent).toContain(
      `Start datetime: ${formatTimestampForDisplay("2026-03-26T00:00:00.000Z")}`,
    );
    expect(state.textContent).toContain(
      `End datetime: ${formatTimestampForDisplay("2026-03-26T00:01:00.000Z")}`,
    );
    expect(state.textContent).toContain(
      formatTimestampForDisplay("2026-03-26T00:00:20.000Z"),
    );
  });

  test("renders manager-session detail with localized timestamps", async () => {
    const artifactDir = await createNodeExecutionArtifactDir();
    const runtimeSessionView = makeRuntimeSessionView(artifactDir);
    const state = await buildHistoryDetailPaneState({
      detailMode: "manager",
      detailViewerBody: "",
      detailViewerTitle: "",
      historyViewMode: "workflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: makeLoadedWorkflow({
        id: "worker",
        executionBackend: "codex-agent",
        model: "gpt-5",
        promptTemplate: "Do work",
        variables: {},
      }),
      managerMessages: [
        {
          accepted: true,
          createdAt: "2026-03-26T00:00:20.000Z",
          managerMessageId: "mgrmsg-1",
          managerNodeExecId: "nodeexec-1",
          managerNodeId: "worker",
          managerSessionId: "mgrsess-nodeexec-1",
          parsedIntent: [{ kind: "planner-note" }],
          workflowExecutionId: "sess-1",
          workflowId: "demo",
          message: "Proceed to the next step.",
        },
      ],
      runtimeSessionView,
      selectedNodeExecution: runtimeSessionView.session.nodeExecutions[0],
    });

    expect(state.summaryVisible).toBe(false);
    expect(state.textVisible).toBe(true);
    expect(state.textContent).toContain(
      `Timezone: ${resolveSystemTimeZoneLabel()}`,
    );
    expect(state.textContent).toContain(
      formatTimestampForDisplay("2026-03-26T00:00:20.000Z"),
    );
    expect(state.textContent).toContain("mgrmsg-1");
  });

  test("renders viewer content through the shared detail-pane state", async () => {
    const state = await buildHistoryDetailPaneState({
      detailMode: "viewer",
      detailViewerBody: "{\n  \"ok\": true\n}",
      detailViewerTitle: "demo / worker / Execution output",
      historyViewMode: "workflow",
      inputDetection: {
        mode: "json",
        reason: "structured input",
      },
      loadedWorkflow: undefined,
      managerMessages: [],
      runtimeSessionView: undefined,
      selectedNodeExecution: undefined,
    });

    expect(state.summaryVisible).toBe(false);
    expect(state.textVisible).toBe(true);
    expect(state.textContent).toContain("demo / worker / Execution output");
    expect(state.textContent).toContain('"ok": true');
  });
});
