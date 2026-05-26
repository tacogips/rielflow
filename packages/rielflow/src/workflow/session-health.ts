import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadWorkflowFromCatalog } from "./load";
import {
  loadRuntimeSessionSummary,
  listRuntimeLlmSessionMessages,
  listRuntimeNodeExecutions,
  listRuntimeNodeLogs,
  type RuntimeLlmSessionMessageRecord,
  type RuntimeNodeExecutionSummary,
  type RuntimeNodeLogEntry,
} from "./runtime-db";
import { buildFanoutGroupSummaries, type FanoutGroupSummary } from "./inspect";
import {
  isTerminalWorkflowSessionStatus,
  resolveCurrentStepId,
  type WorkflowSessionState,
} from "./session";
import { loadSession, type SessionStoreOptions } from "./session-store";
import { getNormalizedNodePayload, type LoadOptions } from "./types";

export type SessionHealthState = "running" | "stalled" | "terminal" | "unknown";
export type HealthConfidence = "high" | "medium" | "low" | "unknown";
export type LiveSignalStatus = "unknown" | "not-proven" | "active" | "inactive";
export type EvidenceSourceStatus =
  | "available"
  | "missing"
  | "partial"
  | "disabled";
export type SessionHealthRecommendation =
  | "wait"
  | "inspect_logs"
  | "rerun_step"
  | "resume_session"
  | "terminate_orphan"
  | "unknown";

export interface BuildSessionHealthInput {
  readonly sessionId: string;
  readonly options?: LoadOptions & SessionStoreOptions;
  readonly live?: boolean;
  readonly stallTimeoutMs?: number;
  readonly logLimit?: number;
  readonly includeLlmMessages?: boolean;
  readonly llmLimit?: number;
  readonly observedAt?: string;
}

export interface SessionHealthPersistedState {
  readonly status: WorkflowSessionState["status"];
  readonly queue: readonly string[];
  readonly restartCount: number;
  readonly lastCompletedStepId: string | null;
  readonly lastError: string | null;
  readonly fanoutSummaries: readonly FanoutGroupSummary[];
  readonly supervision: {
    readonly autoImprove: boolean;
    readonly nestedSuperviser: boolean;
    readonly stallTimeoutMs: number | null;
  } | null;
}

export interface SessionHealthSummary {
  readonly state: SessionHealthState;
  readonly confidence: HealthConfidence;
  readonly reason: string;
  readonly observedAt: string;
  readonly recommendation: SessionHealthRecommendation;
}

export interface SessionHealthActiveNode {
  readonly known: boolean;
  readonly stepId: string | null;
  readonly nodeId: string | null;
  readonly nodeExecId: string | null;
  readonly backend: string | null;
  readonly backendSessionId: string | null;
  readonly startedAt: string | null;
  readonly elapsedMs: number | null;
  readonly timeoutMs: number | null;
  readonly stalled: boolean | null;
}

export interface SessionHealthLiveSignal {
  readonly status: LiveSignalStatus;
  readonly confidence: HealthConfidence;
  readonly source:
    | "not-requested"
    | "persisted-runtime-state"
    | "adapter-live-check"
    | "process-table"
    | "not-supported";
  readonly requested: boolean;
}

export interface SessionHealthProgressSignal {
  readonly lastProgressAt: string | null;
  readonly lastProgressSource: string | null;
  readonly stallTimeoutMs: number | null;
  readonly stalled: boolean | null;
}

export interface SessionHealthArtifactSummary {
  readonly latestArtifactAt: string | null;
  readonly latestCandidateAt: string | null;
  readonly activeArtifactDirs: readonly string[];
  readonly recentCandidatePaths: readonly string[];
  readonly recentOutputPaths: readonly string[];
}

export interface SessionHealthEvidenceCompleteness {
  readonly sessionStore: EvidenceSourceStatus;
  readonly runtimeDb: EvidenceSourceStatus;
  readonly artifacts: EvidenceSourceStatus;
  readonly processLogs: EvidenceSourceStatus;
  readonly llmMessages: EvidenceSourceStatus;
}

export interface SessionHealthReport {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: WorkflowSessionState["status"];
  readonly currentStepId: string | null;
  readonly currentNodeId: string | null;
  readonly persistedState: SessionHealthPersistedState;
  readonly health: SessionHealthSummary;
  readonly activeNode: SessionHealthActiveNode;
  readonly liveSignal: SessionHealthLiveSignal;
  readonly progressSignal: SessionHealthProgressSignal;
  readonly artifacts: SessionHealthArtifactSummary;
  readonly recentLogs: readonly RuntimeNodeLogEntry[];
  readonly recentLlmMessages: readonly RuntimeLlmSessionMessageRecord[];
  readonly evidenceCompleteness: SessionHealthEvidenceCompleteness;
}

