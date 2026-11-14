import type {
  LoadOptions,
  WorkflowSelfImproveMode,
  WorkflowSelfImprovePolicy,
} from "../types";

export type { WorkflowSelfImproveMode, WorkflowSelfImprovePolicy };

export type WorkflowSelfImproveSourceMode =
  | "since-last"
  | "latest"
  | "since-last-or-latest"
  | "explicit";

export const WORKFLOW_SELF_IMPROVE_SOURCE_MODES = [
  "since-last",
  "latest",
  "since-last-or-latest",
  "explicit",
] as const satisfies readonly WorkflowSelfImproveSourceMode[];

export type WorkflowPurposeAchievement =
  | "achieved"
  | "partially-achieved"
  | "not-achieved"
  | "unknown";

export interface WorkflowSelfImproveSourceRun {
  readonly sessionId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: string;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly artifactDir?: string;
  readonly lastError?: string;
  readonly nodeExecutions?: readonly WorkflowSelfImproveSourceNodeExecution[];
}

export interface WorkflowSelfImproveSourceNodeExecution {
  readonly nodeId: string;
  readonly stepId?: string;
  readonly nodeExecId: string;
  readonly status:
    | "succeeded"
    | "failed"
    | "timed_out"
    | "cancelled"
    | "skipped";
  readonly artifactDir: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly outputAttemptCount?: number;
  readonly outputValidationErrors?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}

export interface WorkflowSelfImproveFinding {
  readonly severity: "high" | "mid" | "low";
  readonly category: "purpose" | "structure" | "prompt" | "runtime";
  readonly message: string;
  readonly evidenceSessionIds: readonly string[];
  readonly stepIds?: readonly string[];
  readonly nodeIds?: readonly string[];
}

export interface WorkflowSelfImproveBackupResult {
  readonly backupPath: string;
  readonly copiedFileCount: number;
}

export interface WorkflowSelfImprovePatchResult {
  readonly status: "not-attempted" | "applied" | "patch-reverted" | "failed";
  readonly changedFiles: readonly string[];
  readonly validationStatus: "not-run" | "passed" | "failed";
  readonly message?: string;
}

export interface WorkflowSelfImproveGitCommitResult {
  readonly status: "not-git-managed" | "committed" | "failed";
  readonly commitHash?: string;
  readonly message?: string;
}

export interface WorkflowSelfImproveReport {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly workflowDirectory: string;
  readonly mode: WorkflowSelfImproveMode;
  readonly sourceMode: WorkflowSelfImproveSourceMode;
  readonly sourceRuns: readonly WorkflowSelfImproveSourceRun[];
  readonly purposeAchievement: WorkflowPurposeAchievement;
  readonly findings: readonly WorkflowSelfImproveFinding[];
  readonly recommendedActions: readonly string[];
  readonly backup?: WorkflowSelfImproveBackupResult;
  readonly patch: WorkflowSelfImprovePatchResult;
  readonly gitCommit: WorkflowSelfImproveGitCommitResult;
  readonly createdAt: string;
}

export interface WorkflowSelfImproveReportSummary {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly reportPath: string;
  readonly markdownReportPath: string;
  readonly createdAt: string;
  readonly findingCount: number;
  readonly purposeAchievement: WorkflowPurposeAchievement;
}

export interface ExecuteWorkflowSelfImproveInput extends LoadOptions {
  readonly workflowName: string;
  readonly mode?: WorkflowSelfImproveMode;
  readonly sourceMode?: WorkflowSelfImproveSourceMode;
  readonly limit?: number;
  readonly sessionIds?: readonly string[];
  readonly enableDisabled?: boolean;
  readonly selfImproveLogRoot?: string;
}

export interface WorkflowSelfImproveResult {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly reportPath: string;
  readonly markdownReportPath: string;
  readonly inputRunsPath: string;
  readonly backupPath?: string;
  readonly selectedSourceRuns: readonly WorkflowSelfImproveSourceRun[];
  readonly findings: readonly WorkflowSelfImproveFinding[];
  readonly purposeAchievement: WorkflowPurposeAchievement;
  readonly patchStatus: WorkflowSelfImprovePatchResult["status"];
  readonly validationStatus: WorkflowSelfImprovePatchResult["validationStatus"];
  readonly gitCommitStatus: WorkflowSelfImproveGitCommitResult["status"];
  readonly gitCommitHash?: string;
}

export interface WorkflowSelfImproveReportLookupInput extends LoadOptions {
  readonly workflowName: string;
  readonly selfImproveId: string;
  readonly selfImproveLogRoot?: string;
}

export interface WorkflowSelfImproveReportListInput extends LoadOptions {
  readonly workflowName: string;
  readonly selfImproveLogRoot?: string;
}
