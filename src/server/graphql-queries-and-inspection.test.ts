import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import { createSessionState } from "../workflow/session";
import { saveSession } from "../workflow/session-store";
import { handleGraphqlRequest } from "./graphql";
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-server-graphql-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function makeDefaultTemplateScenario(): MockNodeScenario {
  return {
    "divedra-manager": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "design" },
    },
    "main-worker": {
      provider: "scenario-mock",
      when: { always: true },
      payload: { stage: "implement" },
    },
  };
}
async function createCompletedWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("demo", {
    workflowRoot: root,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const options = {
    workflowRoot: root,
    artifactRoot: path.join(root, "artifacts"),
    rootDataDir: path.join(root, "data"),
    cwd: root,
  };
  const result = await runWorkflow("demo", {
    ...options,
    runtimeVariables: {
      humanInput: {
        request: "start demo workflow",
      },
    },
    mockScenario: makeDefaultTemplateScenario(),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return { options, session: result.value.session };
}
async function createWorkerOnlyWorkflowFixture(root: string) {
  const created = await createWorkflowTemplate("solo", {
    workflowRoot: root,
    templateMode: "worker-only",
  });
  expect(created.ok).toBe(true);
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
}
async function createWorkflowCallWorkflowFixture(root: string) {
  const workflowDir = path.join(root, "workflow-calls");
  await mkdir(path.join(workflowDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(workflowDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "workflow-calls",
        description: "workflow-call http fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        managerStepId: "divedra-manager",
        entryStepId: "divedra-manager",
        nodes: [
          {
            id: "divedra-manager",
            nodeFile: "nodes/node-divedra-manager.json",
          },
          {
            id: "main-worker",
            nodeFile: "nodes/node-main-worker.json",
          },
          {
            id: "apply-review",
            nodeFile: "nodes/node-apply-review.json",
          },
        ],
        steps: [
          {
            id: "divedra-manager",
            nodeId: "divedra-manager",
            role: "manager",
            transitions: [{ toStepId: "main-worker" }],
          },
          {
            id: "main-worker",
            nodeId: "main-worker",
            role: "worker",
            transitions: [
              {
                toStepId: "reviewer",
                toWorkflowId: "review",
                resumeStepId: "apply-review",
              },
            ],
          },
          {
            id: "apply-review",
            nodeId: "apply-review",
            role: "worker",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-divedra-manager.json"),
    `${JSON.stringify(
      {
        id: "divedra-manager",
        executionBackend: "claude-code-agent",
        model: "claude-opus-4-1",
        promptTemplate: "manager",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-main-worker.json"),
    `${JSON.stringify(
      {
        id: "main-worker",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "worker",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(workflowDir, "nodes", "node-apply-review.json"),
    `${JSON.stringify(
      {
        id: "apply-review",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "apply review",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const reviewDir = path.join(root, "review");
  await mkdir(path.join(reviewDir, "nodes"), { recursive: true });
  await writeFile(
    path.join(reviewDir, "workflow.json"),
    `${JSON.stringify(
      {
        workflowId: "review",
        description: "workflow-call http callee fixture",
        defaults: { maxLoopIterations: 3, nodeTimeoutMs: 120000 },
        entryStepId: "reviewer",
        nodes: [
          {
            id: "reviewer",
            nodeFile: "nodes/node-reviewer.json",
          },
        ],
        steps: [
          {
            id: "reviewer",
            nodeId: "reviewer",
            role: "worker",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    path.join(reviewDir, "nodes", "node-reviewer.json"),
    `${JSON.stringify(
      {
        id: "reviewer",
        executionBackend: "codex-agent",
        model: "gpt-5-nano",
        promptTemplate: "review",
        variables: {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    options: {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    },
  };
}
describe("GraphQL HTTP transport", () => {
  test("routes /graphql queries through the GraphQL control-plane handler", async () => {
    const root = await makeTempDir();
    const { options } = await createCompletedWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                hasManagerNode
                managerStepId
                entryStepId
                crossWorkflowDispatchIds
                counts {
                  steps
                  crossWorkflowDispatches
                }
              }
            }
          `,
          variables: {
            workflowName: "demo",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "demo",
          hasManagerNode: true,
          managerStepId: "divedra-manager",
          entryStepId: "divedra-manager",
          crossWorkflowDispatchIds: [],
          counts: {
            steps: 2,
            crossWorkflowDispatches: 0,
          },
        },
      },
    });
  });

  test("does not expose managerRuntimeId for worker-only workflows over /graphql", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkerOnlyWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                hasManagerNode
                entryStepId
                nodeRegistryIds
                crossWorkflowDispatchIds
                counts {
                  steps
                  crossWorkflowDispatches
                }
              }
            }
          `,
          variables: {
            workflowName: "solo",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data?.workflow).toMatchObject({
      workflowId: "solo",
      hasManagerNode: false,
      entryStepId: "main-worker",
      nodeRegistryIds: ["main-worker"],
      crossWorkflowDispatchIds: [],
      counts: {
        steps: 1,
        crossWorkflowDispatches: 0,
      },
    });
  });

  test("reports scaffolded managed starters as not runtime-ready over /graphql", async () => {
    const root = await makeTempDir();
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error(created.error.message);
    }

    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                managerStepId
                entryStepId
                stepIds
                nodeRegistryIds
                counts {
                  nodeRegistry
                  steps
                }
                runtime {
                  ready
                  blockers
                  requirements {
                    id
                    sourceStepIds
                  }
                }
              }
            }
          `,
          variables: {
            workflowName: "demo",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "demo",
          managerStepId: "divedra-manager",
          entryStepId: "divedra-manager",
          stepIds: ["divedra-manager", "main-worker"],
          nodeRegistryIds: ["divedra-manager", "main-worker"],
          counts: {
            nodeRegistry: 2,
            steps: 2,
          },
          runtime: {
            ready: false,
            blockers: expect.arrayContaining([
              expect.stringContaining("code-manager runtime"),
            ]),
            requirements: expect.arrayContaining([
              expect.objectContaining({
                id: "workflow-feature:code-manager-runtime",
                sourceStepIds: ["divedra-manager"],
              }),
            ]),
          },
        },
      },
    });
  });

  test("exposes step-derived cross-workflow calls over /graphql workflow inspection", async () => {
    const root = await makeTempDir();
    const { options } = await createWorkflowCallWorkflowFixture(root);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowByName($workflowName: String!) {
              workflow(workflowName: $workflowName) {
                workflowId
                crossWorkflowDispatchIds
                counts {
                  crossWorkflowDispatches
                }
              }
            }
          `,
          variables: {
            workflowName: "workflow-calls",
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        workflow: {
          workflowId: "workflow-calls",
          crossWorkflowDispatchIds: ["__cw:main-worker"],
          counts: {
            crossWorkflowDispatches: 1,
          },
        },
      },
    });
  });

  test("exposes workflow execution summaries and async execute over /graphql", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);

    const listResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowExecutions($workflowName: String!, $first: Int!) {
              workflowExecutions(workflowName: $workflowName, first: $first) {
                totalCount
                items
              }
            }
          `,
          variables: {
            workflowName: "demo",
            first: 10,
          },
        }),
      }),
      options,
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: {
        workflowExecutions: {
          totalCount: 1,
          items: [
            {
              workflowExecutionId: session.sessionId,
              sessionId: session.sessionId,
              workflowName: "demo",
            },
          ],
        },
      },
    });

    const overviewResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowCatalogOverview {
              workflowCatalogOverview {
                workflows {
                  workflowName
                  sourceScope
                  aggregateStatus
                  activeExecutionCount
                  latestExecution {
                    workflowExecutionId
                  }
                }
              }
            }
          `,
        }),
      }),
      options,
    );

    expect(overviewResponse.status).toBe(200);
    await expect(overviewResponse.json()).resolves.toMatchObject({
      data: {
        workflowCatalogOverview: {
          workflows: [
            expect.objectContaining({
              workflowName: "demo",
              aggregateStatus: "completed",
              activeExecutionCount: 0,
              latestExecution: expect.objectContaining({
                workflowExecutionId: session.sessionId,
              }),
            }),
          ],
        },
      },
    });

    const statusOverviewResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowStatusOverview($workflowName: String!) {
              workflowStatusOverview(workflowName: $workflowName) {
                workflowName
                sourceScope
                workflowDirectory
                aggregateStatus
                recentExecutions {
                  workflowExecutionId
                  sessionId
                  status
                  startedAt
                }
              }
            }
          `,
          variables: {
            workflowName: "demo",
          },
        }),
      }),
      options,
    );

    expect(statusOverviewResponse.status).toBe(200);
    await expect(statusOverviewResponse.json()).resolves.toMatchObject({
      data: {
        workflowStatusOverview: {
          workflowName: "demo",
          sourceScope: "direct",
          aggregateStatus: "completed",
          recentExecutions: [
            expect.objectContaining({
              workflowExecutionId: session.sessionId,
              sessionId: session.sessionId,
              status: "completed",
            }),
          ],
        },
      },
    });

    const executeResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation ExecuteWorkflow($input: ExecuteWorkflowInput!) {
              executeWorkflow(input: $input) {
                workflowExecutionId
                sessionId
                status
                accepted
                exitCode
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              async: true,
              runtimeVariables: {
                humanInput: {
                  request: "start demo workflow",
                },
              },
              mockScenario: makeDefaultTemplateScenario(),
            },
          },
        }),
      }),
      options,
    );

    expect(executeResponse.status).toBe(200);
    await expect(executeResponse.json()).resolves.toMatchObject({
      data: {
        executeWorkflow: {
          workflowExecutionId: expect.any(String),
          sessionId: expect.any(String),
          status: "running",
          accepted: true,
          exitCode: null,
        },
      },
    });
  });

  test("derives currentStepId in workflow execution summaries over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const sessionId = "sess-http-step-summary";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "writer-node",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "writer-node",
        queue: ["writer-node"],
        nodeExecutionCounter: 1,
        nodeExecutionCounts: {
          "writer-node": 1,
        },
        nodeExecutions: [
          {
            nodeId: "writer-node",
            stepId: "writer-step",
            nodeRegistryId: "writer-node",
            nodeExecId: "exec-writer-1",
            mailboxInstanceId: "exec-writer-1",
            status: "succeeded" as const,
            artifactDir: path.join(
              options.artifactRoot,
              "demo",
              sessionId,
              "exec-writer-1",
            ),
            startedAt: "2026-04-24T05:00:00.000Z",
            endedAt: "2026-04-24T05:00:10.000Z",
          },
        ],
      },
      options,
    );
    expect(saved.ok).toBe(true);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowExecutions($workflowName: String!, $first: Int!) {
              workflowExecutions(workflowName: $workflowName, first: $first) {
                totalCount
                items
              }
            }
          `,
          variables: {
            workflowName: "demo",
            first: 10,
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        workflowExecutions: {
          totalCount: 1,
          items: [
            {
              workflowExecutionId: sessionId,
              sessionId,
              workflowName: "demo",
              status: "paused",
              currentNodeId: "writer-node",
              currentStepId: "writer-step",
              nodeExecutionCounter: 1,
              startedAt: expect.any(String),
              endedAt: null,
            },
          ],
        },
      },
    });
  });
});
