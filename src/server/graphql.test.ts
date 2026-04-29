import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MockNodeScenario } from "../workflow/adapter";
import { createWorkflowTemplate } from "../workflow/create";
import * as workflowEngine from "../workflow/engine";
import { runWorkflow } from "../workflow/engine";
import {
  createManagerSessionStore,
  hashManagerAuthToken,
} from "../workflow/manager-session-store";
import {
  saveEventReplyDispatchToRuntimeDb,
  saveHookEventToRuntimeDb,
} from "../workflow/runtime-db";
import { createSessionState } from "../workflow/session";
import { saveSession } from "../workflow/session-store";
import { handleApiRequest } from "./api";
import { executeGraphqlDocument, handleGraphqlRequest } from "./graphql";

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

async function createManagerSession(root: string, workflowExecutionId: string) {
  const store = createManagerSessionStore({
    cwd: root,
    rootDataDir: path.join(root, "data"),
  });
  await store.createOrResumeSession({
    managerSessionId: "mgrsess-000001",
    workflowId: "demo",
    workflowExecutionId,
    managerRuntimeId: "divedra-manager",
    managerNodeExecId: "exec-000001",
    status: "active",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    authTokenHash: hashManagerAuthToken("secret"),
    authTokenExpiresAt: "2099-03-16T00:00:00.000Z",
  });
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

  test("returns nullable managerRuntimeId for worker-only workflows over /graphql", async () => {
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

  test("accepts supervision execution inputs over /graphql", async () => {
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
      sessionStoreRoot: path.join(root, "sessions"),
      cwd: root,
    };
    const sourceSessionId = "sess-http-supervision-source";
    const saved = await saveSession(
      createSessionState({
        sessionId: sourceSessionId,
        workflowName: "demo",
        workflowId: "demo",
        initialNodeId: "divedra-manager",
        runtimeVariables: {},
      }),
      options,
    );
    expect(saved.ok).toBe(true);

    const runWorkflowSpy = vi
      .spyOn(workflowEngine, "runWorkflow")
      .mockResolvedValue({
        ok: true,
        value: {
          session: {
            ...createSessionState({
              sessionId: "sess-http-supervision-result",
              workflowName: "demo",
              workflowId: "demo",
              initialNodeId: "divedra-manager",
              runtimeVariables: {},
            }),
            status: "running" as const,
          },
          exitCode: 0,
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
                status
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              nestedSuperviser: true,
              autoImprove: {
                enabled: true,
                monitorIntervalMs: 6000,
                stallTimeoutMs: 12000,
              },
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
          workflowExecutionId: "sess-http-supervision-result",
          status: "running",
        },
      },
    });

    const resumeResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation ResumeWorkflowExecution($input: ResumeWorkflowExecutionInput!) {
              resumeWorkflowExecution(input: $input) {
                workflowExecutionId
                status
              }
            }
          `,
          variables: {
            input: {
              workflowExecutionId: sourceSessionId,
              nestedSuperviser: true,
              autoImprove: {
                enabled: true,
              },
            },
          },
        }),
      }),
      options,
    );

    expect(resumeResponse.status).toBe(200);
    await expect(resumeResponse.json()).resolves.toMatchObject({
      data: {
        resumeWorkflowExecution: {
          workflowExecutionId: "sess-http-supervision-result",
          status: "running",
        },
      },
    });

    const rerunResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation RerunWorkflowExecution($input: RerunWorkflowExecutionInput!) {
              rerunWorkflowExecution(input: $input) {
                workflowExecutionId
                status
                rerunFromStepId
              }
            }
          `,
          variables: {
            input: {
              workflowExecutionId: sourceSessionId,
              stepId: "main-worker",
              autoImprove: {
                enabled: true,
                maxSupervisedAttempts: 2,
              },
            },
          },
        }),
      }),
      options,
    );

    expect(rerunResponse.status).toBe(200);
    await expect(rerunResponse.json()).resolves.toMatchObject({
      data: {
        rerunWorkflowExecution: {
          workflowExecutionId: "sess-http-supervision-result",
          status: "running",
          rerunFromStepId: "main-worker",
        },
      },
    });

    expect(runWorkflowSpy).toHaveBeenNthCalledWith(
      1,
      "demo",
      expect.objectContaining({
        nestedSuperviserDriver: true,
        autoImprove: expect.objectContaining({
          enabled: true,
          monitorIntervalMs: 6000,
          stallTimeoutMs: 12000,
        }),
      }),
    );
    expect(runWorkflowSpy).toHaveBeenNthCalledWith(
      2,
      "demo",
      expect.objectContaining({
        resumeSessionId: sourceSessionId,
        nestedSuperviserDriver: true,
        autoImprove: expect.objectContaining({
          enabled: true,
        }),
      }),
    );
    expect(runWorkflowSpy).toHaveBeenNthCalledWith(
      3,
      "demo",
      expect.objectContaining({
        rerunFromSessionId: sourceSessionId,
        rerunFromStepId: "main-worker",
        autoImprove: expect.objectContaining({
          enabled: true,
          maxSupervisedAttempts: 2,
        }),
      }),
    );
  });

  test("rejects invalid nested superviser execution inputs over /graphql before runWorkflow", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const runWorkflowSpy = vi.spyOn(workflowEngine, "runWorkflow");

    const response = await handleGraphqlRequest(
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
                status
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              nestedSuperviser: true,
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        expect.objectContaining({
          message: "nestedSuperviser requires autoImprove",
        }),
      ],
    });
    expect(runWorkflowSpy).not.toHaveBeenCalled();
  });

  test("exposes currentStepId on workflowExecution and workflowExecutionOverview session views over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const sessionId = "sess-http-step-session-view";
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
            query WorkflowExecutionSessionViews($workflowExecutionId: String!) {
              workflowExecution(workflowExecutionId: $workflowExecutionId) {
                session {
                  sessionId
                  currentNodeId
                  currentStepId
                }
              }
              workflowExecutionOverview(workflowExecutionId: $workflowExecutionId) {
                session {
                  sessionId
                  currentNodeId
                  currentStepId
                }
              }
            }
          `,
          variables: {
            workflowExecutionId: sessionId,
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        workflowExecution: {
          session: {
            sessionId,
            currentNodeId: "writer-node",
            currentStepId: "writer-step",
          },
        },
        workflowExecutionOverview: {
          session: {
            sessionId,
            currentNodeId: "writer-node",
            currentStepId: "writer-step",
          },
        },
      },
    });
  });

  test("derives currentStepId from authored workflow state before the first execution record exists over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };
    const created = await createWorkflowTemplate("demo", {
      workflowRoot: root,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const sessionId = "sess-http-current-target";
    const saved = await saveSession(
      {
        ...createSessionState({
          sessionId,
          workflowName: "demo",
          workflowId: "demo",
          initialNodeId: "divedra-manager",
          runtimeVariables: {},
        }),
        status: "paused" as const,
        currentNodeId: "main-worker",
        queue: ["main-worker"],
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
            query WorkflowExecutionCurrentTarget($workflowName: String!, $workflowExecutionId: String!) {
              workflowExecutions(workflowName: $workflowName, first: 10) {
                items
              }
              workflowExecution(workflowExecutionId: $workflowExecutionId) {
                session {
                  currentNodeId
                  currentStepId
                }
              }
            }
          `,
          variables: {
            workflowName: "demo",
            workflowExecutionId: sessionId,
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        workflowExecutions: {
          items: [
            {
              workflowExecutionId: sessionId,
              sessionId,
              workflowName: "demo",
              status: "paused",
              currentNodeId: "main-worker",
              currentStepId: "main-worker",
              nodeExecutionCounter: 0,
              startedAt: expect.any(String),
              endedAt: null,
            },
          ],
        },
        workflowExecution: {
          session: {
            currentNodeId: "main-worker",
            currentStepId: "main-worker",
          },
        },
      },
    });
  });

  test("exposes workingDirectory on resume workflow execution GraphQL input", async () => {
    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query ResumeWorkflowExecutionInputFields {
              __type(name: "ResumeWorkflowExecutionInput") {
                inputFields {
                  name
                }
              }
            }
          `,
        }),
      }),
      {},
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        __type: {
          inputFields: expect.arrayContaining([
            { name: "workflowExecutionId" },
            { name: "workingDirectory" },
          ]),
        },
      },
    });
  });

  test("exposes stepId on rerun workflow execution GraphQL input and payload", async () => {
    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query RerunWorkflowExecutionTypes {
              inputType: __type(name: "RerunWorkflowExecutionInput") {
                inputFields {
                  name
                }
              }
              payloadType: __type(name: "RerunWorkflowExecutionPayload") {
                fields {
                  name
                }
              }
            }
          `,
        }),
      }),
      {},
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        inputType: {
          inputFields: expect.arrayContaining([
            { name: "workflowExecutionId" },
            { name: "stepId" },
          ]),
        },
        payloadType: {
          fields: expect.arrayContaining([{ name: "rerunFromStepId" }]),
        },
      },
    });
  });

  test("exposes workflow execution overview over /graphql", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await saveHookEventToRuntimeDb(
      {
        hookEventId: "hook-http-1",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "manager",
        nodeExecId: "manager-exec-1",
        vendor: "claude-code",
        agentSessionId: "agent-session-http",
        rawEventName: "SessionStart",
        eventName: "SessionStart",
        cwd: root,
        payloadHash: "b".repeat(64),
        status: "recorded",
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );
    await saveEventReplyDispatchToRuntimeDb(
      {
        idempotencyKey: "reply-http-key",
        sourceId: "webhook",
        provider: "webhook",
        workflowId: session.workflowId,
        workflowExecutionId: session.sessionId,
        nodeId: "reply-node",
        nodeExecId: "reply-exec-1",
        eventId: "event-http-1",
        conversationId: "conversation-http",
        status: "sent",
        providerMessageId: "message-http",
        requestJson: JSON.stringify({ message: { text: "hello" } }),
        responseJson: JSON.stringify({ providerMessageId: "message-http" }),
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      options,
    );

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowExecutionOverview($workflowExecutionId: String!) {
              workflowExecutionOverview(workflowExecutionId: $workflowExecutionId) {
                workflowExecutionId
                workflowId
                workflowName
                status
                nodes {
                  nodeId
                  nodeExecId
                  backendSessionId
                  backendSessionMode
                  output
                  recentLogs {
                    message
                  }
                }
                communications {
                  totalCount
                  items {
                    record {
                      communicationId
                      fromNodeId
                      toNodeId
                      status
                    }
                    artifactSnapshot {
                      outboxMessageJson
                      outboxOutputRaw
                      inboxMessageJson
                    }
                  }
                }
                hookEvents {
                  agentSessionId
                  rawEventName
                  status
                }
                replyDispatches {
                  idempotencyKey
                  providerMessageId
                  status
                }
              }
            }
          `,
          variables: {
            workflowExecutionId: session.sessionId,
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      readonly data?: {
        readonly workflowExecutionOverview?: {
          readonly workflowExecutionId: string;
          readonly workflowId: string;
          readonly workflowName: string;
          readonly status: string;
          readonly nodes: readonly {
            readonly output: string | null;
            readonly recentLogs: readonly { readonly message: string }[];
          }[];
          readonly communications: {
            readonly totalCount: number;
            readonly items: readonly {
              readonly artifactSnapshot: {
                readonly outboxMessageJson: string | null;
                readonly outboxOutputRaw: string | null;
                readonly inboxMessageJson: string | null;
              };
            }[];
          };
          readonly hookEvents: readonly {
            readonly agentSessionId: string;
            readonly rawEventName: string;
            readonly status: string;
          }[];
          readonly replyDispatches: readonly {
            readonly idempotencyKey: string;
            readonly providerMessageId: string | null;
            readonly status: string;
          }[];
        };
      };
    };

    expect(payload.data?.workflowExecutionOverview?.workflowExecutionId).toBe(
      session.sessionId,
    );
    expect(payload.data?.workflowExecutionOverview?.workflowId).toBe("demo");
    expect(payload.data?.workflowExecutionOverview?.workflowName).toBe("demo");
    expect(payload.data?.workflowExecutionOverview?.status).toBe(
      session.status,
    );
    expect(
      payload.data?.workflowExecutionOverview?.communications.totalCount,
    ).toBeGreaterThan(0);
    expect(payload.data?.workflowExecutionOverview?.hookEvents).toEqual([
      {
        agentSessionId: "agent-session-http",
        rawEventName: "SessionStart",
        status: "recorded",
      },
    ]);
    expect(payload.data?.workflowExecutionOverview?.replyDispatches).toEqual([
      {
        idempotencyKey: "reply-http-key",
        providerMessageId: "message-http",
        status: "sent",
      },
    ]);
    expect(
      payload.data?.workflowExecutionOverview?.nodes.some(
        (node) =>
          node.output !== null &&
          node.output.includes("stage") &&
          node.recentLogs.length > 0,
      ),
    ).toBe(true);
    expect(
      payload.data?.workflowExecutionOverview?.communications.items.some(
        (item) =>
          item.artifactSnapshot.outboxOutputRaw !== null &&
          item.artifactSnapshot.inboxMessageJson !== null,
      ),
    ).toBe(true);
  });

  test("exposes workflow-definition list/load/create/save/validate over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const createResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateWorkflowDefinition($input: CreateWorkflowDefinitionInput!) {
              createWorkflowDefinition(input: $input) {
                workflowName
                revision
                bundle
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
            },
          },
        }),
      }),
      options,
    );
    expect(createResponse.status).toBe(200);
    const createJson = (await createResponse.json()) as {
      readonly data: {
        readonly createWorkflowDefinition: {
          readonly workflowName: string;
          readonly revision: string;
          readonly bundle: Record<string, unknown>;
        };
      };
    };
    expect(createJson).toMatchObject({
      data: {
        createWorkflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
        },
      },
    });

    const listResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query Workflows {
              workflows
            }
          `,
        }),
      }),
      options,
    );
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: {
        workflows: ["demo"],
      },
    });

    const loadResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            query WorkflowDefinition($workflowName: String!) {
              workflowDefinition(workflowName: $workflowName) {
                workflowName
                revision
                bundle
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
    expect(loadResponse.status).toBe(200);
    const loadJson = (await loadResponse.json()) as {
      readonly data: {
        readonly workflowDefinition: {
          readonly workflowName: string;
          readonly revision: string;
          readonly bundle: Record<string, unknown>;
        };
      };
    };
    expect(loadJson).toMatchObject({
      data: {
        workflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
        },
      },
    });

    const validBundle = cloneJson(loadJson.data.workflowDefinition.bundle) as {
      workflow: {
        description: string;
        nodes: unknown[];
      };
    } & Record<string, unknown>;
    validBundle.workflow.description = "Updated through GraphQL";
    const saveResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SaveWorkflowDefinition($input: SaveWorkflowDefinitionInput!) {
              saveWorkflowDefinition(input: $input) {
                workflowName
                workflowDirectory
                revision
                error
                currentRevision
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              bundle: validBundle,
            },
          },
        }),
      }),
      options,
    );
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toMatchObject({
      data: {
        saveWorkflowDefinition: {
          workflowName: "demo",
          revision: expect.any(String),
          error: null,
        },
      },
    });

    const savedWorkflowJson = await readFile(
      path.join(root, "demo", "workflow.json"),
      "utf8",
    );
    expect(savedWorkflowJson).toContain(
      '"description": "Updated through GraphQL"',
    );

    const invalidBundle = cloneJson(validBundle) as typeof validBundle;
    invalidBundle.workflow.nodes = [];
    const validateResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation ValidateWorkflowDefinition($input: ValidateWorkflowDefinitionInput!) {
              validateWorkflowDefinition(input: $input) {
                valid
                issues
              }
            }
          `,
          variables: {
            input: {
              workflowName: "demo",
              bundle: invalidBundle,
            },
          },
        }),
      }),
      options,
    );
    expect(validateResponse.status).toBe(200);
    await expect(validateResponse.json()).resolves.toMatchObject({
      data: {
        validateWorkflowDefinition: {
          valid: false,
          issues: expect.any(Array),
        },
      },
    });
  });

  test("creates worker-only workflow definitions over /graphql", async () => {
    const root = await makeTempDir();
    const options = {
      workflowRoot: root,
      artifactRoot: path.join(root, "artifacts"),
      rootDataDir: path.join(root, "data"),
      cwd: root,
    };

    const createResponse = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation CreateWorkflowDefinition($input: CreateWorkflowDefinitionInput!) {
              createWorkflowDefinition(input: $input) {
                workflowName
                bundle
              }
            }
          `,
          variables: {
            input: {
              workflowName: "solo",
              templateMode: "WORKER_ONLY",
            },
          },
        }),
      }),
      options,
    );
    expect(createResponse.status).toBe(200);
    const createJson = (await createResponse.json()) as {
      readonly data: {
        readonly createWorkflowDefinition: {
          readonly workflowName: string;
          readonly bundle: {
            readonly workflow: {
              readonly hasManagerNode: boolean;
              readonly managerRuntimeId?: string;
              readonly entryNodeId?: string;
              readonly managerStepId?: string;
              readonly entryStepId?: string;
            };
          };
        };
      };
    };
    expect(createJson.data.createWorkflowDefinition.workflowName).toBe("solo");
    expect(
      createJson.data.createWorkflowDefinition.bundle.workflow.hasManagerNode,
    ).toBe(false);
    expect(
      createJson.data.createWorkflowDefinition.bundle.workflow.entryStepId,
    ).toBe("main-worker");
    expect(
      createJson.data.createWorkflowDefinition.bundle.workflow.managerStepId,
    ).toBeUndefined();
    expect(
      createJson.data.createWorkflowDefinition.bundle.workflow.managerRuntimeId,
    ).toBeUndefined();
    expect(
      createJson.data.createWorkflowDefinition.bundle.workflow.entryNodeId,
    ).toBeUndefined();

    const workflowJsonText = await readFile(
      path.join(root, "solo", "workflow.json"),
      "utf8",
    );
    expect(workflowJsonText).not.toContain('"managerRuntimeId"');
    expect(workflowJsonText).toContain('"entryStepId": "main-worker"');
  });

  test("authenticates manager mutations over /graphql with bearer auth", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
                managerSessionId
                queuedNodeIds
                parsedIntent {
                  kind
                  targetId
                }
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-send",
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        sendManagerMessage: {
          accepted: true,
          managerSessionId: "mgrsess-000001",
          queuedNodeIds: ["main-worker"],
          parsedIntent: [
            {
              kind: "retry-step",
              targetId: "main-worker",
            },
          ],
        },
      },
    });
  });

  test("uses forwarded ambient manager session context for manager mutations", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
          "x-divedra-manager-session-id": "mgrsess-000001",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
                managerSessionId
                queuedNodeIds
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-ambient-send",
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        sendManagerMessage: {
          accepted: true,
          managerSessionId: "mgrsess-000001",
          queuedNodeIds: ["main-worker"],
        },
      },
    });
  });

  test("does not inherit manager auth from server-local ambient env for HTTP requests", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-no-env-fallback",
            },
          },
        }),
      }),
      {
        ...options,
        env: {
          DIVEDRA_MANAGER_AUTH_TOKEN: "secret",
          DIVEDRA_MANAGER_SESSION_ID: "mgrsess-000001",
          DIVEDRA_WORKFLOW_ID: "demo",
          DIVEDRA_WORKFLOW_EXECUTION_ID: session.sessionId,
          DIVEDRA_MANAGER_RUNTIME_ID: "divedra-manager",
          DIVEDRA_MANAGER_NODE_EXEC_ID: "exec-000001",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message:
            "managerSessionId is required for manager-scoped GraphQL operations",
        },
      ],
    });
  });

  test("does not trust caller-provided GraphQL context auth fallback for HTTP requests", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
              idempotencyKey: "idem-http-no-context-fallback",
            },
          },
        }),
      }),
      {
        ...options,
        authToken: "secret",
        managerSessionId: "mgrsess-000001",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message:
            "managerSessionId is required for manager-scoped GraphQL operations",
        },
      ],
    });
  });

  test("preserves direct in-process manager auth context for executeGraphqlDocument", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const result = await executeGraphqlDocument(
      `
        mutation SendMessage($input: SendManagerMessageInput!) {
          sendManagerMessage(input: $input) {
            accepted
            managerSessionId
            queuedNodeIds
          }
        }
      `,
      {
        ...options,
        authToken: "secret",
        managerSessionId: "mgrsess-000001",
      },
      {
        variables: {
          input: {
            workflowId: "demo",
            workflowExecutionId: session.sessionId,
            message: "Retry the main worker node.",
            actions: [{ type: "retry-step", stepId: "main-worker" }],
            idempotencyKey: "idem-direct-context-auth",
          },
        },
      },
    );

    expect(result).toMatchObject({
      sendManagerMessage: {
        accepted: true,
        managerSessionId: "mgrsess-000001",
        queuedNodeIds: ["main-worker"],
      },
    });
  });

  test("rejects legacy managerRuntimeId on sendManagerMessage GraphQL input", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const response = await handleGraphqlRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              managerRuntimeId: "divedra-manager",
              message: "Retry the main worker node.",
              actions: [{ type: "retry-step", stepId: "main-worker" }],
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toBeNull();
    expect(payload.errors).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          'Field "managerRuntimeId" is not defined by type "SendManagerMessageInput"',
        ),
      }),
    ]);
  });

  test("rejects manager attachments outside the authenticated workflow execution namespace", async () => {
    const root = await makeTempDir();
    const { options, session } = await createCompletedWorkflowFixture(root);
    await createManagerSession(root, session.sessionId);

    const foreignAttachmentDir = path.join(
      options.rootDataDir,
      "files",
      "demo",
      "wfexec-foreign",
      "attachments",
    );
    await mkdir(foreignAttachmentDir, { recursive: true });
    await writeFile(
      path.join(foreignAttachmentDir, "foreign.txt"),
      "foreign",
      "utf8",
    );

    const response = await handleApiRequest(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          query: `
            mutation SendMessage($input: SendManagerMessageInput!) {
              sendManagerMessage(input: $input) {
                accepted
              }
            }
          `,
          variables: {
            input: {
              workflowId: "demo",
              workflowExecutionId: session.sessionId,
              managerSessionId: "mgrsess-000001",
              message: "Inspect the unrelated file.",
              attachments: [
                {
                  path: "files/demo/wfexec-foreign/attachments/foreign.txt",
                  mediaType: "text/plain",
                },
              ],
            },
          },
        }),
      }),
      options,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: null,
      errors: [
        {
          message: `attachment path must stay within files/demo/${session.sessionId}/`,
        },
      ],
    });
  });
});
