import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { WorkflowExecutionCompactSummary } from "../shared/ui-contract";
import { err, ok, type Result } from "./result";
import type { WorkflowCatalogFailure } from "./catalog";
import {
  listWorkflowCatalogSources,
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "./catalog";
import {
  isTerminalWorkflowSessionStatus,
  resolveCurrentStepId,
  type WorkflowSessionState,
} from "./session";
import {
  listSessions,
  loadSession,
  type SessionStoreFailure,
  type SessionStoreOptions,
} from "./session-store";
import type {
  LoadOptions,
  ResolvedWorkflowSource,
  WorkflowScopeSelector,
  WorkflowSourceScope,
} from "./types";

export type WorkflowOverviewSourceScope = WorkflowSourceScope;

export type WorkflowOverviewStatus =
  | WorkflowSessionState["status"]
  | "never-run";

export interface WorkflowOverviewRow {
  readonly workflowName: string;
  readonly sourceScope: WorkflowOverviewSourceScope;
  readonly workflowDirectory: string;
  readonly description: string;
  readonly aggregateStatus: WorkflowOverviewStatus;
  readonly activeExecutionCount: number;
  readonly latestExecution: WorkflowExecutionCompactSummary | null;
}

export interface WorkflowStatusOverview extends WorkflowOverviewRow {
  readonly recentExecutions: readonly WorkflowExecutionCompactSummary[];
  /** Newest non-terminal execution among running/paused, from full history (not the recent slice). */
  readonly newestActiveExecution: WorkflowExecutionCompactSummary | null;
}

export interface WorkflowOverviewQueryOptions extends LoadOptions {
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
  readonly fixedWorkflowName?: string;
}

export interface WorkflowCatalogOverviewInput {
  readonly workflowScope?: WorkflowScopeSelector;
  readonly status?: WorkflowOverviewStatus;
  readonly limit?: number;
}

export interface WorkflowStatusOverviewInput {
  readonly workflowName: string;
  readonly workflowScope?: WorkflowScopeSelector;
  readonly limit?: number;
}

export interface WorkflowCatalogOverview {
  readonly workflows: readonly WorkflowOverviewRow[];
}

export type WorkflowOverviewBuildContext = LoadOptions &
  SessionStoreOptions & {
    readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
  };

/** True when `candidate` identifies the same scoped bundle as `pinned`. */
export function workflowOverviewSourcesMatch(
  pinned: ResolvedWorkflowSource,
  candidate: ResolvedWorkflowSource,
): boolean {
  return (
    pinned.workflowName === candidate.workflowName &&
    pinned.scope === candidate.scope &&
    pinned.workflowDirectory === candidate.workflowDirectory
  );
}

/** Sort newest-first by `startedAt`, then `workflowExecutionId` for stable ties. */
export function compareWorkflowExecutionsNewestFirst(
  a: WorkflowExecutionCompactSummary,
  b: WorkflowExecutionCompactSummary,
): number {
  const byTime = b.startedAt.localeCompare(a.startedAt);
  if (byTime !== 0) {
    return byTime;
  }
  return b.workflowExecutionId.localeCompare(a.workflowExecutionId);
}

export function sortWorkflowExecutionsNewestFirst(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowExecutionCompactSummary[] {
  return [...executions].sort(compareWorkflowExecutionsNewestFirst);
}

export function countActiveWorkflowExecutions(
  executions: readonly WorkflowExecutionCompactSummary[],
): number {
  let n = 0;
  for (const e of executions) {
    if (isWorkflowExecutionSummaryActive(e)) {
      n += 1;
    }
  }
  return n;
}

export function isWorkflowExecutionSummaryActive(
  summary: WorkflowExecutionCompactSummary,
): boolean {
  return summary.status === "running" || summary.status === "paused";
}

/**
 * Among running/paused executions, return the newest by {@link compareWorkflowExecutionsNewestFirst}.
 */
export function pickNewestActiveExecution(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowExecutionCompactSummary | null {
  const actives = executions.filter(isWorkflowExecutionSummaryActive);
  if (actives.length === 0) {
    return null;
  }
  return sortWorkflowExecutionsNewestFirst(actives)[0] ?? null;
}

/**
 * Compact execution row from persisted session state only (no workflow bundle
 * lookups and no runtime DB node logs or communications).
 */
export function workflowExecutionCompactSummaryFromSession(
  session: WorkflowSessionState,
): WorkflowExecutionCompactSummary {
  const currentStepId = resolveCurrentStepId(session);
  return {
    workflowExecutionId: session.sessionId,
    sessionId: session.sessionId,
    workflowName: session.workflowName,
    status: session.status,
    currentNodeId: session.currentNodeId ?? null,
    ...(currentStepId === null ? {} : { currentStepId }),
    nodeExecutionCounter: session.nodeExecutionCounter,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? null,
  };
}

/**
 * Aggregate workflow status from executions: any `running`, then any `paused`,
 * else status of the newest terminal execution, else `never-run`.
 */
export function deriveWorkflowOverviewStatus(
  executions: readonly WorkflowExecutionCompactSummary[],
): WorkflowOverviewStatus {
  if (executions.length === 0) {
    return "never-run";
  }

  let sawRunning = false;
  let sawPaused = false;
  for (const e of executions) {
    if (e.status === "running") {
      sawRunning = true;
    }
    if (e.status === "paused") {
      sawPaused = true;
    }
  }
  if (sawRunning) {
    return "running";
  }
  if (sawPaused) {
    return "paused";
  }

  const sorted = sortWorkflowExecutionsNewestFirst(executions);
  for (const e of sorted) {
    if (isTerminalWorkflowSessionStatus(e.status)) {
      return e.status;
    }
  }

  return "never-run";
}

type OverviewLoadOptions = LoadOptions & SessionStoreOptions;

interface WorkflowOverviewActiveCandidate {
  readonly sessionId: string;
  readonly source: "session-store";
}

interface LoadableWorkflowOverviewSession {
  readonly session: WorkflowSessionState;
  readonly summary: WorkflowExecutionCompactSummary;
}

async function workflowOverviewBundleExists(
  workflowDirectory: string,
): Promise<Result<boolean, WorkflowCatalogFailure>> {
  const filePath = path.join(workflowDirectory, "workflow.json");
  try {
    const st = await stat(filePath);
    return ok(st.isFile());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (
      typeof message === "string" &&
      (message.includes("ENOENT") ||
        message.includes("no such file") ||
        message.includes("ENOTDIR"))
    ) {
      return ok(false);
    }
    return err({
      code: "IO",
      message: `failed inspecting workflow overview bundle path: ${message}`,
    });
  }
}

async function readWorkflowOverviewMeta(
  workflowDirectory: string,
): Promise<
  Result<
    { readonly workflowId: string; readonly description: string },
    WorkflowCatalogFailure
  >
> {
  const filePath = path.join(workflowDirectory, "workflow.json");
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed reading workflow overview meta: ${message}`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return err({
      code: "IO",
      message: "workflow.json is not valid JSON",
    });
  }
  if (typeof parsed !== "object" || parsed === null) {
    return err({
      code: "IO",
      message: "workflow.json must be an object",
    });
  }
  const wfIdRaw = (parsed as { workflowId?: unknown }).workflowId;
  if (typeof wfIdRaw !== "string" || wfIdRaw.length === 0) {
    return err({
      code: "IO",
      message: "workflow.json is missing workflowId",
    });
  }
  const descRaw = (parsed as { description?: unknown }).description;
  const description = typeof descRaw === "string" ? descRaw : "";
  return ok({ workflowId: wfIdRaw, description });
}

async function loadWorkflowOverviewSessionCandidate(
  candidate: WorkflowOverviewActiveCandidate,
  source: ResolvedWorkflowSource,
  canonicalWorkflowId: string,
  scopedOptions: OverviewLoadOptions,
): Promise<LoadableWorkflowOverviewSession | null> {
  const loaded = await loadSession(candidate.sessionId, scopedOptions);
  if (!loaded.ok) {
    return null;
  }
  const session = loaded.value;
  if (
    session.workflowName !== source.workflowName ||
    session.workflowId !== canonicalWorkflowId
  ) {
    return null;
  }
  return {
    session,
    summary: workflowExecutionCompactSummaryFromSession(session),
  };
}

async function collectCompactSummariesForSource(
  source: ResolvedWorkflowSource,
  canonicalWorkflowId: string,
  baseOptions: OverviewLoadOptions,
): Promise<
  Result<readonly WorkflowExecutionCompactSummary[], SessionStoreFailure>
> {
  const scoped = withResolvedWorkflowSourceOptions(source, baseOptions);
  const listed = await listSessions(scoped);
  if (!listed.ok) {
    return listed;
  }
  const summaries: WorkflowExecutionCompactSummary[] = [];
  for (const sessionId of listed.value) {
    const loadedCandidate = await loadWorkflowOverviewSessionCandidate(
      { sessionId, source: "session-store" },
      source,
      canonicalWorkflowId,
      scoped,
    );
    if (loadedCandidate === null) {
      continue;
    }
    summaries.push(loadedCandidate.summary);
  }
  return ok(sortWorkflowExecutionsNewestFirst(summaries));
}

function mergeOverviewBaseOptions(
  input: { readonly workflowScope?: WorkflowScopeSelector },
  options: OverviewLoadOptions | undefined,
): OverviewLoadOptions {
  return {
    ...(options ?? {}),
    ...(input.workflowScope === undefined
      ? {}
      : { workflowScope: input.workflowScope }),
  };
}

function buildOverviewRow(
  source: ResolvedWorkflowSource,
  description: string,
  sortedExecutions: readonly WorkflowExecutionCompactSummary[],
): WorkflowOverviewRow {
  const aggregateStatus = deriveWorkflowOverviewStatus(sortedExecutions);
  return {
    workflowName: source.workflowName,
    sourceScope: source.scope,
    workflowDirectory: source.workflowDirectory,
    description,
    aggregateStatus,
    activeExecutionCount: countActiveWorkflowExecutions(sortedExecutions),
    latestExecution: sortedExecutions[0] ?? null,
  };
}

export async function buildWorkflowCatalogOverview(
  input: WorkflowCatalogOverviewInput,
  options?: WorkflowOverviewBuildContext,
): Promise<
  Result<WorkflowCatalogOverview, WorkflowCatalogFailure | SessionStoreFailure>
> {
  const baseOptions = mergeOverviewBaseOptions(input, options);
  const sourcesResult = await listWorkflowCatalogSources(baseOptions);
  if (!sourcesResult.ok) {
    return sourcesResult;
  }

  const fixedPin = options?.fixedResolvedWorkflowSource;
  const catalogSources =
    fixedPin === undefined
      ? sourcesResult.value
      : sourcesResult.value.filter((s) =>
          workflowOverviewSourcesMatch(fixedPin, s),
        );

  const rows: WorkflowOverviewRow[] = [];
  for (const source of catalogSources) {
    const meta = await readWorkflowOverviewMeta(source.workflowDirectory);
    if (!meta.ok) {
      return meta;
    }
    const execs = await collectCompactSummariesForSource(
      source,
      meta.value.workflowId,
      baseOptions,
    );
    if (!execs.ok) {
      return execs;
    }
    const row = buildOverviewRow(source, meta.value.description, execs.value);
    if (input.status !== undefined && row.aggregateStatus !== input.status) {
      continue;
    }
    rows.push(row);
  }

  const limited =
    input.limit === undefined ? rows : rows.slice(0, Math.max(0, input.limit));

  return ok({ workflows: limited });
}

export async function buildWorkflowStatusOverview(
  input: WorkflowStatusOverviewInput,
  options?: WorkflowOverviewBuildContext,
): Promise<
  Result<WorkflowStatusOverview, WorkflowCatalogFailure | SessionStoreFailure>
> {
  const baseOptions = mergeOverviewBaseOptions(input, options);
  const resolved = await resolveWorkflowSource(input.workflowName, baseOptions);
  if (!resolved.ok) {
    return resolved;
  }
  const source = resolved.value;

  const exists = await workflowOverviewBundleExists(source.workflowDirectory);
  if (!exists.ok) {
    return exists;
  }
  if (!exists.value) {
    return err({
      code: "NOT_FOUND",
      message: `workflow '${input.workflowName}' was not found in workflow root '${source.workflowRoot}'`,
    });
  }

  const meta = await readWorkflowOverviewMeta(source.workflowDirectory);
  if (!meta.ok) {
    return meta;
  }
  const execs = await collectCompactSummariesForSource(
    source,
    meta.value.workflowId,
    baseOptions,
  );
  if (!execs.ok) {
    return execs;
  }
  const sorted = [...execs.value];
  const newestActiveExecution = pickNewestActiveExecution(sorted);
  const recentExecutions =
    input.limit === undefined
      ? sorted
      : sorted.slice(0, Math.max(0, input.limit));
  const baseRow = buildOverviewRow(source, meta.value.description, sorted);
  return ok({
    ...baseRow,
    recentExecutions,
    newestActiveExecution,
  });
}

const WORKFLOW_OVERVIEW_STATUS_FILTER_ALLOWED: readonly WorkflowOverviewStatus[] =
  ["running", "paused", "completed", "failed", "cancelled", "never-run"];

export function parseWorkflowOverviewAggregateStatusFilter(
  raw: string | undefined,
): Result<WorkflowOverviewStatus | undefined, string> {
  if (raw === undefined || raw.length === 0) {
    return ok(undefined);
  }
  if (
    (WORKFLOW_OVERVIEW_STATUS_FILTER_ALLOWED as readonly string[]).includes(raw)
  ) {
    return ok(raw as WorkflowOverviewStatus);
  }
  return err(
    `invalid --status value '${raw}'; expected one of: ${WORKFLOW_OVERVIEW_STATUS_FILTER_ALLOWED.join(", ")}`,
  );
}

export function workflowStatusOverviewInputFromOverviewRow(
  row: WorkflowOverviewRow,
): Pick<WorkflowStatusOverviewInput, "workflowName" | "workflowScope"> {
  if (row.sourceScope === "direct") {
    return { workflowName: row.workflowName };
  }
  return { workflowName: row.workflowName, workflowScope: row.sourceScope };
}

export interface SelectDefaultWorkflowOverviewRowOptions {
  readonly fixedWorkflowName?: string;
  readonly fixedResolvedWorkflowSource?: ResolvedWorkflowSource;
}

export function selectDefaultWorkflowOverviewRow(
  rows: readonly WorkflowOverviewRow[],
  options?: SelectDefaultWorkflowOverviewRowOptions,
): WorkflowOverviewRow | null {
  if (rows.length === 0) {
    return null;
  }
  const pool =
    options?.fixedWorkflowName === undefined
      ? rows
      : rows.filter((r) => {
          if (r.workflowName !== options.fixedWorkflowName) {
            return false;
          }
          const pin = options.fixedResolvedWorkflowSource;
          if (pin === undefined) {
            return true;
          }
          return (
            r.sourceScope === pin.scope &&
            r.workflowDirectory === pin.workflowDirectory &&
            r.workflowName === pin.workflowName
          );
        });
  if (pool.length === 0) {
    return null;
  }
  const running = pool.find((r) => r.aggregateStatus === "running");
  if (running !== undefined) {
    return running;
  }
  const paused = pool.find((r) => r.aggregateStatus === "paused");
  if (paused !== undefined) {
    return paused;
  }
  let best: WorkflowOverviewRow | null = null;
  let bestKey = "";
  for (const row of pool) {
    const latest = row.latestExecution;
    if (latest === null) {
      continue;
    }
    const key = `${latest.startedAt}\0${latest.workflowExecutionId}`;
    if (key > bestKey) {
      bestKey = key;
      best = row;
    }
  }
  if (best !== null) {
    return best;
  }
  return pool[0] ?? null;
}
