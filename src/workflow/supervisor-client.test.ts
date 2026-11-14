import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { atomicWriteJsonFile as writeJson } from "../shared/fs";
import { createEventSupervisedRunRepository } from "../events/supervised-runs";
import type { EventBinding, EventSupervisedRunRecord } from "../events/types";
import { saveSession, loadSession } from "./session-store";
import { createSessionState } from "./session";
import { createWorkflowSupervisorClient } from "./supervisor-client";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-supervisor-client-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeManagerOnlyWorkflow(input: {
  readonly root: string;
  readonly workflowName: string;
  readonly sticky: boolean;
}): Promise<void> {
  const workflowDir = path.join(input.root, input.workflowName);
  await mkdir(workflowDir, { recursive: true });
  await writeJson(path.join(workflowDir, "workflow.json"), {
    workflowId: input.workflowName,
    description: "supervisor client test workflow",
    defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
    entryStepId: "divedra-manager",
    managerStepId: "divedra-manager",
    nodes: [
      {
        id: "divedra-manager",
        nodeFile: "node-divedra-manager.json",
      },
    ],
    steps: [
      {
        id: "divedra-manager",
        nodeId: "divedra-manager",
        role: "manager",
      },
    ],
  });
  await writeJson(path.join(workflowDir, "node-divedra-manager.json"), {
    id: "divedra-manager",
    executionBackend: "codex-agent",
    model: "gpt-5-nano",
    ...(input.sticky ? { sessionPolicy: { mode: "reuse" } } : {}),
    promptTemplate: "manager",
    variables: {},
  });
}