const DEFAULT_LOG_LIMIT = 20;
const DEFAULT_LLM_LIMIT = 10;
const MAX_LOG_LIMIT = 100;
const MAX_LLM_LIMIT = 50;
const MAX_ARTIFACT_DIRS = 8;
const MAX_FILES_PER_ARTIFACT_DIR = 80;
const MAX_TOTAL_ARTIFACT_FILES = 300;
const MAX_SCAN_DEPTH = 2;
const RECENT_PATH_LIMIT = 20;

interface ProgressEvidence {
  readonly at: string;
  readonly source: string;
}

interface EvidenceRead<T> {
  readonly rows: readonly T[];
  readonly status: EvidenceSourceStatus;
}

interface ArtifactScanState {
  latestArtifactAt: string | null;
  latestCandidateAt: string | null;
  readonly candidatePaths: string[];
  readonly outputPaths: string[];
  existingDirs: number;
  missingDirs: number;
  scannedFiles: number;
}

function clampLimit(
  value: number | undefined,
  defaultValue: number,
  maxValue: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.min(maxValue, Math.max(0, Math.trunc(value)));
}

function latestByTime<T>(
  rows: readonly T[],
  readAt: (row: T) => string | null | undefined,
): T | null {
  let latest: T | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const at = readAt(row);
    if (at === null || at === undefined) {
      continue;
    }
    const ms = Date.parse(at);
    if (!Number.isFinite(ms) || ms < latestMs) {
      continue;
    }
    latest = row;
    latestMs = ms;
  }
  return latest;
}

function addProgressEvidence(
  evidence: ProgressEvidence[],
  at: string | null | undefined,
  source: string,
): void {
  if (at === null || at === undefined || !Number.isFinite(Date.parse(at))) {
    return;
  }
  evidence.push({ at, source });
}

function latestProgress(
  evidence: readonly ProgressEvidence[],
): ProgressEvidence | null {
  return latestByTime(evidence, (entry) => entry.at);
}

function countRestarts(session: WorkflowSessionState): number {
  if (session.restartEvents !== undefined) {
    return session.restartEvents.length;
  }
  const counts = session.restartCounts ?? {};
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function lastCompletedStepId(session: WorkflowSessionState): string | null {
  const latestExecution = latestByTime(
    session.nodeExecutions.filter(
      (execution) => execution.status === "succeeded",
    ),
    (execution) => execution.endedAt,
  );
  return latestExecution?.stepId ?? latestExecution?.nodeId ?? null;
}

function resolvePersistedStallTimeoutMs(
  session: WorkflowSessionState,
): number | null {
  return session.supervision?.policy?.stallTimeoutMs ?? null;
}

function buildPersistedState(
  session: WorkflowSessionState,
): SessionHealthPersistedState {
  const supervision =
    session.supervision === undefined
      ? null
      : {
          autoImprove: session.supervision.policy?.enabled === true,
          nestedSuperviser:
            session.supervision.nestedSuperviserSessionId !== undefined,
          stallTimeoutMs: resolvePersistedStallTimeoutMs(session),
        };
  return {
    status: session.status,
    queue: session.queue,
    restartCount: countRestarts(session),
    lastCompletedStepId: lastCompletedStepId(session),
    lastError: session.lastError ?? null,
    fanoutSummaries: buildFanoutGroupSummaries(session),
    supervision,
  };
}

async function readRuntimeEvidence<T>(
  read: () => Promise<readonly T[]>,
): Promise<EvidenceRead<T>> {
  try {
    const rows = await read();
    return {
      rows,
      status: rows.length > 0 ? "available" : "missing",
    };
  } catch {
    return { rows: [], status: "partial" };
  }
}

async function readRuntimeSessionUpdatedAt(
  sessionId: string,
  options: LoadOptions,
): Promise<{
  readonly updatedAt: string | null;
  readonly status: EvidenceSourceStatus;
}> {
  try {
    const summary = await loadRuntimeSessionSummary(sessionId, options);
    return {
      updatedAt: summary?.updatedAt ?? null,
      status: summary === null ? "missing" : "available",
    };
  } catch {
    return { updatedAt: null, status: "partial" };
  }
}

function collectArtifactDirs(input: {
  readonly session: WorkflowSessionState;
  readonly runtimeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly currentStepId: string | null;
  readonly currentNodeId: string | null;
}): readonly string[] {
  const dirs: string[] = [];
  const add = (dir: string | null | undefined): void => {
    if (dir === null || dir === undefined || dir.length === 0) {
      return;
    }
    if (!dirs.includes(dir)) {
      dirs.push(dir);
    }
  };

  for (const execution of input.runtimeExecutions) {
    if (
      execution.stepId === input.currentStepId ||
      execution.nodeId === input.currentNodeId
    ) {
      add(execution.artifactDir);
    }
  }
  for (const execution of input.session.nodeExecutions) {
    if (
      execution.stepId === input.currentStepId ||
      execution.nodeId === input.currentNodeId
    ) {
      add(execution.artifactDir);
    }
  }
  for (const execution of [...input.runtimeExecutions].reverse()) {
    add(execution.artifactDir);
    if (dirs.length >= MAX_ARTIFACT_DIRS) {
      return dirs;
    }
  }
  for (const execution of [...input.session.nodeExecutions].reverse()) {
    add(execution.artifactDir);
    if (dirs.length >= MAX_ARTIFACT_DIRS) {
      return dirs;
    }
  }
  for (const communication of [...input.session.communications].reverse()) {
    add(communication.artifactDir);
    if (dirs.length >= MAX_ARTIFACT_DIRS) {
      return dirs;
    }
  }

  return dirs.slice(0, MAX_ARTIFACT_DIRS);
}

function isCandidatePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return (
    normalized.includes("candidate") ||
    normalized.includes("attempt") ||
    normalized.includes("validation")
  );
}

