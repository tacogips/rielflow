import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../../shared/json";
import {
  resolveSelfImproveExecutionDirectory,
  resolveWorkflowSelfImproveDirectory,
} from "./pathing";
import type {
  WorkflowSelfImproveReport,
  WorkflowSelfImproveReportSummary,
} from "./types";

export function renderWorkflowSelfImproveMarkdownReport(
  report: WorkflowSelfImproveReport,
): string {
  const lines = [
    `# Workflow Self-Improve Report: ${report.workflowName}`,
    "",
    `Self-improve id: ${report.selfImproveId}`,
    `Workflow id: ${report.workflowId}`,
    `Mode: ${report.mode}`,
    `Purpose achievement: ${report.purposeAchievement}`,
    `Source runs: ${report.sourceRuns.map((run) => run.sessionId).join(", ") || "(none)"}`,
    "",
    "## Findings",
    ...(report.findings.length === 0
      ? ["- None"]
      : report.findings.map(
          (finding) =>
            `- [${finding.severity}] ${finding.category}: ${finding.message}`,
        )),
    "",
    "## Recommended Actions",
    ...report.recommendedActions.map((action) => `- ${action}`),
    "",
    "## Patch and Git",
    `Patch status: ${report.patch.status}`,
    `Validation status: ${report.patch.validationStatus}`,
    `Git commit status: ${report.gitCommit.status}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function writeWorkflowSelfImproveReport(input: {
  readonly executionDirectory: string;
  readonly sourceRuns: readonly unknown[];
  readonly report: WorkflowSelfImproveReport;
}): Promise<{
  readonly inputRunsPath: string;
  readonly reportPath: string;
  readonly markdownReportPath: string;
}> {
  await mkdir(input.executionDirectory, { recursive: true });
  const inputRunsPath = path.join(input.executionDirectory, "input-runs.json");
  const reportPath = path.join(input.executionDirectory, "report.json");
  const markdownReportPath = path.join(input.executionDirectory, "report.md");
  await writeFile(
    inputRunsPath,
    `${JSON.stringify(input.sourceRuns, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    reportPath,
    `${JSON.stringify(input.report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    markdownReportPath,
    renderWorkflowSelfImproveMarkdownReport(input.report),
    "utf8",
  );
  return { inputRunsPath, reportPath, markdownReportPath };
}

export async function readWorkflowSelfImproveReport(input: {
  readonly logRoot: string;
  readonly workflowDirectory: string;
  readonly selfImproveId: string;
}): Promise<WorkflowSelfImproveReport> {
  const reportPath = path.join(
    resolveSelfImproveExecutionDirectory({
      logRoot: input.logRoot,
      workflowDirectory: input.workflowDirectory,
      selfImproveId: input.selfImproveId,
    }),
    "report.json",
  );
  const parsed = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  if (!isJsonObject(parsed)) {
    throw new Error(
      `self-improve report '${reportPath}' must contain a JSON object`,
    );
  }
  return parsed as unknown as WorkflowSelfImproveReport;
}

export async function listWorkflowSelfImproveReportSummaries(input: {
  readonly logRoot: string;
  readonly workflowName: string;
  readonly workflowDirectory: string;
}): Promise<readonly WorkflowSelfImproveReportSummary[]> {
  const workflowDirectory = resolveWorkflowSelfImproveDirectory(input);
  let entries: string[];
  try {
    entries = await readdir(workflowDirectory);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const summaries: WorkflowSelfImproveReportSummary[] = [];
  for (const entry of entries) {
    const reportPath = path.join(workflowDirectory, entry, "report.json");
    try {
      const parsed = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
      if (!isJsonObject(parsed)) {
        continue;
      }
      const report = parsed as unknown as WorkflowSelfImproveReport;
      if (report.workflowName !== input.workflowName) {
        continue;
      }
      summaries.push({
        selfImproveId: report.selfImproveId,
        workflowName: report.workflowName,
        workflowId: report.workflowId,
        reportPath,
        markdownReportPath: path.join(workflowDirectory, entry, "report.md"),
        createdAt: report.createdAt,
        findingCount: report.findings.length,
        purposeAchievement: report.purposeAchievement,
      });
    } catch {
      continue;
    }
  }
  return summaries.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
