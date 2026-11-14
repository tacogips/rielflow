import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createWorkflowTemplate } from "../workflow/create";
import * as workflowEngine from "../workflow/engine";
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

describe("GraphQL HTTP transport", () => {
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

  test("surfaces runtime readiness failures for nested superviser execution inputs over /graphql", async () => {
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
          message:
            "workflow runtime readiness failed: code-manager runtime: managerType='code' execution is not available on the current runtime path yet; steps=divedra-manager",
        }),
      ],
    });
    expect(runWorkflowSpy).toHaveBeenCalledTimes(1);
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
});
