import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  inspectWorkflowRuntimeReadiness,
  type WorkflowRuntimeRequirement,
} from "./runtime-readiness";
import type { NormalizedWorkflowBundle, NodePayload } from "./types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-runtime-ready-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writeExecutable(
  filePath: string,
  body: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${body}\n`, { mode: 0o755 });
}

function makeBundle(
  nodePayloads: Readonly<Record<string, NodePayload>>,
): NormalizedWorkflowBundle {
  const nodeIds = Object.keys(nodePayloads);
  const managerNodeId = nodeIds[0] ?? "node-1";

  return {
    workflow: {
      workflowId: "runtime-ready",
      description: "runtime readiness fixture",
      defaults: {
        maxLoopIterations: 3,
        nodeTimeoutMs: 120_000,
      },
      managerNodeId,
      subWorkflows: [],
      nodes: nodeIds.map((id, index) => ({
        id,
        kind: index === 0 ? "root-manager" : "task",
        nodeFile: `nodes/node-${id}.json`,
        completion: { type: "none" },
      })),
      edges: [],
      branching: { mode: "fan-out" },
    },
    workflowVis: {
      nodes: nodeIds.map((id, index) => ({ id, order: index })),
    },
    nodePayloads,
  };
}

function findRequirement(
  requirements: readonly WorkflowRuntimeRequirement[],
  id: string,
): WorkflowRuntimeRequirement {
  const requirement = requirements.find((entry) => entry.id === id);
  expect(requirement).toBeDefined();
  return requirement as WorkflowRuntimeRequirement;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("inspectWorkflowRuntimeReadiness", () => {
  test("marks codex-agent and claude-code-agent backends available when local tools are runnable", async () => {
    const root = await makeTempDir();
    const binDir = path.join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await writeExecutable(
      path.join(binDir, "codex"),
      "#!/usr/bin/env bash\necho 'codex-cli 0.116.0'",
    );
    await writeExecutable(
      path.join(binDir, "git"),
      "#!/usr/bin/env bash\necho 'git version 2.53.0'",
    );
    await writeExecutable(
      path.join(root, "node_modules", ".bin", "claude-code-agent"),
      "#!/usr/bin/env bash\ncat <<'EOF'\n{\"agent\":\"0.1.0\",\"tools\":{\"claude\":{\"version\":\"2.1.86\",\"error\":null},\"codex\":{\"version\":\"0.116.0\",\"error\":null},\"git\":{\"version\":\"2.53.0\",\"error\":null}}}\nEOF",
    );

    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        manager: {
          id: "manager",
          executionBackend: "claude-code-agent",
          model: "claude-sonnet-4-5",
          promptTemplate: "manager",
          variables: {},
        },
        worker: {
          id: "worker",
          executionBackend: "codex-agent",
          model: "gpt-5",
          promptTemplate: "worker",
          variables: {},
        },
      }),
      {
        cwd: root,
        env: {
          PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
        },
      },
    );

    expect(readiness.ready).toBe(true);
    expect(
      findRequirement(
        readiness.requirements,
        "agent-backend:claude-code-agent",
      ),
    ).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceNodeIds: ["manager"],
    });
    expect(
      findRequirement(readiness.requirements, "agent-backend:codex-agent"),
    ).toMatchObject({
      kind: "agent-backend",
      status: "available",
      sourceNodeIds: ["worker"],
    });
  });

  test("reports container runner problems and unsupported container execution", async () => {
    const readiness = await inspectWorkflowRuntimeReadiness(
      makeBundle({
        "container-worker": {
          id: "container-worker",
          nodeType: "container",
          variables: {},
          container: {
            runnerPath: "/definitely/missing/podman",
            build: {
              contextPath: "containers/worker",
            },
          },
        },
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(
      findRequirement(
        readiness.requirements,
        "container-runner:podman:/definitely/missing/podman",
      ),
    ).toMatchObject({
      kind: "container-runner",
      status: "unavailable",
      sourceNodeIds: ["container-worker"],
    });
    expect(
      findRequirement(readiness.requirements, "node-executor:container"),
    ).toMatchObject({
      kind: "node-executor",
      status: "unsupported",
      sourceNodeIds: ["container-worker"],
    });
  });
});
