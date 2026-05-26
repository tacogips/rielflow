import { err, ok, type Result } from "./result";
import {
  listContinuationReferencedWorkflowExecutionIds,
  normalizeSessionState,
  type HistoryImportSegment,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "./session";
import { loadSession, type SessionStoreOptions } from "./session-store";

export const DEFAULT_CONTINUATION_ALLOWED_STATUSES: ReadonlySet<
  NodeExecutionRecord["status"]
> = new Set(["succeeded", "skipped"]);

export interface ContinuationTimelineEntry {
  readonly persistedWorkflowExecutionId: string;
  readonly workflowId: string;
  readonly stepRunId: string;
  readonly executionOrdinal: number;
  readonly stepId?: string;
  readonly nodeRegistryId?: string;
  readonly status: NodeExecutionRecord["status"];
}

export type BuildMergedContinuationTimelineErrorKind =
  | "unknown_source_workflow_execution"
  | "unknown_step_run"
  | "cycle_in_history_import_graph"
  | "segment_boundary_not_found";

export interface BuildMergedContinuationTimelineError {
  readonly kind: BuildMergedContinuationTimelineErrorKind;
  readonly message: string;
}

export type ResolveContinuationAnchorErrorKind =
  | BuildMergedContinuationTimelineErrorKind
  | "workflow_mismatch_at_anchor"
  | "non_terminal_anchor"
  | "ambiguous_anchor_step_run";

export interface ResolveContinuationAnchorError {
  readonly kind: ResolveContinuationAnchorErrorKind;
  readonly message: string;
}

export function isAllowedContinuationAnchorStatus(
  status: NodeExecutionRecord["status"],
  allowedStatuses: ReadonlySet<NodeExecutionRecord["status"]>,
): boolean {
  return allowedStatuses.has(status);
}

function timelineEntryDedupeKey(entry: ContinuationTimelineEntry): string {
  return `${entry.persistedWorkflowExecutionId}\0${entry.stepRunId}\0${String(entry.executionOrdinal)}`;
}

function ownTimelineEntries(
  snapshot: WorkflowSessionState,
): readonly ContinuationTimelineEntry[] {
  return snapshot.nodeExecutions.map((execution) => {
    if (
      execution.executionOrdinal === undefined ||
      !Number.isInteger(execution.executionOrdinal) ||
      execution.executionOrdinal < 1
    ) {
      throw new Error(
        `session '${snapshot.sessionId}' has node execution '${execution.nodeExecId}' missing a positive integer executionOrdinal; normalize session state first`,
      );
    }
    return {
      persistedWorkflowExecutionId: snapshot.sessionId,
      workflowId: snapshot.workflowId,
      stepRunId: execution.nodeExecId,
      executionOrdinal: execution.executionOrdinal,
      ...(execution.stepId === undefined ? {} : { stepId: execution.stepId }),
      ...(execution.nodeRegistryId === undefined
        ? {}
        : { nodeRegistryId: execution.nodeRegistryId }),
      status: execution.status,
    };
  });
}

function truncateTimelineAtSegmentBoundary(
  timeline: readonly ContinuationTimelineEntry[],
  segment: HistoryImportSegment,
): Result<
  readonly ContinuationTimelineEntry[],
  BuildMergedContinuationTimelineError
> {
  const foundIndex = timeline.findIndex(
    (row) =>
      row.stepRunId === segment.throughStepRunId &&
      row.executionOrdinal === segment.throughExecutionOrdinal &&
      row.persistedWorkflowExecutionId === segment.sourceWorkflowExecutionId,
  );
  if (foundIndex === -1) {
    return err({
      kind: "segment_boundary_not_found",
      message: `import segment boundary not found for workflow execution '${segment.sourceWorkflowExecutionId}' ending at step run '${segment.throughStepRunId}' (ordinal ${String(segment.throughExecutionOrdinal)})`,
    });
  }
  return ok(timeline.slice(0, foundIndex + 1));
}

export function buildMergedContinuationTimeline(
  snapshots: ReadonlyMap<string, WorkflowSessionState>,
  rootSessionId: string,
): Result<
  readonly ContinuationTimelineEntry[],
  BuildMergedContinuationTimelineError
> {
  return buildMergedContinuationTimelineVisited(
    snapshots,
    rootSessionId,
    new Set(),
  );
}

function buildMergedContinuationTimelineVisited(
  snapshots: ReadonlyMap<string, WorkflowSessionState>,
  rootSessionId: string,
  visitingStack: ReadonlySet<string>,
): Result<
  readonly ContinuationTimelineEntry[],
  BuildMergedContinuationTimelineError
> {
  if (visitingStack.has(rootSessionId)) {
    return err({
      kind: "cycle_in_history_import_graph",
      message: `cycle detected revisiting workflow execution '${rootSessionId}' while resolving imported history`,
    });
  }

  const root = snapshots.get(rootSessionId);
  if (root === undefined) {
    return err({
      kind: "unknown_source_workflow_execution",
      message: `unknown workflow execution snapshot '${rootSessionId}'`,
    });
  }

  const nextVisit = new Set([...visitingStack, rootSessionId]);

  if (root.historyImports === undefined || root.historyImports.length === 0) {
    try {
      return ok(ownTimelineEntries(root));
    } catch (error: unknown) {
      return err({
        kind: "unknown_step_run",
        message:
          error instanceof Error
            ? error.message
            : "invalid execution ordinal in session snapshot",
      });
    }
  }

  let merged: ContinuationTimelineEntry[] = [];
  const seenKeys = new Set<string>();

  for (const segment of root.historyImports) {
    const subResult = buildMergedContinuationTimelineVisited(
      snapshots,
      segment.sourceWorkflowExecutionId,
      nextVisit,
    );
    if (!subResult.ok) {
      return subResult;
    }
    const truncated = truncateTimelineAtSegmentBoundary(
      subResult.value,
      segment,
    );
    if (!truncated.ok) {
      return err(truncated.error);
    }
    const fresh = truncated.value.filter((entry) => {
      const key = timelineEntryDedupeKey(entry);
      if (seenKeys.has(key)) {
        return false;
      }
      seenKeys.add(key);
      return true;
    });
    merged = [...merged, ...fresh];
  }

  try {
    for (const entry of ownTimelineEntries(root)) {
      const key = timelineEntryDedupeKey(entry);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        merged = [...merged, entry];
      }
    }
    return ok(merged);
  } catch (error: unknown) {
    return err({
      kind: "unknown_step_run",
      message:
        error instanceof Error
          ? error.message
          : "invalid execution ordinal in session snapshot",
    });
  }
}

