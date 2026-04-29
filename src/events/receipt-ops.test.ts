import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { emitEventFile } from "./manual-emit";
import { listEventReceipts, replayEventReceipt } from "./receipt-ops";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-receipt-"));
  tempDirs.push(directory);
  return directory;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createWebhookFixture(root: string): Promise<{
  readonly workflowRoot: string;
  readonly eventRoot: string;
  readonly rootDataDir: string;
  readonly eventFile: string;
}> {
  const workflowRoot = path.join(root, ".divedra");
  const eventRoot = path.join(root, ".divedra-events");
  const rootDataDir = path.join(root, "data");
  const eventFile = path.join(root, "event.json");
  await writeJson(path.join(workflowRoot, "demo", "workflow.json"), {
    workflowId: "demo",
  });
  await writeJson(path.join(eventRoot, "sources", "webhook.json"), {
    id: "webhook",
    kind: "webhook",
    path: "/events/webhook",
  });
  await writeJson(path.join(eventRoot, "bindings", "webhook-demo.json"), {
    id: "webhook-demo",
    sourceId: "webhook",
    workflowName: "demo",
    match: { eventType: "chat.message" },
    inputMapping: {
      mode: "template",
      template: {
        request: "{{event.input.text}}",
      },
      mirrorToHumanInput: true,
    },
    execution: {
      async: true,
    },
  });
  await writeJson(eventFile, {
    eventId: "evt-1",
    eventType: "chat.message",
    input: { text: "hello replay" },
  });
  return { workflowRoot, eventRoot, rootDataDir, eventFile };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("event receipt operations", () => {
  test("lists and replays stored receipts through a mocked workflow dispatch", async () => {
    const root = await makeTempDir();
    const { workflowRoot, eventRoot, rootDataDir, eventFile } =
      await createWebhookFixture(root);
    const workflowExecutionIds = ["sess-first", "sess-replay"];
    const fetchImpl = vi.fn(async (_request, init) => {
      const payload = JSON.parse(String(init?.body)) as {
        variables: {
          input: {
            workflowName: string;
            runtimeVariables: Readonly<Record<string, unknown>>;
          };
        };
      };
      expect(payload.variables.input.workflowName).toBe("demo");
      expect(payload.variables.input.runtimeVariables["workflowInput"]).toEqual(
        {
          request: "hello replay",
        },
      );
      return new Response(
        JSON.stringify({
          data: {
            executeWorkflow: {
              workflowExecutionId: workflowExecutionIds.shift() ?? "sess-extra",
              sessionId: "sess-event",
              status: "running",
              accepted: true,
              exitCode: null,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const emitted = await emitEventFile({
      sourceId: "webhook",
      eventFile,
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
    });
    const [initialReceipt] = await listEventReceipts({
      sourceId: "webhook",
      rootDataDir,
      cwd: root,
    });
    expect(initialReceipt?.receiptId).toBe(emitted[0]?.receipt.receiptId);

    const replayed = await replayEventReceipt({
      receiptId: initialReceipt?.receiptId ?? "",
      workflowRoot,
      eventRoot,
      rootDataDir,
      endpoint: "http://example.test/graphql",
      fetchImpl,
      cwd: root,
      reason: "retry after operator review",
    });
    const allReceipts = await listEventReceipts({
      sourceId: "webhook",
      rootDataDir,
      cwd: root,
    });
    const replayRawRef = replayed.receipts[0]?.receipt.rawRef;
    expect(replayRawRef).toBeDefined();
    const replayRaw =
      replayRawRef === undefined
        ? undefined
        : (JSON.parse(
            await readFile(path.join(rootDataDir, replayRawRef.path), "utf8"),
          ) as {
            replay?: {
              originalReceiptId?: string;
              reason?: string;
              replayEventId?: string;
            };
          });

    expect(replayed.original.receiptId).toBe(initialReceipt?.receiptId);
    expect(replayed.reason).toBe("retry after operator review");
    expect(replayed.replayEvent.eventId).toContain(":replay-");
    expect(replayed.replayEvent.dedupeKey).toContain(":replay-");
    expect(replayed.receipts[0]?.receipt.status).toBe("dispatched");
    expect(replayRaw?.replay?.originalReceiptId).toBe(
      initialReceipt?.receiptId,
    );
    expect(replayRaw?.replay?.reason).toBe("retry after operator review");
    expect(replayRaw?.replay?.replayEventId).toBe(replayed.replayEvent.eventId);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(allReceipts).toHaveLength(2);
  });
});