function isOutputPath(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  return (
    basename === "output.json" ||
    basename === "request.json" ||
    basename.includes("output")
  );
}

function updateLatestTimestamp(
  current: string | null,
  candidate: string,
): string {
  if (current === null) {
    return candidate;
  }
  return Date.parse(candidate) >= Date.parse(current) ? candidate : current;
}

async function scanArtifactDir(
  dir: string,
  state: ArtifactScanState,
  depth = 0,
): Promise<void> {
  if (
    depth > MAX_SCAN_DEPTH ||
    state.scannedFiles >= MAX_TOTAL_ARTIFACT_FILES
  ) {
    return;
  }

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
    state.existingDirs += depth === 0 ? 1 : 0;
  } catch {
    state.missingDirs += depth === 0 ? 1 : 0;
    return;
  }

  let localFiles = 0;
  for (const entry of entries) {
    if (
      state.scannedFiles >= MAX_TOTAL_ARTIFACT_FILES ||
      localFiles >= MAX_FILES_PER_ARTIFACT_DIR
    ) {
      return;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanArtifactDir(entryPath, state, depth + 1);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    localFiles += 1;
    state.scannedFiles += 1;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(entryPath);
    } catch {
      continue;
    }
    const mtime = fileStat.mtime.toISOString();
    state.latestArtifactAt = updateLatestTimestamp(
      state.latestArtifactAt,
      mtime,
    );
    if (isCandidatePath(entryPath)) {
      state.latestCandidateAt = updateLatestTimestamp(
        state.latestCandidateAt,
        mtime,
      );
      if (state.candidatePaths.length < RECENT_PATH_LIMIT) {
        state.candidatePaths.push(entryPath);
      }
    }
    if (
      isOutputPath(entryPath) &&
      state.outputPaths.length < RECENT_PATH_LIMIT
    ) {
      state.outputPaths.push(entryPath);
    }
  }
}

async function scanArtifacts(dirs: readonly string[]): Promise<{
  readonly summary: SessionHealthArtifactSummary;
  readonly status: EvidenceSourceStatus;
}> {
  const state: ArtifactScanState = {
    latestArtifactAt: null,
    latestCandidateAt: null,
    candidatePaths: [],
    outputPaths: [],
    existingDirs: 0,
    missingDirs: 0,
    scannedFiles: 0,
  };

  for (const dir of dirs) {
    await scanArtifactDir(dir, state);
  }

  const status: EvidenceSourceStatus =
    dirs.length === 0 || state.existingDirs === 0
      ? "missing"
      : state.missingDirs > 0
        ? "partial"
        : "available";
  return {
    summary: {
      latestArtifactAt: state.latestArtifactAt,
      latestCandidateAt: state.latestCandidateAt,
      activeArtifactDirs: dirs,
      recentCandidatePaths: state.candidatePaths,
      recentOutputPaths: state.outputPaths,
    },
    status,
  };
}