export function flattenedHistoryImportsForTimelinePrefix(
  prefix: readonly ContinuationTimelineEntry[],
): readonly HistoryImportSegment[] {
  if (prefix.length === 0) {
    return [];
  }
  const segments: HistoryImportSegment[] = [];
  let cursor = 0;
  while (cursor < prefix.length) {
    const first = prefix[cursor];
    if (first === undefined) {
      break;
    }
    const owner = first.persistedWorkflowExecutionId;
    let segmentEndIndex = cursor;
    let index = cursor + 1;
    while (index < prefix.length) {
      const current = prefix[index];
      if (
        current === undefined ||
        current.persistedWorkflowExecutionId !== owner
      ) {
        break;
      }
      segmentEndIndex = index;
      index++;
    }
    const last = prefix[segmentEndIndex];
    if (last === undefined) {
      break;
    }
    segments.push({
      sourceWorkflowExecutionId: last.persistedWorkflowExecutionId,
      throughStepRunId: last.stepRunId,
      throughExecutionOrdinal: last.executionOrdinal,
    });
    cursor = segmentEndIndex + 1;
  }
  return segments;
}

/**
 * Loads every persisted workflow execution snapshot referenced transitively by continuation
 * lineage (`historyImports`, `continuedFromWorkflowExecutionId`) starting from `roots`.
 */
