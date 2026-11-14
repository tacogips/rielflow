import {
  buildMergedContinuationTimeline,
  loadContinuationRelatedSnapshots,
} from "./workflow/history-continuation";
import { loadSession, type SessionStoreOptions } from "divedra-core";
import {
  normalizeSessionState,
  type NodeExecutionRecord,
  type WorkflowSessionState,
} from "divedra-core";
import type { LoadOptions } from "divedra-core";

export type DivedraStepRunOptions = LoadOptions & SessionStoreOptions;

/** Merged timeline view for CLI / GraphQL step-run listings. */
export interface MergedWorkflowExecutionStepRunRow {
  readonly timelineOrdinal: number;
  readonly executionOrdinal: number;
  readonly persistedWorkflowExecutionId: string;
  readonly stepRunId: string;
  readonly stepId: string | undefined;
  readonly nodeRegistryId: string | undefined;
  readonly status: NodeExecutionRecord["status"];
  readonly imported: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
}

function findOwningNodeExecutionRecord(
  snapshot: WorkflowSessionState,
  stepRunId: string,
): NodeExecutionRecord | undefined {
  return snapshot.nodeExecutions.find((row) => row.nodeExecId === stepRunId);
}

/**
 * Builds the operator-visible merged timeline for a workflow execution, including imported
 * prefix rows referenced via `historyImports` / continuation lineage.
 */
export async function listMergedWorkflowExecutionStepRuns(
  input: {
    readonly workflowExecutionId: string;
    readonly filterStepId?: string;
    readonly filterStatus?: NodeExecutionRecord["status"];
  } & DivedraStepRunOptions,
): Promise<{
  readonly workflowExecutionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly stepRuns: readonly MergedWorkflowExecutionStepRunRow[];
}> {
  const loaded = await loadSession(input.workflowExecutionId, input);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  const root = normalizeSessionState(loaded.value);
  const snapshotsResult = await loadContinuationRelatedSnapshots([root], input);
  if (!snapshotsResult.ok) {
    throw new Error(snapshotsResult.error);
  }
  const snapshots = snapshotsResult.value;
  const mergedTimeline = buildMergedContinuationTimeline(
    snapshots,
    root.sessionId,
  );
  if (!mergedTimeline.ok) {
    throw new Error(mergedTimeline.error.message);
  }

  const filterStepTrimmed = input.filterStepId?.trim();
  const trimmedFilterStep =
    filterStepTrimmed === undefined || filterStepTrimmed.length === 0
      ? undefined
      : filterStepTrimmed;

  const rows: MergedWorkflowExecutionStepRunRow[] = [];
  let timelineOrdinal = 0;
  for (const entry of mergedTimeline.value) {
    const owner = snapshots.get(entry.persistedWorkflowExecutionId);
    if (owner === undefined) {
      throw new Error(
        `internal: missing owning snapshot '${entry.persistedWorkflowExecutionId}' for merged timeline row`,
      );
    }
    const record = findOwningNodeExecutionRecord(owner, entry.stepRunId);
    if (record === undefined) {
      throw new Error(
        `internal: node execution '${entry.stepRunId}' missing from owning session '${owner.sessionId}'`,
      );
    }
    const stepId = record.stepId ?? record.nodeId ?? entry.stepId;
    if (trimmedFilterStep !== undefined && stepId !== trimmedFilterStep) {
      continue;
    }
    if (
      input.filterStatus !== undefined &&
      record.status !== input.filterStatus
    ) {
      continue;
    }
    timelineOrdinal += 1;
    rows.push({
      timelineOrdinal,
      executionOrdinal: record.executionOrdinal ?? entry.executionOrdinal,
      persistedWorkflowExecutionId: entry.persistedWorkflowExecutionId,
      stepRunId: entry.stepRunId,
      stepId: stepId ?? undefined,
      nodeRegistryId: record.nodeRegistryId ?? entry.nodeRegistryId,
      status: record.status,
      imported: entry.persistedWorkflowExecutionId !== root.sessionId,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    });
  }

  return {
    workflowExecutionId: root.sessionId,
    workflowId: root.workflowId,
    workflowName: root.workflowName,
    stepRuns: rows,
  };
}
