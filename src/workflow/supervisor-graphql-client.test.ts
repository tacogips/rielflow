import { describe, expect, test, vi } from "vitest";
import type { EventBinding } from "../events/types";
import {
  createWorkflowSupervisorGraphqlClient,
  postDispatchSupervisorConversationThroughGraphql,
} from "./supervisor-graphql-client";

function buildBinding(): EventBinding {
  return {
    id: "binding-1",
    sourceId: "source-1",
    workflowName: "demo",
    inputMapping: { mode: "event-input" },
    execution: {
      mode: "supervised",
      control: {
        intentMapping: { mode: "structured-only" },
      },
    },
  };
}

function buildSuccessfulPayload() {
  const now = "2026-04-29T00:00:00.000Z";
  return {
    data: {
      dispatchSupervisedWorkflowCommand: {
        supervisedRun: {
          supervisedRunId: "esv-remote-1",
          sourceId: "source-1",
          bindingId: "binding-1",
          correlationKey: "corr-1",
          supervisorWorkflowName: "divedra-default-workflow-supervisor",
          targetWorkflowName: "demo",
          activeTargetExecutionId: "sess-1",
          status: "running",
          restartCount: 0,
          maxRestartsOnFailure: 3,
          autoImproveEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
        activeTargetStatus: "running",
      },
    },
  };
}

function buildSupervisedWorkflowRunPayload() {
  return {
    data: {
      supervisedWorkflowRun:
        buildSuccessfulPayload().data.dispatchSupervisedWorkflowCommand,
    },
  };
}

function parseRequestBody(call: unknown): {
  readonly query?: string;
  readonly variables?: {
    readonly input?: Record<string, unknown>;
  };
} {
  const tuple = call as readonly [unknown, RequestInit | undefined];
  const rawBody = tuple[1]?.body;
  if (typeof rawBody !== "string") {
    throw new Error("expected string request body");
  }
  return JSON.parse(rawBody) as {
    readonly query?: string;
    readonly variables?: {
      readonly input?: Record<string, unknown>;
    };
  };
}

describe("createWorkflowSupervisorGraphqlClient", () => {
  test("uses idempotencyKey as the remote supervisor command id", async () => {
    const fetchImpl = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit) => {
        const rawBody = init?.body;
        if (typeof rawBody !== "string") {
          throw new Error("expected string request body");
        }
        const parsed = JSON.parse(rawBody) as {
          readonly variables?: {
            readonly input?: {
              readonly command?: {
                readonly commandId?: string;
              };
            };
          };
        };
        expect(parsed.variables?.input?.command?.commandId).toBe(
          "stable-graphql-start",
        );
        return new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as typeof fetch;

    const client = createWorkflowSupervisorGraphqlClient({
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    const view = await client.start({
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      targetWorkflowName: "demo",
      bindingSnapshot: buildBinding(),
      idempotencyKey: "stable-graphql-start",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(view.supervisedRun.supervisedRunId).toBe("esv-remote-1");
  });

  test("rejects malformed supervised run payloads from GraphQL", async () => {
    const fetchImpl = vi.fn(async () => {
      const payload = buildSuccessfulPayload();
      payload.data.dispatchSupervisedWorkflowCommand.supervisedRun = {
        ...payload.data.dispatchSupervisedWorkflowCommand.supervisedRun,
        restartCount: "0",
      } as unknown as typeof payload.data.dispatchSupervisedWorkflowCommand.supervisedRun;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = createWorkflowSupervisorGraphqlClient({
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    await expect(
      client.start({
        sourceId: "source-1",
        bindingId: "binding-1",
        correlationKey: "corr-1",
        targetWorkflowName: "demo",
        bindingSnapshot: buildBinding(),
      }),
    ).rejects.toThrow(/restartCount must be a finite number/i);
  });

  test("status lookup preserves all GraphQL lookup variables", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSupervisedWorkflowRunPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = createWorkflowSupervisorGraphqlClient({
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    await client.status({
      runnerPoolRunId: "pool-1",
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      workflowExecutionId: "sess-1",
      workflowKey: "demo-key",
      alias: "demo-alias",
      idempotencyKey: "stable-graphql-status",
    });

    const parsed = parseRequestBody(fetchImpl.mock.calls[0]);
    expect(parsed.variables?.input).toEqual({
      runnerPoolRunId: "pool-1",
      workflowExecutionId: "sess-1",
      workflowKey: "demo-key",
      alias: "demo-alias",
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      idempotencyKey: "stable-graphql-status",
    });
  });

  test("stop restart and submitInput preserve strong GraphQL lookup ids", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSupervisedWorkflowRunPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSupervisedWorkflowRunPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSupervisedWorkflowRunPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = createWorkflowSupervisorGraphqlClient({
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    await client.stop({
      runnerPoolRunId: "pool-stop",
      workflowExecutionId: "sess-stop",
      idempotencyKey: "idem-stop",
    });
    await client.restart({
      runnerPoolRunId: "pool-restart",
      workflowExecutionId: "sess-restart",
      idempotencyKey: "idem-restart",
    });
    await client.submitInput({
      runnerPoolRunId: "pool-input",
      workflowExecutionId: "sess-input",
      idempotencyKey: "idem-input",
      runtimeVariables: { humanInput: { text: "continue" } },
    });

    expect(parseRequestBody(fetchImpl.mock.calls[0]).variables?.input).toEqual({
      runnerPoolRunId: "pool-stop",
      workflowExecutionId: "sess-stop",
      idempotencyKey: "idem-stop",
    });
    expect(parseRequestBody(fetchImpl.mock.calls[2]).variables?.input).toEqual({
      runnerPoolRunId: "pool-restart",
      workflowExecutionId: "sess-restart",
      idempotencyKey: "idem-restart",
    });
    expect(parseRequestBody(fetchImpl.mock.calls[4]).variables?.input).toEqual({
      runnerPoolRunId: "pool-input",
      workflowExecutionId: "sess-input",
      idempotencyKey: "idem-input",
    });
  });

  test("submitInput can start a supervised run when no prior run exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ message: "no supervised run matches the lookup" }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSuccessfulPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const client = createWorkflowSupervisorGraphqlClient({
      endpoint: "http://example.test/graphql",
      fetchImpl,
    });

    await client.submitInput({
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      targetWorkflowName: "demo",
      bindingSnapshot: buildBinding(),
      runtimeVariables: { humanInput: { text: "start" } },
    });

    const secondCall = fetchImpl.mock.calls[1];
    const rawBody = secondCall?.[1]?.body;
    if (typeof rawBody !== "string") {
      throw new Error("expected string request body");
    }
    const parsed = JSON.parse(rawBody) as {
      readonly variables?: {
        readonly input?: {
          readonly command?: {
            readonly action?: string;
            readonly supervisedRunId?: string;
          };
          readonly binding?: EventBinding;
        };
      };
    };
    expect(parsed.variables?.input?.command?.action).toBe("input");
    expect(parsed.variables?.input?.command?.supervisedRunId).toBeUndefined();
    expect(parsed.variables?.input?.binding?.execution?.control).toEqual({
      intentMapping: { mode: "structured-only" },
    });
  });

  test("postDispatchSupervisorConversationThroughGraphql parses dispatch payload", async () => {
    const now = "2026-05-01T00:00:00.000Z";
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: {
            dispatchSupervisorConversation: {
              conversation: {
                supervisorConversationId: "conv-1",
                supervisorProfileId: "profile-1",
                profileRevision: "rev-1",
                supervisorWorkflowName: "sup-wf",
                sourceId: "source-1",
                bindingId: "binding-1",
                correlationKey: "corr-1",
                conversationRevision: 1,
                status: "active",
                artifactDir: "/tmp/art",
                createdAt: now,
                updatedAt: now,
              },
              managedRuns: [],
              decision: {
                decisionId: "dec-1",
                supervisorConversationId: "conv-1",
                sourceMessageId: "msg-1",
                profileRevision: "rev-1",
                conversationRevision: 1,
                status: "applied",
                proposalJson: "{}",
                createdAt: now,
                updatedAt: now,
              },
              proposal: { action: "no-op", reason: "ok", confidence: 1 },
              applied: true,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    const result = await postDispatchSupervisorConversationThroughGraphql(
      {
        endpoint: "http://example.test/graphql",
        fetchImpl,
      },
      {
        binding: {},
        event: {},
        supervisorProfileId: "profile-1",
        correlationKey: "corr-1",
        sourceMessageId: "msg-1",
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.applied).toBe(true);
    expect(result.conversation.supervisorConversationId).toBe("conv-1");
    expect(result.managedRuns).toEqual([]);
  });
});