describe("createWorkflowSupervisorClient", () => {
  test("replays the same error for duplicate command ids after a failed start", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-fail-idempotent";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const baseOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b1",
      sourceId: "s1",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 3,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(baseOpts);
    const command = {
      commandId: "shared-cmd-fail",
      sourceId: "s1",
      bindingId: "b1",
      correlationKey: "corr-fail",
      action: "start" as const,
      targetWorkflowName: workflowName,
      receivedEventReceiptId: "rx-1",
    };

    let firstMessage = "";
    try {
      await client.dispatchCommand({
        command,
        binding,
        runtimeVariables: {},
        engine: {
          mockScenario: {
            "divedra-manager": { fail: true },
          },
        },
      });
    } catch (e: unknown) {
      firstMessage = e instanceof Error ? e.message : "";
    }
    expect(firstMessage.length).toBeGreaterThan(0);

    await expect(
      client.dispatchCommand({
        command,
        binding,
        runtimeVariables: {},
        engine: {
          mockScenario: {
            "divedra-manager": { fail: true },
          },
        },
      }),
    ).rejects.toThrow(firstMessage);
  });

  test("rejects restart when restart budget is exhausted", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-restart-budget";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const baseOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-budget-1" },
        },
      },
    };

    const binding: EventBinding = {
      id: "b-budget",
      sourceId: "s-budget",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 1,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(baseOpts);

    await client.dispatchCommand({
      command: {
        commandId: "start-budget-1",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-budget",
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-start",
      },
      binding,
      runtimeVariables: {},
    });

    await client.dispatchCommand({
      command: {
        commandId: "restart-budget-1",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-budget",
        action: "restart",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-r1",
      },
      binding,
      runtimeVariables: {},
    });

    await expect(
      client.dispatchCommand({
        command: {
          commandId: "restart-budget-2",
          sourceId: binding.sourceId,
          bindingId: binding.id,
          correlationKey: "corr-budget",
          action: "restart",
          targetWorkflowName: workflowName,
          receivedEventReceiptId: "rx-r2",
        },
        binding,
        runtimeVariables: {},
      }),
    ).rejects.toThrow(/restart budget exhausted/i);
  });

  test("does not create a failed run record for missing status lookups", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-missing-status";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-missing-status",
      sourceId: "s-missing-status",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    await expect(
      client.dispatchCommand({
        command: {
          commandId: "status-missing",
          sourceId: binding.sourceId,
          bindingId: binding.id,
          correlationKey: "corr-missing",
          action: "status",
          targetWorkflowName: workflowName,
          receivedEventReceiptId: "rx-missing",
        },
        binding,
        runtimeVariables: {},
      }),
    ).rejects.toThrow(/no supervised run for status lookup/i);

    const repo = createEventSupervisedRunRepository(loadOpts);
    const latest = await repo.findLatestByCorrelation({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-missing",
    });
    expect(latest).toBeNull();
  });

  test("clears activeTargetExecutionId when restart fails after cancellation", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-restart-fail-clears-active";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-restart-fail",
      sourceId: "s-restart-fail",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 2,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const started = await client.dispatchCommand({
      command: {
        commandId: "restart-fail-start",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-restart-fail",
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-restart-start",
      },
      binding,
      runtimeVariables: {},
      engine: {
        mockScenario: {
          "divedra-manager": {
            payload: { reply: "ok" },
            backendSession: { sessionId: "backend-restart-fail-1" },
          },
        },
      },
    });
    expect(started.supervisedRun.activeTargetExecutionId).toBeDefined();

    await expect(
      client.dispatchCommand({
        command: {
          commandId: "restart-fail-run",
          sourceId: binding.sourceId,
          bindingId: binding.id,
          correlationKey: "corr-restart-fail",
          action: "restart",
          targetWorkflowName: workflowName,
          receivedEventReceiptId: "rx-restart-fail",
        },
        binding,
        runtimeVariables: {},
        engine: {
          mockScenario: {
            "divedra-manager": { fail: true },
          },
        },
      }),
    ).rejects.toThrow();

    const repo = createEventSupervisedRunRepository(loadOpts);
    const latest = await repo.findLatestByCorrelation({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-restart-fail",
    });
    expect(latest?.status).toBe("failed");
    expect(latest?.activeTargetExecutionId).toBeUndefined();
  });

  test("reruns from the step id supplied as the first command arg", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-rerun-from-step";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-rerun-step",
      sourceId: "s-rerun-step",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 2,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const started = await client.dispatchCommand({
      command: {
        commandId: "rerun-step-start",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-rerun-step",
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-rerun-start",
      },
      binding,
      runtimeVariables: { original: true },
      engine: {
        mockScenario: {
          "divedra-manager": {
            payload: { reply: "ok" },
            backendSession: { sessionId: "backend-rerun-step-1" },
          },
        },
      },
    });
    const sourceSessionId = started.supervisedRun.activeTargetExecutionId;
    expect(sourceSessionId).toBeDefined();

    const rerun = await client.dispatchCommand({
      command: {
        commandId: "rerun-step-command",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-rerun-step",
        action: "rerun",
        args: ["divedra-manager"],
        targetWorkflowName: workflowName,
        ...(sourceSessionId === undefined
          ? {}
          : { targetWorkflowExecutionId: sourceSessionId }),
        receivedEventReceiptId: "rx-rerun-step",
      },
      binding,
      runtimeVariables: { rerunFlag: true },
      engine: {
        mockScenario: {
          "divedra-manager": {
            payload: { reply: "rerun-ok" },
            backendSession: { sessionId: "backend-rerun-step-2" },
          },
        },
      },
    });

    const rerunSessionId = rerun.supervisedRun.activeTargetExecutionId;
    expect(rerunSessionId).toBeDefined();
    expect(rerunSessionId).not.toBe(sourceSessionId);
    const loaded = await loadSession(rerunSessionId ?? "", loadOpts);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(loaded.value.runtimeVariables["original"]).toBe(true);
    expect(loaded.value.runtimeVariables["rerunFlag"]).toBe(true);
  });

  test("returns distinct commandResult shapes for progress, inbox, and logs", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-inspection-shapes";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-inspection",
      sourceId: "s-inspection",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };
    const sessionId = "sess-supervised-inspection";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName,
          workflowId: workflowName,
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        currentNodeId: "divedra-manager",
        activeUserActions: [
          {
            nodeId: "divedra-manager",
            nodeExecId: "exec-waiting",
            userActionId: "ua-1",
            artifactDir: path.join(root, "artifacts", "ua-1"),
            status: "waiting-for-reply" as const,
            pausedAt: "2026-05-06T00:00:00.000Z",
          },
        ],
      },
      loadOpts,
    );
    expect(saved.ok).toBe(true);

    const repo = createEventSupervisedRunRepository(loadOpts);
    await repo.save(
      {
        supervisedRunId: "esv-inspection",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-inspection",
        supervisorWorkflowName: "divedra-default-workflow-supervisor",
        targetWorkflowName: workflowName,
        activeTargetExecutionId: sessionId,
        status: "running",
        restartCount: 0,
        maxRestartsOnFailure: 3,
        autoImproveEnabled: false,
        createdAt: "2026-05-06T00:00:00.000Z",
        updatedAt: "2026-05-06T00:00:00.000Z",
      },
      path.join(root, "artifacts", "supervised", "esv-inspection"),
    );

    const client = createWorkflowSupervisorClient(loadOpts);
    const progress = await client.dispatchCommand({
      command: {
        commandId: "inspection-progress",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-inspection",
        action: "progress",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-progress",
      },
      binding,
      runtimeVariables: {},
    });
    const inbox = await client.dispatchCommand({
      command: {
        commandId: "inspection-inbox",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-inspection",
        action: "inbox",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-inbox",
      },
      binding,
      runtimeVariables: {},
    });
    const logs = await client.dispatchCommand({
      command: {
        commandId: "inspection-logs",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-inspection",
        action: "logs",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-logs",
      },
      binding,
      runtimeVariables: {},
    });

    expect(progress.commandResult).toMatchObject({
      kind: "progress",
      workflowExecutionId: sessionId,
      currentStepId: "divedra-manager",
    });
    expect(inbox.commandResult).toMatchObject({
      kind: "inbox",
      pendingUserActionCount: 1,
    });
    expect(logs.commandResult).toMatchObject({
      kind: "logs",
      workflowExecutionId: sessionId,
    });
  });

  test("rejects command and binding workflow mismatches", async () => {
    const root = await makeTempDir();
    await writeManagerOnlyWorkflow({
      root,
      workflowName: "sup-match-a",
      sticky: false,
    });
    await writeManagerOnlyWorkflow({
      root,
      workflowName: "sup-match-b",
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-match",
      sourceId: "s-match",
      workflowName: "sup-match-a",
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    await expect(
      client.dispatchCommand({
        command: {
          commandId: "mismatch-workflow",
          sourceId: binding.sourceId,
          bindingId: binding.id,
          correlationKey: "corr-match",
          action: "start",
          targetWorkflowName: "sup-match-b",
          receivedEventReceiptId: "rx-match",
        },
        binding,
        runtimeVariables: {},
      }),
    ).rejects.toThrow(
      /targetWorkflowName does not match binding\.workflowName/i,
    );
  });

  test("library start replays when idempotencyKey matches", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-idem-lib-start";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-idem",
      sourceId: "s-idem",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 3,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const idem = "stable-lib-start-idem";
    const mockScenario = {
      "divedra-manager": {
        payload: { reply: "ok" },
        backendSession: { sessionId: "backend-idem-1" },
      },
    };
    const first = await client.start({
      ...loadOpts,
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-idem",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      idempotencyKey: idem,
      mockScenario,
    });
    const second = await client.start({
      ...loadOpts,
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-idem",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      idempotencyKey: idem,
      mockScenario,
    });
    expect(second.supervisedRun.supervisedRunId).toBe(
      first.supervisedRun.supervisedRunId,
    );
    expect(second.supervisedRun.activeTargetExecutionId).toBe(
      first.supervisedRun.activeTargetExecutionId,
    );
  });

  test("input starts a supervised run on first input when enabled", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-input-first-start";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-input-first",
      sourceId: "s-input-first",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: {
          intentMapping: { mode: "structured-only" },
          startOnFirstInput: true,
        },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const view = await client.dispatchCommand({
      command: {
        commandId: "input-first-command",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey: "corr-input-first",
        action: "input",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-input-first",
      },
      binding,
      runtimeVariables: {
        humanInput: {
          request: "start from input",
        },
      },
      engine: {
        mockScenario: {
          "divedra-manager": {
            payload: { reply: "started" },
            backendSession: { sessionId: "backend-input-first-1" },
          },
        },
      },
    });

    expect(view.supervisedRun.status).toBe("running");
    expect(view.supervisedRun.activeTargetExecutionId).toBeDefined();
  });

  test("library submitInput starts a supervised run on first input when enabled", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-lib-input-first-start";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-lib-input-first",
      sourceId: "s-lib-input-first",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: {
          intentMapping: { mode: "structured-only" },
          startOnFirstInput: true,
        },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const view = await client.submitInput({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-lib-input-first",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      runtimeVariables: {
        humanInput: {
          request: "start from library input",
        },
      },
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "started" },
          backendSession: { sessionId: "backend-lib-input-first-1" },
        },
      },
    });

    expect(view.supervisedRun.status).toBe("running");
    expect(view.supervisedRun.activeTargetExecutionId).toBeDefined();
  });

  test("library workflowKey and alias resolve durable supervised runs", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-key-alias-lookup";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const binding: EventBinding = {
      id: "b-key-alias",
      sourceId: "s-key-alias",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };
    const client = createWorkflowSupervisorClient(loadOpts);
    const started = await client.start({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-key-alias",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "started" },
          backendSession: { sessionId: "backend-key-alias-1" },
        },
      },
    });

    const byWorkflowKey = await client.status({ workflowKey: workflowName });
    expect(byWorkflowKey.supervisedRun.supervisedRunId).toBe(
      started.supervisedRun.supervisedRunId,
    );

    const stoppedByAlias = await client.stop({
      alias: workflowName,
      idempotencyKey: "stop-key-alias",
    });
    expect(stoppedByAlias.supervisedRun.supervisedRunId).toBe(
      started.supervisedRun.supervisedRunId,
    );
    expect(stoppedByAlias.supervisedRun.status).toBe("stopped");
  });

  test("library workflowKey and alias reject ambiguous active durable runs", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-key-alias-ambiguous";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const repo = createEventSupervisedRunRepository(loadOpts);
    const baseRecord: Omit<
      EventSupervisedRunRecord,
      "activeTargetExecutionId" | "correlationKey" | "supervisedRunId"
    > = {
      sourceId: "s-key-ambiguous",
      bindingId: "b-key-ambiguous",
      supervisorWorkflowName: "divedra-default-workflow-supervisor",
      targetWorkflowName: workflowName,
      status: "running",
      restartCount: 0,
      maxRestartsOnFailure: 3,
      autoImproveEnabled: false,
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    };
    for (const run of [
      {
        supervisedRunId: "ambiguous-run-1",
        correlationKey: "ck-amb-1",
        activeTargetExecutionId: "ambiguous-session-1",
      },
      {
        supervisedRunId: "ambiguous-run-2",
        correlationKey: "ck-amb-2",
        activeTargetExecutionId: "ambiguous-session-2",
      },
    ]) {
      const artifactDir = path.join(
        loadOpts.artifactRoot,
        "supervised-runs",
        run.supervisedRunId,
      );
      await mkdir(artifactDir, { recursive: true });
      await repo.save(
        {
          ...baseRecord,
          ...run,
          updatedAt:
            run.supervisedRunId === "ambiguous-run-1"
              ? "2026-05-14T00:00:01.000Z"
              : "2026-05-14T00:00:02.000Z",
        },
        artifactDir,
      );
    }
    const client = createWorkflowSupervisorClient(loadOpts);

    await expect(client.status({ workflowKey: workflowName })).rejects.toThrow(
      /workflowKey.*ambiguous/,
    );
    await expect(client.stop({ alias: workflowName })).rejects.toThrow(
      /alias.*ambiguous/,
    );
  });

  test("library correlation lookup ignores new idempotency keys for target resolution", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-correlation-idempotency-lookup";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const binding: EventBinding = {
      id: "b-correlation-idem",
      sourceId: "s-correlation-idem",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };
    const correlationKey = "corr-correlation-idem";
    const client = createWorkflowSupervisorClient(loadOpts);
    const started = await client.start({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey,
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "started" },
          backendSession: { sessionId: "backend-correlation-idem-1" },
        },
      },
    });

    const byCorrelation = await client.status({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey,
      idempotencyKey: "new-status-idem",
    });
    expect(byCorrelation.supervisedRun.supervisedRunId).toBe(
      started.supervisedRun.supervisedRunId,
    );

    const stopped = await client.stop({
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey,
      idempotencyKey: "new-stop-idem",
    });
    expect(stopped.supervisedRun.supervisedRunId).toBe(
      started.supervisedRun.supervisedRunId,
    );
    expect(stopped.supervisedRun.status).toBe("stopped");
  });

  test("library stop replays when idempotencyKey matches", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-idem-lib-stop";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const loadOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const binding: EventBinding = {
      id: "b-stop-idem",
      sourceId: "s-stop-idem",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(loadOpts);
    const started = await client.start({
      ...loadOpts,
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "corr-stop-idem",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-stop-idem-1" },
        },
      },
    });

    const first = await client.stop({
      supervisedRunId: started.supervisedRun.supervisedRunId,
      idempotencyKey: "stable-lib-stop",
    });
    const second = await client.stop({
      supervisedRunId: started.supervisedRun.supervisedRunId,
      idempotencyKey: "stable-lib-stop",
    });

    expect(first.supervisedRun.status).toBe("stopped");
    expect(second.supervisedRun.status).toBe("stopped");
    expect(second.supervisedRun.updatedAt).toBe(first.supervisedRun.updatedAt);
  });

  test("reuses supervisedRunId when starting again after a stopped run", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-restart-after-stop";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const baseOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-ras-1" },
        },
      },
    };

    const binding: EventBinding = {
      id: "b-restart-after-stop",
      sourceId: "s-ras",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 3,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(baseOpts);
    const correlationKey = "corr-ras-1";

    const first = await client.dispatchCommand({
      command: {
        commandId: "cmd-ras-start-1",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey,
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-1",
      },
      binding,
      runtimeVariables: {},
    });
    const runId = first.supervisedRun.supervisedRunId;

    await client.dispatchCommand({
      command: {
        commandId: "cmd-ras-stop-1",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey,
        action: "stop",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-2",
      },
      binding,
      runtimeVariables: {},
    });

    const secondStart = await client.dispatchCommand({
      command: {
        commandId: "cmd-ras-start-2",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey,
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-3",
      },
      binding,
      runtimeVariables: {},
    });

    expect(secondStart.supervisedRun.supervisedRunId).toBe(runId);
  });

  test("dispatchCommand rejects supervisedRunId when command correlation does not match the run", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-scoped-corr";
    await writeManagerOnlyWorkflow({ root, workflowName, sticky: false });

    const baseOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-sc-1" },
        },
      },
    };

    const binding: EventBinding = {
      id: "b-scoped-corr",
      sourceId: "s-scoped-corr",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 3,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(baseOpts);
    const started = await client.start({
      ...baseOpts,
      sourceId: binding.sourceId,
      bindingId: binding.id,
      correlationKey: "ck-good",
      targetWorkflowName: workflowName,
      bindingSnapshot: binding,
      runtimeVariables: {},
    });
    const runId = started.supervisedRun.supervisedRunId;

    await expect(
      client.dispatchCommand({
        command: {
          commandId: "cmd-scoped-corr-mismatch",
          sourceId: binding.sourceId,
          bindingId: binding.id,
          correlationKey: "ck-wrong",
          action: "status",
          targetWorkflowName: workflowName,
          supervisedRunId: runId,
          receivedEventReceiptId: "rx-sc",
        },
        binding,
        runtimeVariables: {},
      }),
    ).rejects.toThrow(/does not match supervisor command scope/);
  });

  test("reconciles supervised run to completed when target session is terminal", async () => {
    const root = await makeTempDir();
    const workflowName = "sup-reconcile-terminal";
    await writeManagerOnlyWorkflow({
      root,
      workflowName,
      sticky: false,
    });

    const baseOpts = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      sessionStoreRoot: path.join(root, "sessions"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
      mockScenario: {
        "divedra-manager": {
          payload: { reply: "ok" },
          backendSession: { sessionId: "backend-reconcile-1" },
        },
      },
    };

    const binding: EventBinding = {
      id: "b-reconcile",
      sourceId: "s-reconcile",
      workflowName,
      inputMapping: { mode: "event-input" },
      execution: {
        mode: "supervised",
        maxRestartsOnFailure: 3,
        control: { intentMapping: { mode: "structured-only" } },
      },
    };

    const client = createWorkflowSupervisorClient(baseOpts);
    const correlationKey = "corr-reconcile-1";

    const started = await client.dispatchCommand({
      command: {
        commandId: "cmd-reconcile-start",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey,
        action: "start",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-rc-1",
      },
      binding,
      runtimeVariables: {},
    });
    const sessionId = started.supervisedRun.activeTargetExecutionId;
    expect(sessionId).toBeDefined();
    if (sessionId === undefined) {
      return;
    }
    const loaded = await loadSession(sessionId, baseOpts);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const runningByWorkflowExecutionId = await client.status({
      workflowExecutionId: sessionId,
    });
    expect(runningByWorkflowExecutionId.supervisedRun.supervisedRunId).toBe(
      started.supervisedRun.supervisedRunId,
    );

    const completed = {
      ...loaded.value,
      status: "completed" as const,
      endedAt: new Date().toISOString(),
    };
    const saved = await saveSession(completed, baseOpts);
    expect(saved.ok).toBe(true);

    const st = await client.dispatchCommand({
      command: {
        commandId: "cmd-reconcile-status",
        sourceId: binding.sourceId,
        bindingId: binding.id,
        correlationKey,
        action: "status",
        targetWorkflowName: workflowName,
        receivedEventReceiptId: "rx-rc-2",
      },
      binding,
      runtimeVariables: {},
    });
    expect(st.supervisedRun.status).toBe("completed");
    expect(st.supervisedRun.activeTargetExecutionId).toBe(sessionId);

    const terminalByWorkflowExecutionId = await client.status({
      workflowExecutionId: sessionId,
    });
    expect(terminalByWorkflowExecutionId.supervisedRun.status).toBe(
      "completed",
    );
    expect(
      terminalByWorkflowExecutionId.supervisedRun.activeTargetExecutionId,
    ).toBe(sessionId);
    expect(terminalByWorkflowExecutionId.activeTargetStatus).toBe("completed");
  });

  test("library status rejects empty correlation lookup fields", async () => {
    const client = createWorkflowSupervisorClient();

    await expect(
      client.status({
        sourceId: "source-1",
        bindingId: "",
        correlationKey: "corr-1",
      }),
    ).rejects.toThrow("input.bindingId must be a non-empty string");
  });
});
