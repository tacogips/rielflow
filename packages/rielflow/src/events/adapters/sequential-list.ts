import { createHash } from "node:crypto";
import path from "node:path";
import { isJsonObject } from "../../shared/json";
import type {
  EventSourceAdapter,
  EventSourceDispatchOutcome,
  EventSourceHandle,
  SequentialListCompletionInput,
  SequentialListCompletionObserver,
  SequentialListTerminalResult,
} from "../source-adapter";
import {
  buildInitialSequentialListState,
  buildSequentialListConfigRevisionId,
  SequentialListStateRepository,
  updateSequentialListItemState,
  type SequentialListItemState,
  type SequentialListStateRecord,
} from "../sequential-list-state";
import type {
  ExternalEventEnvelope,
  JsonObject,
  SequentialListEntry,
  SequentialListSourceConfig,
} from "../types";

const SEQUENTIAL_LIST_EVENT_TYPE = "sequential-list.item.ready";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSequentialListSource(
  source: unknown,
): source is SequentialListSourceConfig {
  return isJsonObject(source) && source["kind"] === "sequential-list";
}

function fallbackDataRoot(source: SequentialListSourceConfig): string {
  if (source.configFilePath !== undefined) {
    return path.resolve(path.dirname(source.configFilePath), "..", ".data");
  }
  return path.join(process.cwd(), ".rielflow-events", ".data");
}

function buildSequenceInput(input: {
  readonly source: SequentialListSourceConfig;
  readonly entry: SequentialListEntry;
  readonly configRevisionId: string;
  readonly runId: string;
  readonly index: number;
  readonly total: number;
  readonly priorReceiptId?: string;
  readonly priorWorkflowExecutionId?: string;
}): JsonObject {
  return {
    sequence: {
      sourceId: input.source.id,
      configRevisionId: input.configRevisionId,
      runId: input.runId,
      itemId: input.entry.id,
      index: input.index,
      total: input.total,
      ...(input.priorReceiptId === undefined
        ? {}
        : { priorReceiptId: input.priorReceiptId }),
      ...(input.priorWorkflowExecutionId === undefined
        ? {}
        : { priorWorkflowExecutionId: input.priorWorkflowExecutionId }),
    },
    prompt: input.entry.prompt,
    ...(input.entry.metadata === undefined
      ? {}
      : { metadata: input.entry.metadata }),
  };
}

function buildSequentialListEnvelope(input: {
  readonly source: SequentialListSourceConfig;
  readonly entry: SequentialListEntry;
  readonly configRevisionId: string;
  readonly runId: string;
  readonly index: number;
  readonly total: number;
  readonly receivedAt: string;
  readonly priorReceiptId?: string;
  readonly priorWorkflowExecutionId?: string;
}): ExternalEventEnvelope {
  const eventId = [
    input.source.id,
    input.configRevisionId,
    input.runId,
    String(input.index),
    input.entry.id,
  ].join(":");
  return {
    sourceId: input.source.id,
    eventId,
    provider: input.source.provider ?? "rielflow",
    eventType: SEQUENTIAL_LIST_EVENT_TYPE,
    occurredAt: input.receivedAt,
    receivedAt: input.receivedAt,
    dedupeKey: hash(eventId),
    input: buildSequenceInput(input),
  };
}

function latestValue(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values[values.length - 1];
}