function selectRecent<T>(
  rows: readonly T[],
  limit: number,
  readAt: (row: T) => string,
): readonly T[] {
  if (limit === 0) {
    return [];
  }
  return [...rows]
    .sort((left, right) => Date.parse(readAt(right)) - Date.parse(readAt(left)))
    .slice(0, limit)
    .reverse();
}

function selectActiveRuntimeExecution(input: {
  readonly currentStepId: string | null;
  readonly currentNodeId: string | null;
  readonly runtimeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly session: WorkflowSessionState;
}): RuntimeNodeExecutionSummary | null {
  const matching = input.runtimeExecutions.filter(
    (execution) =>
      execution.stepId === input.currentStepId ||
      execution.nodeId === input.currentNodeId,
  );
  if (matching.length > 0) {
    return latestByTime(matching, (execution) => execution.endedAt);
  }
  return latestByTime(
    input.runtimeExecutions,
    (execution) => execution.endedAt,
  );
}

async function resolveBackend(input: {
  readonly session: WorkflowSessionState;
  readonly nodeId: string | null;
  readonly options: LoadOptions;
}): Promise<string | null> {
  if (input.nodeId === null) {
    return null;
  }
  try {
    const loaded = await loadWorkflowFromCatalog(
      input.session.workflowName,
      input.options,
    );
    if (
      !loaded.ok ||
      loaded.value.bundle.workflow.workflowId !== input.session.workflowId
    ) {
      return null;
    }
    const payload = getNormalizedNodePayload(loaded.value.bundle, input.nodeId);
    return payload?.executionBackend ?? null;
  } catch {
    return null;
  }
}

async function buildActiveNode(input: {
  readonly session: WorkflowSessionState;
  readonly currentStepId: string | null;
  readonly currentNodeId: string | null;
  readonly runtimeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly observedAt: string;
  readonly stalled: boolean | null;
  readonly options: LoadOptions;
}): Promise<SessionHealthActiveNode> {
  const runtimeExecution = selectActiveRuntimeExecution(input);
  const persistedExecution = latestByTime(
    input.session.nodeExecutions.filter(
      (execution) =>
        execution.stepId === input.currentStepId ||
        execution.nodeId === input.currentNodeId,
    ),
    (execution) => execution.endedAt,
  );
  const nodeId =
    input.currentNodeId ??
    runtimeExecution?.nodeId ??
    persistedExecution?.nodeId ??
    null;
  const stepId =
    input.currentStepId ??
    runtimeExecution?.stepId ??
    persistedExecution?.stepId ??
    null;
  const startedAt =
    runtimeExecution?.startedAt ?? persistedExecution?.startedAt ?? null;
  const timeoutMs =
    runtimeExecution?.timeoutMs ?? persistedExecution?.timeoutMs ?? null;
  const backend = await resolveBackend({
    session: input.session,
    nodeId,
    options: input.options,
  });
  return {
    known: nodeId !== null || stepId !== null || runtimeExecution !== null,
    stepId,
    nodeId,
    nodeExecId:
      runtimeExecution?.nodeExecId ?? persistedExecution?.nodeExecId ?? null,
    backend,
    backendSessionId:
      runtimeExecution?.backendSessionId ??
      persistedExecution?.backendSessionId ??
      null,
    startedAt,
    elapsedMs:
      startedAt === null
        ? null
        : Math.max(0, Date.parse(input.observedAt) - Date.parse(startedAt)),
    timeoutMs,
    stalled: input.stalled,
  };
}

function deriveLiveSignal(requested: boolean): SessionHealthLiveSignal {
  return {
    status: requested ? "not-proven" : "unknown",
    confidence: "unknown",
    source: requested ? "not-supported" : "not-requested",
    requested,
  };
}