export async function loadContinuationRelatedSnapshots(
  roots: readonly WorkflowSessionState[],
  options: SessionStoreOptions,
): Promise<Result<Map<string, WorkflowSessionState>, string>> {
  const map = new Map<string, WorkflowSessionState>();
  const pendingIds = new Set<string>();

  function ingestSession(raw: WorkflowSessionState): void {
    const normalized = normalizeSessionState(raw);
    if (map.has(normalized.sessionId)) {
      return;
    }
    map.set(normalized.sessionId, normalized);
    for (const refId of listContinuationReferencedWorkflowExecutionIds(
      normalized,
    )) {
      if (!map.has(refId)) {
        pendingIds.add(refId);
      }
    }
  }

  try {
    for (const root of roots) {
      ingestSession(root);
    }

    while (pendingIds.size > 0) {
      const batch = [...pendingIds];
      pendingIds.clear();
      for (const id of batch) {
        if (map.has(id)) {
          continue;
        }
        const loaded = await loadSession(id, options);
        if (!loaded.ok) {
          return err(
            `failed to load continuation-related workflow execution '${id}': ${loaded.error.message}`,
          );
        }
        ingestSession(loaded.value);
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "unknown continuation snapshot load failure";
    return err(message);
  }

  return ok(map);
}

export function resolveContinuationAnchorPlacement(input: {
  readonly snapshots: ReadonlyMap<string, WorkflowSessionState>;
  readonly sourceWorkflowExecutionId: string;
  readonly anchorStepRunId: string;
  readonly expectedWorkflowId: string;
  readonly terminalStatuses?: ReadonlySet<NodeExecutionRecord["status"]>;
}): Result<
  {
    readonly mergedTimelinePrefixThroughAnchor: readonly ContinuationTimelineEntry[];
    readonly anchor: ContinuationTimelineEntry;
    readonly flattenedHistoryImports: readonly HistoryImportSegment[];
  },
  ResolveContinuationAnchorError
> {
  const terminalStatuses =
    input.terminalStatuses ?? DEFAULT_CONTINUATION_ALLOWED_STATUSES;

  const timelineResult = buildMergedContinuationTimeline(
    input.snapshots,
    input.sourceWorkflowExecutionId,
  );
  if (!timelineResult.ok) {
    return err(timelineResult.error as ResolveContinuationAnchorError);
  }
  const timeline = timelineResult.value;
  const anchorMatches = timeline
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.stepRunId === input.anchorStepRunId);
  if (anchorMatches.length === 0) {
    return err({
      kind: "unknown_step_run",
      message: `step run '${input.anchorStepRunId}' not found in merged timeline for workflow execution '${input.sourceWorkflowExecutionId}'`,
    });
  }
  if (anchorMatches.length > 1) {
    return err({
      kind: "ambiguous_anchor_step_run",
      message: `step run id '${input.anchorStepRunId}' is ambiguous in the merged timeline (${String(anchorMatches.length)} rows); refs repeat across workflow executions`,
    });
  }
  const anchorMatch = anchorMatches[0];
  if (anchorMatch === undefined) {
    return err({
      kind: "unknown_step_run",
      message: `step run '${input.anchorStepRunId}' not found in merged timeline for workflow execution '${input.sourceWorkflowExecutionId}'`,
    });
  }
  const anchorIndex = anchorMatch.index;
  const anchor = timeline[anchorIndex];
  if (anchor === undefined) {
    return err({
      kind: "unknown_step_run",
      message: `step run '${input.anchorStepRunId}' resolved outside the merged timeline for workflow execution '${input.sourceWorkflowExecutionId}'`,
    });
  }
  if (anchor.workflowId !== input.expectedWorkflowId) {
    return err({
      kind: "workflow_mismatch_at_anchor",
      message: `anchor step run belongs to workflow id '${anchor.workflowId}' but continuation target expects '${input.expectedWorkflowId}'`,
    });
  }
  if (!isAllowedContinuationAnchorStatus(anchor.status, terminalStatuses)) {
    return err({
      kind: "non_terminal_anchor",
      message: `step run '${input.anchorStepRunId}' has status '${anchor.status}' which is not an allowed continuation anchor`,
    });
  }
  const prefix = timeline.slice(0, anchorIndex + 1);
  const flattenedHistoryImports =
    flattenedHistoryImportsForTimelinePrefix(prefix);
  return ok({
    mergedTimelinePrefixThroughAnchor: prefix,
    anchor,
    flattenedHistoryImports,
  });
}
