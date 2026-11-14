import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MockNodeScenario } from "../workflow/scenario-adapter";
import { createWorkflowTemplate } from "../workflow/create";
import { runWorkflow } from "../workflow/engine";
import {
  saveEventReplyDispatchToRuntimeDb,
  saveHookEventToRuntimeDb,
} from "../workflow/runtime-db";
import { handleGraphqlRequest } from "./graphql";
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
describe("GraphQL HTTP transport", () => {
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
        (node) => node.output?.includes("stage") && node.recentLogs.length > 0,
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
      "managerRuntimeId" in
        createJson.data.createWorkflowDefinition.bundle.workflow,
    ).toBe(false);
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
});