function uniqueStrings(
  values: readonly (string | undefined)[],
): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (value === undefined || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function dispatchOutcomeIds(outcome: EventSourceDispatchOutcome): {
  readonly receiptIds: readonly string[];
  readonly workflowExecutionIds: readonly string[];
  readonly supervisedRunIds: readonly string[];
  readonly supervisorExecutionIds: readonly string[];
} {
  return {
    receiptIds: uniqueStrings(
      outcome.receipts.map((result) => result.receipt.receiptId),
    ),
    workflowExecutionIds: uniqueStrings(
      outcome.receipts.map((result) => result.workflowExecutionId),
    ),
    supervisedRunIds: uniqueStrings(
      outcome.receipts.map((result) => result.supervisedRunId),
    ),
    supervisorExecutionIds: uniqueStrings(
      outcome.receipts.map((result) => result.supervisorExecutionId),
    ),
  };
}

async function waitForOutcomeTerminal(input: {
  readonly sourceId: string;
  readonly itemId: string;
  readonly outcome: EventSourceDispatchOutcome;
  readonly observer: SequentialListCompletionObserver;
  readonly signal: AbortSignal;
}): Promise<SequentialListTerminalResult> {
  if (input.outcome.receipts.length === 0) {
    return {
      status: "failed",
      error: "sequential-list item matched no receipts",
    };
  }

  let finalStatus: SequentialListTerminalResult["status"] = "completed";
  const errors: string[] = [];
  let observedReceipts = 0;
  for (const result of input.outcome.receipts) {
    if (result.duplicate) {
      continue;
    }
    observedReceipts += 1;
    if (result.receipt.status === "failed") {
      finalStatus = "failed";
      errors.push(result.receipt.error ?? "receipt failed");
      continue;
    }
    if (result.receipt.status === "skipped") {
      finalStatus = finalStatus === "failed" ? "failed" : "skipped";
      errors.push(result.receipt.error ?? "receipt skipped");
      continue;
    }
    const terminal = await input.observer.waitForTerminal({
      sourceId: input.sourceId,
      itemId: input.itemId,
      ...(result.workflowExecutionId === undefined
        ? {}
        : { workflowExecutionId: result.workflowExecutionId }),
      ...(result.supervisedRunId === undefined
        ? {}
        : { supervisedRunId: result.supervisedRunId }),
      ...(result.supervisorExecutionId === undefined
        ? {}
        : { supervisorExecutionId: result.supervisorExecutionId }),
      signal: input.signal,
    });
    if (terminal.status !== "completed") {
      finalStatus = terminal.status;
      if (terminal.error !== undefined) {
        errors.push(terminal.error);
      }
    }
  }
  if (observedReceipts === 0) {
    return {
      status: "failed",
      error: "sequential-list item matched only duplicate receipts",
    };
  }
  return {
    status: finalStatus,
    ...(errors.length === 0 ? {} : { error: errors.join("; ") }),
  };
}

function persistedCompletionInputs(input: {
  readonly sourceId: string;
  readonly item: SequentialListItemState;
  readonly signal: AbortSignal;
}): readonly SequentialListCompletionInput[] {
  const workflowInputs = input.item.workflowExecutionIds.map(
    (workflowExecutionId) => ({
      sourceId: input.sourceId,
      itemId: input.item.itemId,
      workflowExecutionId,
      signal: input.signal,
    }),
  );
  const supervisedInputs = input.item.supervisedRunIds.map(
    (supervisedRunId) => ({
      sourceId: input.sourceId,
      itemId: input.item.itemId,
      supervisedRunId,
      signal: input.signal,
    }),
  );
  return [...workflowInputs, ...supervisedInputs];
}

async function waitForPersistedItemTerminal(input: {
  readonly sourceId: string;
  readonly item: SequentialListItemState;
  readonly observer: SequentialListCompletionObserver;
  readonly signal: AbortSignal;
}): Promise<SequentialListTerminalResult> {
  const completionInputs = persistedCompletionInputs(input);
  if (completionInputs.length === 0) {
    return {
      status: "failed",
      error: "sequential-list dispatching item has no observable execution ids",
    };
  }

  let finalStatus: SequentialListTerminalResult["status"] = "completed";
  const errors: string[] = [];
  for (const completionInput of completionInputs) {
    const terminal = await input.observer.waitForTerminal(completionInput);
    if (terminal.status !== "completed") {
      finalStatus = terminal.status;
      if (terminal.error !== undefined) {
        errors.push(terminal.error);
      }
    }
  }
  return {
    status: finalStatus,
    ...(errors.length === 0 ? {} : { error: errors.join("; ") }),
  };
}

function nextIndexAfterTerminal(
  state: SequentialListStateRecord,
  status: SequentialListTerminalResult["status"],
  index: number,
): number {
  if (status === "completed") {
    return index + 1;
  }
  return state.currentIndex;
}

export function createSequentialListEventSourceAdapter(): EventSourceAdapter {
  return {
    kind: "sequential-list",
    capabilities: {
      eventTypes: [SEQUENTIAL_LIST_EVENT_TYPE],
      supportsStart: true,
      webhook: false,
    },
    async start(input): Promise<EventSourceHandle> {
      if (!isSequentialListSource(input.source)) {
        throw new Error(
          `sequential-list adapter cannot use source kind '${input.source.kind}'`,
        );
      }
      const source = input.source;
      const configRevisionId = buildSequentialListConfigRevisionId(source);
      const repository = new SequentialListStateRepository(
        input.eventDataRoot ?? fallbackDataRoot(source),
        source.id,
        configRevisionId,
      );
      const loaded = await repository.load();
      let state =
        loaded ??
        buildInitialSequentialListState({
          source,
          configRevisionId,
          now: input.now().toISOString(),
        });
      let stopped = false;
      const stop = (): void => {
        stopped = true;
      };
      input.signal.addEventListener("abort", stop, { once: true });

      const observer = input.sequentialListCompletionObserver;
      if (observer === undefined) {
        throw new Error("sequential-list completion observer is required");
      }

      const drain = async (): Promise<void> => {
        while (!stopped && state.currentIndex < source.entries.length) {
          const entry = source.entries[state.currentIndex];
          if (entry === undefined) {
            break;
          }
          const currentItem = state.itemStatuses[state.currentIndex];
          if (currentItem?.status === "completed") {
            state = { ...state, currentIndex: state.currentIndex + 1 };
            await repository.save(state);
            continue;
          }
          if (currentItem?.status === "dispatching") {
            const terminal = await waitForPersistedItemTerminal({
              sourceId: source.id,
              item: currentItem,
              observer,
              signal: input.signal,
            });
            state = updateSequentialListItemState(state, state.currentIndex, {
              status: terminal.status,
              completedAt: input.now().toISOString(),
              ...(terminal.error === undefined
                ? {}
                : { error: terminal.error }),
            });
            state = {
              ...state,
              currentIndex: nextIndexAfterTerminal(
                state,
                terminal.status,
                state.currentIndex,
              ),
              ...(terminal.error === undefined
                ? {}
                : { lastError: terminal.error }),
            };
            await repository.save(state);
            if (
              terminal.status !== "completed" &&
              (source.onItemFailure ?? "stop") === "stop"
            ) {
              break;
            }
            if (terminal.status !== "completed") {
              state = { ...state, currentIndex: state.currentIndex + 1 };
              await repository.save(state);
            }
            continue;
          }

          const prior =
            state.currentIndex === 0
              ? undefined
              : state.itemStatuses[state.currentIndex - 1];
          state = updateSequentialListItemState(state, state.currentIndex, {
            status: "dispatching",
            startedAt: input.now().toISOString(),
          });
          const activeReceiptId = latestValue(currentItem?.receiptIds ?? []);
          const activeWorkflowExecutionId = latestValue(
            currentItem?.workflowExecutionIds ?? [],
          );
          await repository.save({
            ...state,
            ...(activeReceiptId === undefined ? {} : { activeReceiptId }),
            ...(activeWorkflowExecutionId === undefined
              ? {}
              : { activeWorkflowExecutionId }),
          });

          const priorReceiptId = latestValue(prior?.receiptIds ?? []);
          const priorWorkflowExecutionId = latestValue(
            prior?.workflowExecutionIds ?? [],
          );
          const event = buildSequentialListEnvelope({
            source,
            entry,
            configRevisionId,
            runId: state.runId,
            index: state.currentIndex,
            total: source.entries.length,
            receivedAt: input.now().toISOString(),
            ...(priorReceiptId === undefined ? {} : { priorReceiptId }),
            ...(priorWorkflowExecutionId === undefined
              ? {}
              : { priorWorkflowExecutionId }),
          });
          const outcome = (await input.dispatch(event, {
            sourceId: source.id,
            itemId: entry.id,
            index: state.currentIndex,
            configRevisionId,
            runId: state.runId,
          })) ?? { receipts: [] };
          const ids = dispatchOutcomeIds(outcome);
          state = updateSequentialListItemState(state, state.currentIndex, {
            receiptIds: ids.receiptIds,
            workflowExecutionIds: ids.workflowExecutionIds,
            supervisedRunIds: ids.supervisedRunIds,
            supervisorExecutionIds: ids.supervisorExecutionIds,
          });
          const activeDispatchedReceiptId = latestValue(ids.receiptIds);
          const activeDispatchedWorkflowExecutionId = latestValue(
            ids.workflowExecutionIds,
          );
          const activeDispatchedSupervisedRunId = latestValue(
            ids.supervisedRunIds,
          );
          await repository.save({
            ...state,
            ...(activeDispatchedReceiptId === undefined
              ? {}
              : { activeReceiptId: activeDispatchedReceiptId }),
            ...(activeDispatchedWorkflowExecutionId === undefined
              ? {}
              : {
                  activeWorkflowExecutionId:
                    activeDispatchedWorkflowExecutionId,
                }),
            ...(activeDispatchedSupervisedRunId === undefined
              ? {}
              : { activeSupervisedRunId: activeDispatchedSupervisedRunId }),
          });

          if (input.readOnly === true) {
            state = updateSequentialListItemState(state, state.currentIndex, {
              status: "skipped",
              completedAt: input.now().toISOString(),
              error: "event dispatch skipped in read-only mode",
            });
            await repository.save({
              ...state,
              currentIndex: state.currentIndex,
              lastError: "event dispatch skipped in read-only mode",
            });
            break;
          }

          const terminal = await waitForOutcomeTerminal({
            sourceId: source.id,
            itemId: entry.id,
            outcome,
            observer,
            signal: input.signal,
          });
          state = updateSequentialListItemState(state, state.currentIndex, {
            status: terminal.status,
            completedAt: input.now().toISOString(),
            ...(terminal.error === undefined ? {} : { error: terminal.error }),
          });
          state = {
            ...state,
            currentIndex: nextIndexAfterTerminal(
              state,
              terminal.status,
              state.currentIndex,
            ),
            ...(terminal.error === undefined
              ? {}
              : { lastError: terminal.error }),
          };
          await repository.save(state);
          if (
            terminal.status !== "completed" &&
            (source.onItemFailure ?? "stop") === "stop"
          ) {
            break;
          }
          if (terminal.status !== "completed") {
            state = { ...state, currentIndex: state.currentIndex + 1 };
            await repository.save(state);
          }
        }
      };

      drain().catch((error: unknown) => {
        input.diagnosticSink?.({
          sourceId: source.id,
          errorClass:
            error instanceof Error ? error.message : "sequential-list-error",
        });
      });

      return {
        sourceId: source.id,
        stop: async () => {
          stop();
        },
      };
    },
    async normalize(raw): Promise<ExternalEventEnvelope> {
      if (!isSequentialListSource(raw.source)) {
        throw new Error("sequential-list raw event requires source config");
      }
      if (!isJsonObject(raw.body)) {
        throw new Error("sequential-list raw event body must be a JSON object");
      }
      const itemId = raw.body["itemId"];
      if (typeof itemId !== "string" || itemId.length === 0) {
        throw new Error("sequential-list raw event body requires itemId");
      }
      const index = raw.source.entries.findIndex(
        (entry) => entry.id === itemId,
      );
      const entry = raw.source.entries[index];
      if (entry === undefined) {
        throw new Error(`sequential-list item '${itemId}' is not configured`);
      }
      const configRevisionId = buildSequentialListConfigRevisionId(raw.source);
      return buildSequentialListEnvelope({
        source: raw.source,
        entry,
        configRevisionId,
        runId:
          typeof raw.body["runId"] === "string"
            ? raw.body["runId"]
            : `${raw.source.id}:${configRevisionId}`,
        index,
        total: raw.source.entries.length,
        receivedAt: raw.receivedAt,
      });
    },
  };
}
