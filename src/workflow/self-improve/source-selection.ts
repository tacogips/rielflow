import {
  listSessions,
  loadSession,
  type SessionStoreOptions,
} from "../session-store";
import { listRuntimeSessions } from "../runtime-db";
import type { WorkflowSessionState } from "../session";
import type {
  WorkflowSelfImproveSourceMode,
  WorkflowSelfImproveSourceNodeExecution,
  WorkflowSelfImproveSourceRun,
} from "./types";
import type { WorkflowSelfImproveMarker } from "./marker-store";
import { parseWorkflowSelfImproveSourceMode } from "./config";

export interface WorkflowSelfImproveSourceSelectionInput {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly sourceMode: WorkflowSelfImproveSourceMode;
  readonly limit: number;
  readonly explicitSessionIds?: readonly string[];
  readonly marker?: WorkflowSelfImproveMarker;
  readonly availableRuns: readonly WorkflowSelfImproveSourceRun[];
}

function runTime(run: WorkflowSelfImproveSourceRun): string {
  return run.updatedAt ?? run.startedAt ?? "";
}

function sortNewestFirst(
  runs: readonly WorkflowSelfImproveSourceRun[],
): WorkflowSelfImproveSourceRun[] {
  return [...runs].sort((left, right) =>
    runTime(right).localeCompare(runTime(left)),
  );
}

function hasRuntimeDbDiscoveryOptions(options: SessionStoreOptions): boolean {
  const env = options.env ?? process.env;
  return (
    options.rootDataDir !== undefined ||
    options.artifactRoot !== undefined ||
    env["DIVEDRA_ARTIFACT_DIR"] !== undefined ||
    env["DIVEDRA_ARTIFACT_ROOT"] !== undefined
  );
}

export function sourceRunFromSession(
  session: WorkflowSessionState,
): WorkflowSelfImproveSourceRun {
  const nodeExecutions: WorkflowSelfImproveSourceNodeExecution[] =
    session.nodeExecutions.map((execution) => ({
      nodeId: execution.nodeId,
      ...(execution.stepId === undefined ? {} : { stepId: execution.stepId }),
      nodeExecId: execution.nodeExecId,
      status: execution.status,
      artifactDir: execution.artifactDir,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      ...(execution.outputAttemptCount === undefined
        ? {}
        : { outputAttemptCount: execution.outputAttemptCount }),
      ...(execution.outputValidationErrors === undefined
        ? {}
        : { outputValidationErrors: execution.outputValidationErrors }),
    }));
  return {
    sessionId: session.sessionId,
    workflowId: session.workflowId,
    workflowName: session.workflowName,
    status: session.status,
    startedAt: session.startedAt,
    ...(session.endedAt === undefined ? {} : { updatedAt: session.endedAt }),
    ...(session.lastError === undefined
      ? {}
      : { lastError: session.lastError }),
    nodeExecutions,
  };
}

export async function discoverWorkflowSourceRuns(
  input: {
    readonly workflowName: string;
    readonly workflowId: string;
  },
  options: SessionStoreOptions = {},
): Promise<readonly WorkflowSelfImproveSourceRun[]> {
  const runs: WorkflowSelfImproveSourceRun[] = [];
  const seenSessionIds = new Set<string>();
  if (hasRuntimeDbDiscoveryOptions(options)) {
    try {
      const indexed = await listRuntimeSessions(options);
      for (const summary of indexed) {
        if (
          summary.workflowName !== input.workflowName ||
          summary.workflowId !== input.workflowId
        ) {
          continue;
        }
        const loaded = await loadSession(summary.sessionId, options);
        if (!loaded.ok) {
          continue;
        }
        if (
          loaded.value.workflowName === input.workflowName &&
          loaded.value.workflowId === input.workflowId
        ) {
          runs.push(sourceRunFromSession(loaded.value));
          seenSessionIds.add(loaded.value.sessionId);
        }
      }
    } catch {
      // Runtime DB is an index. File-backed session state remains authoritative.
    }
  }

  const listed = await listSessions(options);
  if (!listed.ok) {
    throw new Error(listed.error.message);
  }
  for (const sessionId of listed.value) {
    if (seenSessionIds.has(sessionId)) {
      continue;
    }
    const loaded = await loadSession(sessionId, options);
    if (!loaded.ok) {
      continue;
    }
    if (
      loaded.value.workflowName === input.workflowName &&
      loaded.value.workflowId === input.workflowId
    ) {
      runs.push(sourceRunFromSession(loaded.value));
    }
  }
  return sortNewestFirst(runs);
}

export function selectWorkflowSelfImproveSourceRuns(
  input: WorkflowSelfImproveSourceSelectionInput,
): readonly WorkflowSelfImproveSourceRun[] {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw new Error("self-improve source limit must be a positive integer");
  }
  const sourceMode = parseWorkflowSelfImproveSourceMode(input.sourceMode);
  const runs = sortNewestFirst(
    input.availableRuns.filter(
      (run) =>
        run.workflowId === input.workflowId &&
        run.workflowName === input.workflowName,
    ),
  );

  if (sourceMode === "explicit") {
    const ids = input.explicitSessionIds ?? [];
    const byId = new Map(runs.map((run) => [run.sessionId, run]));
    return ids.map((sessionId) => {
      const run = byId.get(sessionId);
      if (run === undefined) {
        throw new Error(
          `explicit source session '${sessionId}' does not belong to workflow '${input.workflowName}'`,
        );
      }
      return run;
    });
  }

  if (sourceMode === "latest") {
    return runs.slice(0, input.limit);
  }

  const markerTime = input.marker?.completedAt;
  const sinceLast =
    markerTime === undefined
      ? []
      : runs.filter((run) => runTime(run) > markerTime);
  if (sourceMode === "since-last") {
    return sinceLast;
  }
  return markerTime === undefined ? runs.slice(0, input.limit) : sinceLast;
}
