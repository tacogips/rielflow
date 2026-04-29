import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createSessionState } from "./session";
import { ok, type Result } from "./result";
import { saveSession } from "./session-store";
import {
  buildSuperviserRuntimeControl,
  workflowRunBaseForSuperviserControl,
} from "./superviser-runtime-control-impl";
import type { AutoImprovePolicy } from "./types";
import type { SuperviserRuntimeControl } from "./superviser-control";
import type {
  WorkflowRunFailure,
  WorkflowRunOptions,
  WorkflowRunResult,
} from "./engine";

const defaultPolicy: AutoImprovePolicy = {
  enabled: true,
  monitorIntervalMs: 25,
  stallTimeoutMs: 90_000,
  maxSupervisedAttempts: 3,
  maxWorkflowPatches: 1,
  workflowMutationMode: "execution-copy",
};

async function writeStepAddressedWorkflowBundle(input: {
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly workflowId: string;
}): Promise<void> {
  const workflowDir = path.join(input.workflowRoot, input.workflowName);
  await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: input.workflowId,
        description: "target workflow",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "manager-step",
        entryStepId: "manager-step",
        nodes: [
          {
            id: "manager-node",
            nodeFile: "nodes/node-manager.json",
          },
          {
            id: "worker-node",
            nodeFile: "nodes/node-worker.json",
          },
        ],
        steps: [
          {
            id: "manager-step",
            nodeId: "manager-node",
            transitions: [{ toStepId: "worker-step" }],
          },
          {
            id: "worker-step",
            nodeId: "worker-node",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(workflowDir, "nodes/node-manager.json"),
    `${JSON.stringify(
      {
        id: "manager-node",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "manager",
        variables: {},
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(workflowDir, "nodes/node-worker.json"),
    `${JSON.stringify(
      {
        id: "worker-node",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      null,
      2,
    )}\n`,
  );
}

async function saveTargetSessionFixture(input: {
  readonly sessionStoreRoot: string;
  readonly sessionId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly initialNodeId: string;
  readonly currentNodeId?: string;
  readonly mutableWorkflowDir?: string;
}): Promise<void> {
  const session = createSessionState({
    sessionId: input.sessionId,
    workflowName: input.workflowName,
    workflowId: input.workflowId,
    initialNodeId: input.initialNodeId,
    runtimeVariables: {},
  });
  const saved = await saveSession(
    {
      ...session,
      ...(input.currentNodeId === undefined
        ? {}
        : { currentNodeId: input.currentNodeId }),
      ...(input.mutableWorkflowDir === undefined
        ? {}
        : {
            supervision: {
              supervisionRunId: "sup-test",
              targetWorkflowId: input.workflowId,
              superviserWorkflowId: "divedra-default-superviser",
              status: "running",
              attemptCount: 1,
              workflowPatchCount: 0,
              mutableWorkflowDir: input.mutableWorkflowDir,
              incidents: [],
            },
          }),
    },
    { sessionStoreRoot: input.sessionStoreRoot },
  );
  expect(saved.ok).toBe(true);
}

function unexpectedRunWorkflow(): Promise<
  Result<WorkflowRunResult, WorkflowRunFailure>
> {
  throw new Error("runWorkflow should not be called in this test");
}

describe("buildSuperviserRuntimeControl", () => {
  test("startTargetWorkflow merges addon runtimeVariables into the resumed target run", async () => {
    const workflowRoot = await mkdtemp(
      path.join(tmpdir(), "divedra-superviser-start-"),
    );
    const sessionStoreRoot = path.join(workflowRoot, "sessions");
    const recordedCalls: WorkflowRunOptions[] = [];
    const auth = {
      supervisionRunId: "sup-1",
      targetSessionId: "target-session-1",
    };
    try {
      await saveTargetSessionFixture({
        sessionStoreRoot,
        sessionId: auth.targetSessionId,
        workflowName: "target-workflow-name",
        workflowId: "target-workflow-id",
        initialNodeId: "manager",
      });
      const control = buildSuperviserRuntimeControl({
        base: workflowRunBaseForSuperviserControl({
          sessionStoreRoot,
          runtimeVariables: {
            shared: "base",
            preserved: true,
          },
        }),
        runWorkflow: async (
          workflowName: string,
          options: WorkflowRunOptions,
        ): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> => {
          recordedCalls.push(options);
          return ok({
            session: createSessionState({
              sessionId: auth.targetSessionId,
              workflowName,
              workflowId: "target-workflow-id",
              initialNodeId: "manager",
              runtimeVariables: options.runtimeVariables ?? {},
            }),
            exitCode: 0,
          });
        },
        auth,
        targetWorkflowName: "target-workflow-name",
        targetExpectedWorkflowId: "target-workflow-id",
        defaultPolicy,
      });

      const result = await control.startTargetWorkflow({
        workflowId: "target-workflow-id",
        runtimeVariables: {
          shared: "addon",
          fromAddon: 1,
        },
      });

      expect(result.ok).toBe(true);
      expect(recordedCalls).toHaveLength(1);
      expect(recordedCalls[0]?.resumeSessionId).toBe(auth.targetSessionId);
      expect(recordedCalls[0]?.runtimeVariables).toEqual({
        shared: "addon",
        preserved: true,
        fromAddon: 1,
      });
      expect(recordedCalls[0]?.autoImprove).toEqual(defaultPolicy);
    } finally {
      await rm(workflowRoot, { recursive: true, force: true });
    }
  });

  test("rerunTargetWorkflow derives rerunFromStepId from the persisted target session when omitted", async () => {
    const workflowRoot = await mkdtemp(
      path.join(tmpdir(), "divedra-superviser-control-"),
    );
    const sessionStoreRoot = path.join(workflowRoot, "sessions");
    const auth = {
      supervisionRunId: "sup-2",
      targetSessionId: "target-session-2",
    };
    const recordedCalls: WorkflowRunOptions[] = [];

    try {
      await writeStepAddressedWorkflowBundle({
        workflowRoot,
        workflowName: "target-workflow-name",
        workflowId: "target-workflow-id",
      });

      const persisted = {
        ...createSessionState({
          sessionId: auth.targetSessionId,
          workflowName: "target-workflow-name",
          workflowId: "target-workflow-id",
          initialNodeId: "manager-step",
          runtimeVariables: {},
        }),
        currentNodeId: "worker-step",
      };
      const saved = await saveSession(persisted, { sessionStoreRoot });
      expect(saved.ok).toBe(true);

      const control = buildSuperviserRuntimeControl({
        base: workflowRunBaseForSuperviserControl({
          workflowRoot,
          sessionStoreRoot,
        }),
        runWorkflow: async (
          workflowName: string,
          options: WorkflowRunOptions,
        ): Promise<Result<WorkflowRunResult, WorkflowRunFailure>> => {
          recordedCalls.push(options);
          return ok({
            session: createSessionState({
              sessionId: "rerun-session-1",
              workflowName,
              workflowId: "target-workflow-id",
              initialNodeId: "manager-step",
              runtimeVariables: {},
            }),
            exitCode: 0,
          });
        },
        auth,
        targetWorkflowName: "target-workflow-name",
        targetExpectedWorkflowId: "target-workflow-id",
        defaultPolicy,
      });

      const result = await control.rerunTargetWorkflow({
        sessionId: auth.targetSessionId,
      });

      expect(result.ok).toBe(true);
      expect(recordedCalls).toHaveLength(1);
      expect(recordedCalls[0]?.rerunFromSessionId).toBe(auth.targetSessionId);
      expect(recordedCalls[0]?.rerunFromStepId).toBe("worker-step");
      expect(recordedCalls[0]?.autoImprove).toEqual(defaultPolicy);
    } finally {
      await rm(workflowRoot, { recursive: true, force: true });
    }
  });

  test("loadWorkflowDefinition reads the mutable bundle from the verified target session", async () => {
    const workflowRoot = await mkdtemp(
      path.join(tmpdir(), "divedra-superviser-control-load-"),
    );
    const sessionStoreRoot = path.join(workflowRoot, "sessions");
    const mutableWorkflowName = "mutable-target";
    const mutableWorkflowDir = path.join(workflowRoot, mutableWorkflowName);
    const auth = {
      supervisionRunId: "sup-load",
      targetSessionId: "target-session-load",
    };

    try {
      await writeStepAddressedWorkflowBundle({
        workflowRoot,
        workflowName: mutableWorkflowName,
        workflowId: "target-workflow-id",
      });
      await saveTargetSessionFixture({
        sessionStoreRoot,
        sessionId: auth.targetSessionId,
        workflowName: "target-workflow-name",
        workflowId: "target-workflow-id",
        initialNodeId: "manager-step",
        mutableWorkflowDir,
      });

      const control = buildSuperviserRuntimeControl({
        base: workflowRunBaseForSuperviserControl({
          workflowRoot,
          sessionStoreRoot,
        }),
        runWorkflow: async () => unexpectedRunWorkflow(),
        auth,
        targetWorkflowName: "target-workflow-name",
        targetExpectedWorkflowId: "target-workflow-id",
        defaultPolicy,
      });

      const result = await control.loadWorkflowDefinition({
        workflowId: "target-workflow-id",
        mutableWorkflowDir,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.bundle).toMatchObject({
        workflow: {
          workflowId: "target-workflow-id",
          entryStepId: "manager-step",
        },
      });
    } finally {
      await rm(workflowRoot, { recursive: true, force: true });
    }
  });

  test("saveWorkflowDefinition writes the mutable bundle for the verified target session", async () => {
    const workflowRoot = await mkdtemp(
      path.join(tmpdir(), "divedra-superviser-control-save-"),
    );
    const sessionStoreRoot = path.join(workflowRoot, "sessions");
    const mutableWorkflowName = "mutable-target";
    const mutableWorkflowDir = path.join(workflowRoot, mutableWorkflowName);
    const auth = {
      supervisionRunId: "sup-save",
      targetSessionId: "target-session-save",
    };

    try {
      await writeStepAddressedWorkflowBundle({
        workflowRoot,
        workflowName: mutableWorkflowName,
        workflowId: "target-workflow-id",
      });
      await saveTargetSessionFixture({
        sessionStoreRoot,
        sessionId: auth.targetSessionId,
        workflowName: "target-workflow-name",
        workflowId: "target-workflow-id",
        initialNodeId: "manager-step",
        mutableWorkflowDir,
      });

      const control = buildSuperviserRuntimeControl({
        base: workflowRunBaseForSuperviserControl({
          workflowRoot,
          sessionStoreRoot,
        }),
        runWorkflow: async () => unexpectedRunWorkflow(),
        auth,
        targetWorkflowName: "target-workflow-name",
        targetExpectedWorkflowId: "target-workflow-id",
        defaultPolicy,
      });

      const result = await control.saveWorkflowDefinition({
        workflowId: "target-workflow-id",
        mutableWorkflowDir,
        bundle: {
          workflow: {
            workflowId: "target-workflow-id",
            description: "updated via runtime control",
            defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
            managerStepId: "manager-step",
            entryStepId: "manager-step",
            nodes: [
              {
                id: "manager-node",
                nodeFile: "nodes/node-manager.json",
              },
              {
                id: "worker-node",
                nodeFile: "nodes/node-worker.json",
              },
            ],
            steps: [
              {
                id: "manager-step",
                nodeId: "manager-node",
                transitions: [{ toStepId: "worker-step" }],
              },
              {
                id: "worker-step",
                nodeId: "worker-node",
              },
            ],
          },
          nodePayloads: {
            "nodes/node-manager.json": {
              id: "manager-node",
              executionBackend: "codex-agent",
              model: "gpt-5-nano",
              promptTemplate: "manager",
              variables: {},
            },
            "nodes/node-worker.json": {
              id: "worker-node",
              executionBackend: "codex-agent",
              model: "gpt-5-nano",
              promptTemplate: "worker",
              variables: {},
            },
          },
        },
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      const savedWorkflowJson = await readFile(
        path.join(mutableWorkflowDir, "workflow.json"),
        "utf8",
      );
      expect(savedWorkflowJson).toContain("updated via runtime control");
    } finally {
      await rm(workflowRoot, { recursive: true, force: true });
    }
  });

  test("loadWorkflowDefinition rejects persisted target sessions from a different workflow", async () => {
    const workflowRoot = await mkdtemp(
      path.join(tmpdir(), "divedra-superviser-control-mismatch-"),
    );
    const sessionStoreRoot = path.join(workflowRoot, "sessions");
    const mutableWorkflowName = "mutable-target";
    const mutableWorkflowDir = path.join(workflowRoot, mutableWorkflowName);
    const auth = {
      supervisionRunId: "sup-mismatch",
      targetSessionId: "target-session-mismatch",
    };

    try {
      await writeStepAddressedWorkflowBundle({
        workflowRoot,
        workflowName: mutableWorkflowName,
        workflowId: "wrong-workflow-id",
      });
      await saveTargetSessionFixture({
        sessionStoreRoot,
        sessionId: auth.targetSessionId,
        workflowName: "target-workflow-name",
        workflowId: "wrong-workflow-id",
        initialNodeId: "manager-step",
        mutableWorkflowDir,
      });

      const control = buildSuperviserRuntimeControl({
        base: workflowRunBaseForSuperviserControl({
          workflowRoot,
          sessionStoreRoot,
        }),
        runWorkflow: async () => unexpectedRunWorkflow(),
        auth,
        targetWorkflowName: "target-workflow-name",
        targetExpectedWorkflowId: "target-workflow-id",
        defaultPolicy,
      });

      const result = await control.loadWorkflowDefinition({
        workflowId: "target-workflow-id",
        mutableWorkflowDir,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("persisted target session workflowId");
      }
    } finally {
      await rm(workflowRoot, { recursive: true, force: true });
    }
  });
});

describe("workflowRunBaseForSuperviserControl", () => {
  test("strips nested superviser and session-routing fields but keeps load context", () => {
    const w = workflowRunBaseForSuperviserControl({
      workflowRoot: "/w",
      sessionStoreRoot: "/s",
      runtimeVariables: { a: 1 },
      nestedSuperviserDriver: true,
      superviserControl: {} as unknown as SuperviserRuntimeControl,
      autoImprove: defaultPolicy,
      supervisionLoopExecution: true,
      resumeSessionId: "resume-sid",
      rerunFromSessionId: "rerun-sid",
      rerunFromStepId: "s1",
      sessionId: "outer-sid",
    });
    expect(w.nestedSuperviserDriver).toBeUndefined();
    expect(w.superviserControl).toBeUndefined();
    expect(w.autoImprove).toBeUndefined();
    expect(w.supervisionLoopExecution).toBeUndefined();
    expect(w.resumeSessionId).toBeUndefined();
    expect(w.rerunFromSessionId).toBeUndefined();
    expect(w.rerunFromStepId).toBeUndefined();
    expect(w.sessionId).toBeUndefined();
    expect(w.workflowRoot).toBe("/w");
    expect(w.sessionStoreRoot).toBe("/s");
    expect(w.runtimeVariables).toEqual({ a: 1 });
  });
});