function deriveHealth(input: {
  readonly session: WorkflowSessionState;
  readonly observedAt: string;
  readonly lastProgress: ProgressEvidence | null;
  readonly stallTimeoutMs: number | null;
  readonly runtimeStatus: EvidenceSourceStatus;
  readonly artifactStatus: EvidenceSourceStatus;
}): {
  readonly health: SessionHealthSummary;
  readonly progressSignal: SessionHealthProgressSignal;
} {
  const terminal = isTerminalWorkflowSessionStatus(input.session.status);
  const observedMs = Date.parse(input.observedAt);
  const lastProgressMs =
    input.lastProgress === null ? null : Date.parse(input.lastProgress.at);
  const stalled =
    terminal || input.stallTimeoutMs === null || lastProgressMs === null
      ? null
      : observedMs - lastProgressMs > input.stallTimeoutMs;

  if (terminal) {
    const recommendation =
      input.session.status === "completed" ? "unknown" : "rerun_step";
    return {
      health: {
        state: "terminal",
        confidence: "high",
        reason: `session is ${input.session.status}`,
        observedAt: input.observedAt,
        recommendation,
      },
      progressSignal: {
        lastProgressAt: input.lastProgress?.at ?? null,
        lastProgressSource: input.lastProgress?.source ?? null,
        stallTimeoutMs: input.stallTimeoutMs,
        stalled: null,
      },
    };
  }

  if (input.stallTimeoutMs === null) {
    return {
      health: {
        state: "unknown",
        confidence: "unknown",
        reason: "no stall timeout is configured or supplied",
        observedAt: input.observedAt,
        recommendation:
          input.session.status === "paused" ? "resume_session" : "unknown",
      },
      progressSignal: {
        lastProgressAt: input.lastProgress?.at ?? null,
        lastProgressSource: input.lastProgress?.source ?? null,
        stallTimeoutMs: null,
        stalled: null,
      },
    };
  }

  if (input.lastProgress === null || lastProgressMs === null) {
    return {
      health: {
        state: "unknown",
        confidence: "low",
        reason: "no progress evidence was found",
        observedAt: input.observedAt,
        recommendation: "inspect_logs",
      },
      progressSignal: {
        lastProgressAt: null,
        lastProgressSource: null,
        stallTimeoutMs: input.stallTimeoutMs,
        stalled: null,
      },
    };
  }

  if (stalled === true) {
    const confidence =
      input.runtimeStatus === "available" && input.artifactStatus !== "missing"
        ? "medium"
        : "low";
    return {
      health: {
        state: "stalled",
        confidence,
        reason: `no progress evidence for ${String(
          observedMs - lastProgressMs,
        )}ms`,
        observedAt: input.observedAt,
        recommendation: "inspect_logs",
      },
      progressSignal: {
        lastProgressAt: input.lastProgress.at,
        lastProgressSource: input.lastProgress.source,
        stallTimeoutMs: input.stallTimeoutMs,
        stalled: true,
      },
    };
  }

  return {
    health: {
      state: "running",
      confidence: input.runtimeStatus === "available" ? "medium" : "low",
      reason: `last progress evidence is within ${String(
        input.stallTimeoutMs,
      )}ms`,
      observedAt: input.observedAt,
      recommendation: "wait",
    },
    progressSignal: {
      lastProgressAt: input.lastProgress.at,
      lastProgressSource: input.lastProgress.source,
      stallTimeoutMs: input.stallTimeoutMs,
      stalled: false,
    },
  };
}

function collectProgressEvidence(input: {
  readonly session: WorkflowSessionState;
  readonly runtimeUpdatedAt: string | null;
  readonly runtimeExecutions: readonly RuntimeNodeExecutionSummary[];
  readonly logs: readonly RuntimeNodeLogEntry[];
  readonly llmMessages: readonly RuntimeLlmSessionMessageRecord[];
  readonly artifacts: SessionHealthArtifactSummary;
}): readonly ProgressEvidence[] {
  const evidence: ProgressEvidence[] = [];
  addProgressEvidence(evidence, input.session.startedAt, "session-started");
  addProgressEvidence(evidence, input.session.endedAt, "session-ended");
  addProgressEvidence(evidence, input.runtimeUpdatedAt, "session-updated");
  for (const transition of input.session.transitions) {
    addProgressEvidence(
      evidence,
      transition.when,
      "workflow-status-transition",
    );
  }
  for (const execution of input.session.nodeExecutions) {
    addProgressEvidence(
      evidence,
      execution.startedAt,
      "node-execution-started",
    );
    addProgressEvidence(evidence, execution.endedAt, "node-execution-ended");
  }
  for (const execution of input.runtimeExecutions) {
    addProgressEvidence(
      evidence,
      execution.startedAt,
      "node-execution-started",
    );
    addProgressEvidence(evidence, execution.endedAt, "node-execution-ended");
    addProgressEvidence(
      evidence,
      execution.createdAt,
      "node-execution-indexed",
    );
  }
  for (const communication of input.session.communications) {
    addProgressEvidence(
      evidence,
      communication.createdAt,
      "communication-created",
    );
    addProgressEvidence(
      evidence,
      communication.deliveredAt,
      "communication-delivered",
    );
    addProgressEvidence(
      evidence,
      communication.consumedAt,
      "communication-consumed",
    );
    addProgressEvidence(
      evidence,
      communication.supersededAt,
      "communication-superseded",
    );
  }
  for (const log of input.logs) {
    addProgressEvidence(evidence, log.at, "node-log");
  }
  for (const message of input.llmMessages) {
    addProgressEvidence(evidence, message.at, "llm-message");
  }
  addProgressEvidence(evidence, input.artifacts.latestArtifactAt, "artifact");
  addProgressEvidence(
    evidence,
    input.artifacts.latestCandidateAt,
    "candidate-artifact",
  );
  return evidence;
}

