import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { backupWorkflowDirectory } from "./backup";
import { analyzeWorkflowSelfImprove } from "./analyzer";
import {
  parseWorkflowSelfImproveSourceMode,
  resolveWorkflowSelfImprovePolicy,
  validateWorkflowSelfImprovePublicInput,
} from "./config";
import { commitWorkflowSelfImproveChanges } from "./git";
import {
  readWorkflowSelfImproveMarker,
  writeWorkflowSelfImproveMarker,
} from "./marker-store";
import {
  applyWorkflowSelfImprovePatch,
  type WorkflowSelfImprovePatchOperation,
} from "./patcher";
import {
  resolveSelfImproveExecutionDirectory,
  resolveSelfImproveLogRoot,
} from "./pathing";
import {
  listWorkflowSelfImproveReportSummaries,
  readWorkflowSelfImproveReport,
  writeWorkflowSelfImproveReport,
} from "./report";
import {
  discoverWorkflowSourceRuns,
  selectWorkflowSelfImproveSourceRuns,
} from "./source-selection";
import { loadWorkflowFromCatalog } from "../load";
import type {
  ExecuteWorkflowSelfImproveInput,
  WorkflowSelfImproveFinding,
  WorkflowSelfImproveReport,
  WorkflowSelfImproveReportListInput,
  WorkflowSelfImproveReportLookupInput,
  WorkflowSelfImproveReportSummary,
  WorkflowSelfImproveResult,
  WorkflowSelfImproveSourceMode,
} from "./types";

