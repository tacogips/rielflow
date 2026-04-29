import { describe, expect, test, vi } from "vitest";
import type { EventBinding } from "../events/types";
import { createWorkflowSupervisorGraphqlClient } from "./supervisor-graphql-client";

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

  test("status lookup omits idempotencyKey from GraphQL query variables", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              supervisedWorkflowRun:
                buildSuccessfulPayload().data.dispatchSupervisedWorkflowCommand,
            },
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

    await client.status({
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
      idempotencyKey: "stable-graphql-status",
    });

    const firstCall = fetchImpl.mock.calls[0];
    const rawBody = firstCall?.[1]?.body;
    if (typeof rawBody !== "string") {
      throw new Error("expected string request body");
    }
    const parsed = JSON.parse(rawBody) as {
      readonly variables?: {
        readonly input?: Record<string, unknown>;
      };
    };
    expect(parsed.variables?.input).toEqual({
      sourceId: "source-1",
      bindingId: "binding-1",
      correlationKey: "corr-1",
    });
  });
});
