import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createSequentialListEventSourceAdapter } from "./sequential-list";
import {
  buildSequentialListConfigRevisionId,
  SequentialListStateRepository,
} from "../sequential-list-state";
import type {
  EventSourceDispatchOutcome,
  SequentialListCompletionInput,
  SequentialListCompletionObserver,
} from "../source-adapter";
import type {
  ExternalEventEnvelope,
  SequentialListSourceConfig,
} from "../types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rielflow-seq-list-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function makeSource(): SequentialListSourceConfig {
  return {
    id: "nightly-instructions",
    kind: "sequential-list",
    entries: [
      { id: "first", prompt: "First prompt." },
      { id: "second", prompt: "Second prompt.", metadata: { phase: 2 } },
    ],
  };
}

function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      Promise.resolve(predicate()).then((passed) => {
        if (!passed) {
          return;
        }
        clearInterval(timer);
        resolve();
      }, reject);
      if (Date.now() - startedAt > 5000) {
        clearInterval(timer);
        reject(new Error("condition was not met"));
      }
    }, 5);
  });
}

describe("sequential-list event source adapter", () => {
  test("dispatches the next item only after the previous item reaches terminal completion", async () => {
    const source = makeSource();
    const dataRoot = await makeTempDir();
    const dispatched: ExternalEventEnvelope[] = [];
    const releaseCompletion: Array<() => void> = [];
    const observer: SequentialListCompletionObserver = {
      async waitForTerminal() {
        await new Promise<void>((resolve) => {
          releaseCompletion.push(resolve);
        });
        return { status: "completed" };
      },
    };
    const adapter = createSequentialListEventSourceAdapter();
    const abortController = new AbortController();
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: abortController.signal,
      now: () => new Date("2026-05-22T00:00:00.000Z"),
      sequentialListCompletionObserver: observer,
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        return {
          receipts: [
            {
              receipt: {
                receiptId: `receipt-${String(dispatched.length)}`,
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: "dispatched",
                workflowName: "demo",
                workflowExecutionId: `workflow-${String(dispatched.length)}`,
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: false,
              workflowName: "demo",
              workflowExecutionId: `workflow-${String(dispatched.length)}`,
            },
          ],
        };
      },
    });

    await waitFor(() => dispatched.length === 1);
    expect(dispatched[0]?.input).toMatchObject({
      prompt: "First prompt.",
      sequence: {
        itemId: "first",
        index: 0,
        total: 2,
      },
    });
    expect(dispatched).toHaveLength(1);

    releaseCompletion[0]?.();
    await waitFor(() => dispatched.length >= 2);
    expect(dispatched[1]?.input).toMatchObject({
      prompt: "Second prompt.",
      metadata: { phase: 2 },
      sequence: {
        itemId: "second",
        index: 1,
        total: 2,
        priorReceiptId: "receipt-1",
        priorWorkflowExecutionId: "workflow-1",
      },
    });
    releaseCompletion[1]?.();
    await handle.stop();
  });

  test("resumes from durable state without redispatching completed items", async () => {
    const source = makeSource();
    const dataRoot = await makeTempDir();
    const revision = buildSequentialListConfigRevisionId(source);
    const repository = new SequentialListStateRepository(
      dataRoot,
      source.id,
      revision,
    );
    await repository.save({
      sourceId: source.id,
      configRevisionId: revision,
      runId: `${source.id}:${revision}`,
      currentIndex: 1,
      itemStatuses: [
        {
          itemId: "first",
          index: 0,
          status: "completed",
          receiptIds: ["receipt-1"],
          workflowExecutionIds: ["workflow-1"],
          supervisedRunIds: [],
          supervisorExecutionIds: [],
          completedAt: "2026-05-22T00:00:00.000Z",
        },
        {
          itemId: "second",
          index: 1,
          status: "pending",
          receiptIds: [],
          workflowExecutionIds: [],
          supervisedRunIds: [],
          supervisorExecutionIds: [],
        },
      ],
      updatedAt: "2026-05-22T00:00:00.000Z",
    });

    const dispatched: ExternalEventEnvelope[] = [];
    const adapter = createSequentialListEventSourceAdapter();
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      now: () => new Date("2026-05-22T00:00:01.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal() {
          return { status: "completed" };
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        return {
          receipts: [
            {
              receipt: {
                receiptId: "receipt-2",
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: "dispatched",
                workflowName: "demo",
                workflowExecutionId: "workflow-2",
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: false,
              workflowName: "demo",
              workflowExecutionId: "workflow-2",
            },
          ],
        };
      },
    });

    await waitFor(() => dispatched.length === 1);
    expect(dispatched[0]?.input).toMatchObject({
      prompt: "Second prompt.",
      sequence: {
        itemId: "second",
        priorReceiptId: "receipt-1",
        priorWorkflowExecutionId: "workflow-1",
      },
    });
    await handle.stop();
  });

  test("resumes dispatching state by waiting for persisted completion before dispatching the next item", async () => {
    const source = makeSource();
    const dataRoot = await makeTempDir();
    const revision = buildSequentialListConfigRevisionId(source);
    const repository = new SequentialListStateRepository(
      dataRoot,
      source.id,
      revision,
    );
    await repository.save({
      sourceId: source.id,
      configRevisionId: revision,
      runId: `${source.id}:${revision}`,
      currentIndex: 0,
      itemStatuses: [
        {
          itemId: "first",
          index: 0,
          status: "dispatching",
          receiptIds: ["receipt-1"],
          workflowExecutionIds: ["workflow-1"],
          supervisedRunIds: [],
          supervisorExecutionIds: [],
          startedAt: "2026-05-22T00:00:00.000Z",
        },
        {
          itemId: "second",
          index: 1,
          status: "pending",
          receiptIds: [],
          workflowExecutionIds: [],
          supervisedRunIds: [],
          supervisorExecutionIds: [],
        },
      ],
      activeReceiptId: "receipt-1",
      activeWorkflowExecutionId: "workflow-1",
      updatedAt: "2026-05-22T00:00:00.000Z",
    });

    const observed: SequentialListCompletionInput[] = [];
    let releasePersisted: (() => void) | undefined;
    const adapter = createSequentialListEventSourceAdapter();
    const dispatched: ExternalEventEnvelope[] = [];
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      now: () => new Date("2026-05-22T00:00:01.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal(input) {
          observed.push(input);
          if (input.workflowExecutionId === "workflow-1") {
            await new Promise<void>((resolve) => {
              releasePersisted = resolve;
            });
          }
          return { status: "completed" };
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        return {
          receipts: [
            {
              receipt: {
                receiptId: "receipt-2",
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: "dispatched",
                workflowName: "demo",
                workflowExecutionId: "workflow-2",
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: false,
              workflowName: "demo",
              workflowExecutionId: "workflow-2",
            },
          ],
        };
      },
    });

    await waitFor(() => observed.length === 1);
    expect(observed[0]?.workflowExecutionId).toBe("workflow-1");
    expect(dispatched).toEqual([]);

    releasePersisted?.();
    await waitFor(() => dispatched.length === 1);
    expect(dispatched[0]?.input).toMatchObject({
      prompt: "Second prompt.",
      sequence: {
        itemId: "second",
        index: 1,
        priorReceiptId: "receipt-1",
        priorWorkflowExecutionId: "workflow-1",
      },
    });
    await handle.stop();
  });

  test("fails duplicate-only dispatch outcomes instead of treating them as completed", async () => {
    const source = makeSource();
    const dataRoot = await makeTempDir();
    const adapter = createSequentialListEventSourceAdapter();
    const dispatched: ExternalEventEnvelope[] = [];
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      now: () => new Date("2026-05-22T00:00:00.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal() {
          throw new Error("duplicate-only outcome should not be observed");
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        return {
          receipts: [
            {
              receipt: {
                receiptId: "receipt-duplicate",
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: "duplicate",
                workflowName: "demo",
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: true,
              workflowName: "demo",
            },
          ],
        };
      },
    });

    const revision = buildSequentialListConfigRevisionId(source);
    await waitFor(async () => {
      const state = await new SequentialListStateRepository(
        dataRoot,
        source.id,
        revision,
      ).load();
      return state?.itemStatuses[0]?.status === "failed";
    });
    const state = await new SequentialListStateRepository(
      dataRoot,
      source.id,
      revision,
    ).load();
    expect(dispatched).toHaveLength(1);
    expect(state?.currentIndex).toBe(0);
    expect(state?.itemStatuses[0]).toMatchObject({
      status: "failed",
      error: "sequential-list item matched only duplicate receipts",
    });
    await handle.stop();
  });

  test("read-only dispatch records skipped state without advancing cursor", async () => {
    const source = makeSource();
    const dataRoot = await makeTempDir();
    const adapter = createSequentialListEventSourceAdapter();
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      readOnly: true,
      now: () => new Date("2026-05-22T00:00:00.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal() {
          return { status: "completed" };
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        return {
          receipts: [
            {
              receipt: {
                receiptId: "receipt-read-only",
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: "skipped",
                workflowName: "demo",
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
                error: "event dispatch skipped in read-only mode",
              },
              duplicate: false,
              workflowName: "demo",
            },
          ],
        };
      },
    });

    const revision = buildSequentialListConfigRevisionId(source);
    const repository = new SequentialListStateRepository(
      dataRoot,
      source.id,
      revision,
    );
    await waitFor(async () => {
      const state = await repository.load();
      return state?.itemStatuses[0]?.status === "skipped";
    });
    const state = await repository.load();
    expect(state?.currentIndex).toBe(0);
    expect(state?.itemStatuses[0]).toMatchObject({
      itemId: "first",
      status: "skipped",
      receiptIds: ["receipt-read-only"],
    });
    await handle.stop();
  });

  test("continue failure policy persists failure before advancing", async () => {
    const source: SequentialListSourceConfig = {
      ...makeSource(),
      onItemFailure: "continue",
    };
    const dataRoot = await makeTempDir();
    const dispatched: ExternalEventEnvelope[] = [];
    const diagnostics: string[] = [];
    const adapter = createSequentialListEventSourceAdapter();
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      diagnosticSink: (diagnostic) => {
        diagnostics.push(diagnostic.errorClass);
      },
      now: () => new Date("2026-05-22T00:00:00.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal() {
          return { status: "completed" };
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        const failed = dispatched.length === 1;
        return {
          receipts: [
            {
              receipt: {
                receiptId: `receipt-${String(dispatched.length)}`,
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: failed ? "failed" : "dispatched",
                workflowName: "demo",
                ...(failed ? { error: "first item failed" } : {}),
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: false,
              workflowName: "demo",
            },
          ],
        };
      },
    });

    await waitFor(() => dispatched.length >= 2 || diagnostics.length > 0);
    expect(diagnostics).toEqual([]);
    const revision = buildSequentialListConfigRevisionId(source);
    const repository = new SequentialListStateRepository(
      dataRoot,
      source.id,
      revision,
    );
    const state = await repository.load();
    expect(state?.itemStatuses[0]).toMatchObject({
      itemId: "first",
      status: "failed",
      error: "first item failed",
    });
    expect(dispatched[1]?.input).toMatchObject({
      sequence: { itemId: "second", index: 1 },
    });
    await handle.stop();
  });

  test("continue failure policy advances skipped items exactly once", async () => {
    const source: SequentialListSourceConfig = {
      id: "nightly-instructions",
      kind: "sequential-list",
      onItemFailure: "continue",
      entries: [
        { id: "first", prompt: "First prompt." },
        { id: "second", prompt: "Second prompt." },
        { id: "third", prompt: "Third prompt." },
      ],
    };
    const dataRoot = await makeTempDir();
    const dispatched: ExternalEventEnvelope[] = [];
    const adapter = createSequentialListEventSourceAdapter();
    const handle = await adapter.start({
      source,
      eventDataRoot: dataRoot,
      signal: new AbortController().signal,
      now: () => new Date("2026-05-22T00:00:00.000Z"),
      sequentialListCompletionObserver: {
        async waitForTerminal() {
          return { status: "completed" };
        },
      },
      async dispatch(event): Promise<EventSourceDispatchOutcome> {
        dispatched.push(event);
        const skipped = dispatched.length === 1;
        return {
          receipts: [
            {
              receipt: {
                receiptId: `receipt-${String(dispatched.length)}`,
                sourceId: source.id,
                bindingId: "binding-a",
                dedupeKey: event.dedupeKey,
                status: skipped ? "skipped" : "dispatched",
                workflowName: "demo",
                ...(skipped ? { error: "first item skipped" } : {}),
                receivedAt: event.receivedAt,
                updatedAt: event.receivedAt,
              },
              duplicate: false,
              workflowName: "demo",
              ...(skipped ? {} : { workflowExecutionId: "workflow-second" }),
            },
          ],
        };
      },
    });

    await waitFor(() => dispatched.length >= 2);
    expect(dispatched[0]?.input).toMatchObject({
      sequence: { itemId: "first", index: 0 },
    });
    expect(dispatched[1]?.input).toMatchObject({
      sequence: { itemId: "second", index: 1 },
    });
    await handle.stop();
  });
});