export async function buildSessionHealthReport(
  input: BuildSessionHealthInput,
): Promise<SessionHealthReport> {
  const options = input.options ?? {};
  const sessionResult = await loadSession(input.sessionId, options);
  if (!sessionResult.ok) {
    throw new Error(sessionResult.error.message);
  }

  const session = sessionResult.value;
  const observedAt = input.observedAt ?? new Date().toISOString();
  const logLimit = clampLimit(input.logLimit, DEFAULT_LOG_LIMIT, MAX_LOG_LIMIT);
  const llmLimit = clampLimit(input.llmLimit, DEFAULT_LLM_LIMIT, MAX_LLM_LIMIT);
  const includeLlmMessages = input.includeLlmMessages === true;
  const currentStepId = resolveCurrentStepId(session);
  const currentNodeId = session.currentNodeId ?? null;

  const runtimeSession = await readRuntimeSessionUpdatedAt(
    input.sessionId,
    options,
  );
  const runtimeExecutions = await readRuntimeEvidence(() =>
    listRuntimeNodeExecutions(input.sessionId, options),
  );
  const logs = await readRuntimeEvidence(() =>
    listRuntimeNodeLogs(input.sessionId, options),
  );
  const llmMessages = await readRuntimeEvidence(() =>
    listRuntimeLlmSessionMessages(input.sessionId, options),
  );
  const artifactDirs = collectArtifactDirs({
    session,
    runtimeExecutions: runtimeExecutions.rows,
    currentStepId,
    currentNodeId,
  });
  const artifactScan = await scanArtifacts(artifactDirs);
  const progress = latestProgress(
    collectProgressEvidence({
      session,
      runtimeUpdatedAt: runtimeSession.updatedAt,
      runtimeExecutions: runtimeExecutions.rows,
      logs: logs.rows,
      llmMessages: llmMessages.rows,
      artifacts: artifactScan.summary,
    }),
  );
  const stallTimeoutMs =
    input.stallTimeoutMs ?? resolvePersistedStallTimeoutMs(session);
  const derived = deriveHealth({
    session,
    observedAt,
    lastProgress: progress,
    stallTimeoutMs,
    runtimeStatus:
      runtimeSession.status === "available" ||
      runtimeExecutions.status === "available"
        ? "available"
        : runtimeSession.status === "partial" ||
            runtimeExecutions.status === "partial"
          ? "partial"
          : "missing",
    artifactStatus: artifactScan.status,
  });
  const activeNode = await buildActiveNode({
    session,
    currentStepId,
    currentNodeId,
    runtimeExecutions: runtimeExecutions.rows,
    observedAt,
    stalled: derived.progressSignal.stalled,
    options,
  });

  return {
    sessionId: session.sessionId,
    workflowId: session.workflowId,
    workflowName: session.workflowName,
    status: session.status,
    currentStepId,
    currentNodeId,
    persistedState: buildPersistedState(session),
    health: derived.health,
    activeNode,
    liveSignal: deriveLiveSignal(input.live === true),
    progressSignal: derived.progressSignal,
    artifacts: artifactScan.summary,
    recentLogs: selectRecent(logs.rows, logLimit, (log) => log.at),
    recentLlmMessages: includeLlmMessages
      ? selectRecent(llmMessages.rows, llmLimit, (message) => message.at)
      : [],
    evidenceCompleteness: {
      sessionStore: "available",
      runtimeDb:
        runtimeSession.status === "available" ||
        runtimeExecutions.status === "available"
          ? "available"
          : runtimeSession.status === "partial" ||
              runtimeExecutions.status === "partial"
            ? "partial"
            : "missing",
      artifacts: artifactScan.status,
      processLogs: logs.status,
      llmMessages: includeLlmMessages ? llmMessages.status : "disabled",
    },
  };
}