async function buildPromptPatchOperations(input: {
  readonly workflowDirectory: string;
  readonly findings: readonly WorkflowSelfImproveFinding[];
}): Promise<readonly WorkflowSelfImprovePatchOperation[]> {
  const promptFindings = input.findings.filter(
    (finding) => finding.category === "prompt",
  );
  const nodeFiles = new Set(
    promptFindings
      .flatMap((finding) => finding.nodeIds ?? [])
      .filter((nodeId) => nodeId.endsWith(".json")),
  );
  const operations: WorkflowSelfImprovePatchOperation[] = [];
  for (const nodeFile of nodeFiles) {
    const rawPath = path.join(input.workflowDirectory, nodeFile);
    const parsed = JSON.parse(await readFile(rawPath, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      continue;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record["promptTemplate"] === "string" &&
      record["promptTemplate"].trim().length >= 20
    ) {
      continue;
    }
    const nodeId =
      typeof record["id"] === "string" && record["id"].length > 0
        ? record["id"]
        : path.basename(nodeFile, ".json");
    const improvedPrompt = `Review the workflow purpose, inspect the provided execution context for node ${nodeId}, identify concrete evidence, and return the requested structured output without inventing missing facts.`;
    if (
      typeof record["promptTemplateFile"] === "string" &&
      record["promptTemplateFile"].trim().length > 0
    ) {
      operations.push({
        relativePath: record["promptTemplateFile"],
        content: `${improvedPrompt}\n`,
      });
      continue;
    }
    operations.push({
      relativePath: nodeFile,
      content: `${JSON.stringify(
        {
          ...record,
          promptTemplate: improvedPrompt,
        },
        null,
        2,
      )}\n`,
    });
  }
  return operations;
}

function createSelfImproveId(now: string): string {
  const stamp = now.replace(/[^0-9TZ]/g, "").replace(/Z$/, "");
  return `sim-${stamp}-${randomBytes(4).toString("hex")}`;
}

function sourceModeForInput(input: {
  readonly sourceMode?: WorkflowSelfImproveSourceMode;
  readonly sessionIds?: readonly string[];
}): WorkflowSelfImproveSourceMode {
  if (input.sourceMode !== undefined) {
    return parseWorkflowSelfImproveSourceMode(input.sourceMode);
  }
  return input.sessionIds === undefined || input.sessionIds.length === 0
    ? "since-last-or-latest"
    : "explicit";
}

function shouldCommitPatch(patch: WorkflowSelfImproveReport["patch"]): boolean {
  return patch.status === "applied" && patch.changedFiles.length > 0;
}

function shouldAdvanceMarker(report: WorkflowSelfImproveReport): boolean {
  return (
    report.patch.status !== "failed" &&
    report.patch.status !== "patch-reverted" &&
    report.gitCommit.status !== "failed"
  );
}

async function validateLoadedBundle(input: ExecuteWorkflowSelfImproveInput) {
  const loaded = await loadWorkflowFromCatalog(input.workflowName, input);
  if (!loaded.ok) {
    throw new Error(loaded.error.message);
  }
  return loaded.value;
}

export async function executeWorkflowSelfImprove(
  input: ExecuteWorkflowSelfImproveInput,
): Promise<WorkflowSelfImproveResult> {
  const publicInput = validateWorkflowSelfImprovePublicInput(input);
  const loaded = await validateLoadedBundle({
    ...input,
    workflowName: publicInput.workflowName,
  });
  const workflow = loaded.bundle.workflow;
  const policy = resolveWorkflowSelfImprovePolicy({
    ...(workflow.defaults.selfImprove === undefined
      ? {}
      : { defaults: workflow.defaults.selfImprove }),
    ...(publicInput.mode === undefined ? {} : { mode: publicInput.mode }),
    ...(publicInput.limit === undefined ? {} : { limit: publicInput.limit }),
    ...(publicInput.enableDisabled === undefined
      ? {}
      : { enableDisabled: publicInput.enableDisabled }),
    ...(input.env === undefined ? {} : { env: input.env }),
  });
  if (!policy.enabled) {
    throw new Error(
      `self-improve is disabled for workflow '${publicInput.workflowName}'; pass enableDisabled to run explicitly`,
    );
  }

  const now = new Date().toISOString();
  const selfImproveId = createSelfImproveId(now);
  const logRoot = resolveSelfImproveLogRoot(input);
  const executionDirectory = resolveSelfImproveExecutionDirectory({
    logRoot,
    workflowDirectory: loaded.workflowDirectory,
    selfImproveId,
  });
  const sourceMode = sourceModeForInput(publicInput);
  const marker = await readWorkflowSelfImproveMarker({
    logRoot,
    workflowDirectory: loaded.workflowDirectory,
  });
  const availableRuns = await discoverWorkflowSourceRuns(
    {
      workflowName: loaded.workflowName,
      workflowId: workflow.workflowId,
    },
    input,
  );
  const selectedSourceRuns = selectWorkflowSelfImproveSourceRuns({
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    sourceMode,
    limit: policy.defaultLogLimit,
    ...(publicInput.sessionIds === undefined
      ? {}
      : { explicitSessionIds: publicInput.sessionIds }),
    ...(marker === undefined ? {} : { marker }),
    availableRuns,
  });
  const analysis = analyzeWorkflowSelfImprove({
    bundle: loaded.bundle,
    sourceRuns: selectedSourceRuns,
  });

  const backup =
    policy.mode === "report-and-auto-improve"
      ? await backupWorkflowDirectory({
          workflowDirectory: loaded.workflowDirectory,
          backupPath: path.join(executionDirectory, "backup"),
        })
      : undefined;
  const patch =
    policy.mode === "report-and-auto-improve" && backup !== undefined
      ? await applyWorkflowSelfImprovePatch({
          workflowDirectory: loaded.workflowDirectory,
          backupPath: backup.backupPath,
          operations: await buildPromptPatchOperations({
            workflowDirectory: loaded.workflowDirectory,
            findings: analysis.findings,
          }),
          validate: async () => {
            const reloaded = await loadWorkflowFromCatalog(
              publicInput.workflowName,
              input,
            );
            return reloaded.ok;
          },
        })
      : {
          status: "not-attempted" as const,
          changedFiles: [],
          validationStatus: "not-run" as const,
        };
  const gitCommit = shouldCommitPatch(patch)
    ? await commitWorkflowSelfImproveChanges({
        workflowDirectory: loaded.workflowDirectory,
        workflowName: loaded.workflowName,
        selfImproveId,
        changedFiles: patch.changedFiles,
      })
    : { status: "not-git-managed" as const };

  const report: WorkflowSelfImproveReport = {
    selfImproveId,
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    workflowDirectory: loaded.workflowDirectory,
    mode: policy.mode,
    sourceMode,
    sourceRuns: selectedSourceRuns,
    purposeAchievement: analysis.purposeAchievement,
    findings: analysis.findings,
    recommendedActions: analysis.recommendedActions,
    ...(backup === undefined ? {} : { backup }),
    patch,
    gitCommit,
    createdAt: now,
  };
  const written = await writeWorkflowSelfImproveReport({
    executionDirectory,
    sourceRuns: selectedSourceRuns,
    report,
  });
  if (shouldAdvanceMarker(report)) {
    await writeWorkflowSelfImproveMarker({
      logRoot,
      executionDirectory,
      marker: {
        selfImproveId,
        workflowName: loaded.workflowName,
        workflowId: workflow.workflowId,
        workflowDirectory: loaded.workflowDirectory,
        completedAt: now,
        sourceSessionIds: selectedSourceRuns.map((run) => run.sessionId),
      },
    });
  }

  return {
    selfImproveId,
    workflowName: loaded.workflowName,
    workflowId: workflow.workflowId,
    reportPath: written.reportPath,
    markdownReportPath: written.markdownReportPath,
    inputRunsPath: written.inputRunsPath,
    ...(backup === undefined ? {} : { backupPath: backup.backupPath }),
    selectedSourceRuns,
    findings: analysis.findings,
    purposeAchievement: analysis.purposeAchievement,
    patchStatus: patch.status,
    validationStatus: patch.validationStatus,
    gitCommitStatus: gitCommit.status,
    ...(gitCommit.commitHash === undefined
      ? {}
      : { gitCommitHash: gitCommit.commitHash }),
  };
}

export async function getWorkflowSelfImproveReport(
  input: WorkflowSelfImproveReportLookupInput,
): Promise<WorkflowSelfImproveReport> {
  const loaded = await validateLoadedBundle(input);
  return readWorkflowSelfImproveReport({
    logRoot: resolveSelfImproveLogRoot(input),
    workflowDirectory: loaded.workflowDirectory,
    selfImproveId: input.selfImproveId,
  });
}

export async function listWorkflowSelfImproveReports(
  input: WorkflowSelfImproveReportListInput,
): Promise<readonly WorkflowSelfImproveReportSummary[]> {
  const loaded = await validateLoadedBundle(input);
  return listWorkflowSelfImproveReportSummaries({
    logRoot: resolveSelfImproveLogRoot(input),
    workflowName: loaded.workflowName,
    workflowDirectory: loaded.workflowDirectory,
  });
}
