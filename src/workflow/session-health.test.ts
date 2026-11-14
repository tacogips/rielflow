import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  saveNodeExecutionToRuntimeDb,
  saveProcessLogsToRuntimeDb,
} from "./runtime-db";
import { buildSessionHealthReport } from "./session-health";
import { createSessionState, type WorkflowSessionState } from "./session";
import { saveSession } from "./session-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-session-health-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

function makeOptions(root: string): {
  readonly artifactRoot: string;
  readonly cwd: string;
  readonly rootDataDir: string;
  readonly sessionStoreRoot: string;
  readonly workflowRoot: string;
} {
  return {
    artifactRoot: path.join(root, "artifacts"),
    cwd: root,
    rootDataDir: path.join(root, "runtime-data"),
    sessionStoreRoot: path.join(root, "sessions"),
    workflowRoot: root,
  };
}

async function persistSession(
  session: WorkflowSessionState,
  options: ReturnType<typeof makeOptions>,
): Promise<void> {
  const saved = await saveSession(session, options);
  expect(saved.ok).toBe(true);
}

function createRunningSession(input: {
  readonly sessionId: string;
  readonly artifactDir: string;
  readonly startedAt?: string;
}): WorkflowSessionState {
  return {
    ...createSessionState({
      sessionId: input.sessionId,
      workflowName: "demo",
      workflowId: "demo",
      initialNodeId: "worker-step",
      runtimeVariables: {},
    }),
    status: "running",
    startedAt: input.startedAt ?? "2026-05-04T00:00:00.000Z",
    currentNodeId: "worker-step",
    queue: ["worker-step"],
    nodeExecutions: [
      {
        nodeId: "worker-step",
        stepId: "worker-step",
        nodeExecId: "node-exec-001",
        status: "succeeded",
        artifactDir: input.artifactDir,
        startedAt: "2026-05-04T00:00:01.000Z",
        endedAt: "2026-05-04T00:00:02.000Z",
        timeoutMs: 120000,
        backendSessionId: "backend-session-1",
      },
    ],
    nodeExecutionCounter: 1,
    nodeExecutionCounts: { "worker-step": 1 },
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("session health", () => {
  test("reports a running session when recent progress evidence is inside the stall window", async () => {
    const root = await makeTempDir();
    const options = makeOptions(root);
    const artifactDir = path.join(
      options.artifactRoot,
      "demo",
      "sess-healthy",
      "node-exec-001",
    );
    await mkdir(artifactDir, { recursive: true });
    await writeFile(path.join(artifactDir, "output.json"), "{}\n", "utf8");
    const session = createRunningSession({
      sessionId: "sess-healthy",
      artifactDir,
    });
    await persistSession(session, options);
    await saveProcessLogsToRuntimeDb(
      {
        sessionId: session.sessionId,
        nodeId: "worker-step",
        nodeExecId: "node-exec-001",
        processLogs: [{ stream: "stdout", text: "still working\n" }],
        at: "2026-05-04T00:00:09.000Z",
      },
      options,
    );

    const report = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 60000,
      observedAt: "2026-05-04T00:00:20.000Z",
    });

    expect(report.health.state).toBe("running");
    expect(report.progressSignal.stalled).toBe(false);
    expect(report.recentLogs).toHaveLength(1);
    expect(report.evidenceCompleteness.sessionStore).toBe("available");
  });

  test("reports a stale non-terminal session as stalled only when a stall timeout is known", async () => {
    const root = await makeTempDir();
    const options = makeOptions(root);
    const session = {
      ...createSessionState({
        sessionId: "sess-stale",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "worker-step",
        runtimeVariables: {},
      }),
      status: "running" as const,
      startedAt: "2026-05-04T00:00:00.000Z",
      currentNodeId: "worker-step",
      queue: ["worker-step"],
    };
    await persistSession(session, options);

    const unknown = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      observedAt: "2030-05-04T00:05:00.000Z",
    });
    const stalled = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 60000,
      observedAt: "2030-05-04T00:05:00.000Z",
    });

    expect(unknown.health.state).toBe("unknown");
    expect(unknown.progressSignal.stallTimeoutMs).toBeNull();
    expect(stalled.health.state).toBe("stalled");
    expect(stalled.progressSignal.stalled).toBe(true);
  });

  test("reports terminal sessions without applying stall classification", async () => {
    const root = await makeTempDir();
    const options = makeOptions(root);
    const session = {
      ...createSessionState({
        sessionId: "sess-terminal",
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "worker-step",
        runtimeVariables: {},
      }),
      status: "failed" as const,
      endedAt: "2026-05-04T00:01:00.000Z",
      lastError: "worker failed",
    };
    await persistSession(session, options);

    const report = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 1,
      observedAt: "2026-05-04T00:05:00.000Z",
    });

    expect(report.health.state).toBe("terminal");
    expect(report.progressSignal.stalled).toBeNull();
    expect(report.health.recommendation).toBe("rerun_step");
  });

  test("surfaces missing artifact paths as partial evidence instead of failing", async () => {
    const root = await makeTempDir();
    const options = makeOptions(root);
    const existingArtifactDir = path.join(
      options.artifactRoot,
      "demo",
      "sess-artifacts",
      "node-exec-001",
    );
    const missingArtifactDir = path.join(
      options.artifactRoot,
      "demo",
      "sess-artifacts",
      "node-exec-missing",
    );
    await mkdir(existingArtifactDir, { recursive: true });
    await writeFile(
      path.join(existingArtifactDir, "candidate-output.json"),
      "{}\n",
      "utf8",
    );
    const session = {
      ...createRunningSession({
        sessionId: "sess-artifacts",
        artifactDir: existingArtifactDir,
      }),
      nodeExecutions: [
        {
          nodeId: "worker-step",
          stepId: "worker-step",
          nodeExecId: "node-exec-001",
          status: "succeeded" as const,
          artifactDir: existingArtifactDir,
          startedAt: "2026-05-04T00:00:01.000Z",
          endedAt: "2026-05-04T00:00:02.000Z",
        },
        {
          nodeId: "worker-step",
          stepId: "worker-step",
          nodeExecId: "node-exec-missing",
          status: "failed" as const,
          artifactDir: missingArtifactDir,
          startedAt: "2026-05-04T00:00:03.000Z",
          endedAt: "2026-05-04T00:00:04.000Z",
        },
      ],
    };
    await persistSession(session, options);

    const report = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 60000,
      observedAt: "2026-05-04T00:00:20.000Z",
    });

    expect(report.evidenceCompleteness.artifacts).toBe("partial");
    expect(report.artifacts.latestCandidateAt).not.toBeNull();
    expect(report.artifacts.recentCandidatePaths).toHaveLength(1);
  });

  test("omits LLM messages by default and includes bounded history only when requested", async () => {
    const root = await makeTempDir();
    const options = makeOptions(root);
    const artifactDir = path.join(
      options.artifactRoot,
      "demo",
      "sess-llm",
      "node-exec-001",
    );
    await mkdir(artifactDir, { recursive: true });
    const session = createRunningSession({
      sessionId: "sess-llm",
      artifactDir,
    });
    await persistSession(session, options);
    await saveNodeExecutionToRuntimeDb(
      {
        sessionId: session.sessionId,
        nodeId: "worker-step",
        stepId: "worker-step",
        nodeExecId: "node-exec-001",
        status: "succeeded",
        artifactDir,
        startedAt: "2026-05-04T00:00:01.000Z",
        endedAt: "2026-05-04T00:00:02.000Z",
        executionOrdinal: 1,
        inputJson: "{}",
        outputJson: JSON.stringify({
          provider: "codex-agent",
          model: "gpt-5.5",
        }),
        inputHash: "input-hash",
        outputHash: "output-hash",
        llmMessages: [
          {
            ordinal: 1,
            eventType: "assistant.message",
            role: "assistant",
            contentText: "first",
            at: "2026-05-04T00:00:03.000Z",
          },
          {
            ordinal: 2,
            eventType: "assistant.message",
            role: "assistant",
            contentText: "second",
            at: "2026-05-04T00:00:04.000Z",
          },
        ],
      },
      options,
    );

    const omitted = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 60000,
      observedAt: "2026-05-04T00:00:20.000Z",
    });
    const included = await buildSessionHealthReport({
      sessionId: session.sessionId,
      options,
      stallTimeoutMs: 60000,
      includeLlmMessages: true,
      llmLimit: 1,
      observedAt: "2026-05-04T00:00:20.000Z",
    });

    expect(omitted.recentLlmMessages).toEqual([]);
    expect(omitted.evidenceCompleteness.llmMessages).toBe("disabled");
    expect(included.recentLlmMessages).toHaveLength(1);
    expect(included.recentLlmMessages[0]?.contentText).toBe("second");
    expect(included.evidenceCompleteness.llmMessages).toBe("available");
  });
});
