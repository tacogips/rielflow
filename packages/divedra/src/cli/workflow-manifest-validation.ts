import path from "node:path";
import { loadWorkflowFromDisk } from "../workflow/load";
import { loadWorkflowManifest } from "../workflow/manifest";
import {
  hasInvalidNodeValidationResult,
  type NodeValidationResult,
} from "../workflow/validate";
import type { RunCliSharedOptions } from "./storage-and-options";

interface WorkflowManifestValidationWorkflow {
  readonly id: string;
  readonly enabled: boolean;
  readonly workflowDirectory: string;
  readonly cwd: string;
  readonly authoredWorkflowId: string;
  readonly workflowId?: string;
  readonly valid: boolean;
  readonly error?: string;
  readonly issues?: readonly unknown[];
  readonly nodeValidationResults: readonly NodeValidationResult[];
}

export interface WorkflowManifestValidationReport {
  readonly manifestPath: string;
  readonly relativePathRoot: string;
  readonly valid: boolean;
  readonly workflows: readonly WorkflowManifestValidationWorkflow[];
}

function renderNodeValidationSummaryLines(
  results: readonly NodeValidationResult[],
): readonly string[] {
  return results
    .filter(
      (result) => result.status === "invalid" || result.status === "warning",
    )
    .map((result) => {
      const nodeLabel =
        result.nodeId === undefined ? "workflow.nodes" : result.nodeId;
      return `nodeValidation: [${result.status}] ${nodeLabel}: ${result.message}`;
    });
}

export async function validateWorkflowManifestForCli(input: {
  readonly manifestPath: string;
  readonly options: RunCliSharedOptions;
  readonly executablePreflight: boolean;
}): Promise<
  | { readonly ok: true; readonly value: WorkflowManifestValidationReport }
  | { readonly ok: false; readonly code: 1 | 2; readonly message: string }
> {
  const manifest = await loadWorkflowManifest(input.manifestPath, {
    env: input.options.env,
    ...(input.options.workflowManifestRoot === undefined
      ? {}
      : { relativePathRoot: input.options.workflowManifestRoot }),
  });
  if (!manifest.ok) {
    return {
      ok: false,
      code: manifest.error.code === "IO" ? 1 : 2,
      message: manifest.error.message,
    };
  }

  const workflows: WorkflowManifestValidationWorkflow[] = [];
  for (const entry of manifest.value.entries) {
    const loaded = await loadWorkflowFromDisk(entry.id, {
      ...input.options,
      workflowRoot: path.dirname(entry.workflowDirectory),
      workflowBundleDirectoryOverride: entry.workflowDirectory,
      cwd: entry.cwd,
      executablePreflight: input.executablePreflight,
    });
    if (!loaded.ok) {
      workflows.push({
        id: entry.id,
        enabled: entry.enabled,
        workflowDirectory: entry.workflowDirectory,
        cwd: entry.cwd,
        authoredWorkflowId: entry.authoredWorkflowId,
        valid: false,
        error: loaded.error.message,
        ...(loaded.error.issues === undefined
          ? {}
          : { issues: loaded.error.issues }),
        nodeValidationResults: [],
      });
      continue;
    }

    const nodeValidationInvalid = hasInvalidNodeValidationResult(
      loaded.value.nodeValidationResults,
    );
    workflows.push({
      id: entry.id,
      enabled: entry.enabled,
      workflowDirectory: entry.workflowDirectory,
      cwd: entry.cwd,
      authoredWorkflowId: entry.authoredWorkflowId,
      workflowId: loaded.value.bundle.workflow.workflowId,
      valid: !nodeValidationInvalid,
      ...(nodeValidationInvalid
        ? { error: "workflow has invalid node validation results" }
        : {}),
      nodeValidationResults: loaded.value.nodeValidationResults,
    });
  }

  return {
    ok: true,
    value: {
      manifestPath: manifest.value.manifestPath,
      relativePathRoot: manifest.value.relativePathRoot,
      valid: workflows.every((workflow) => workflow.valid),
      workflows,
    },
  };
}

export function renderWorkflowManifestValidationLines(
  report: WorkflowManifestValidationReport,
): readonly string[] {
  const lines = [
    `workflow manifest '${report.manifestPath}' is ${report.valid ? "valid" : "invalid"}`,
    `relativePathRoot: ${report.relativePathRoot}`,
  ];
  for (const workflow of report.workflows) {
    lines.push(
      `workflow[${workflow.valid ? "valid" : "invalid"}] ${workflow.id} enabled=${String(workflow.enabled)} directory=${workflow.workflowDirectory}`,
    );
    if (workflow.error !== undefined) {
      lines.push(`  error: ${workflow.error}`);
    }
    for (const line of renderNodeValidationSummaryLines(
      workflow.nodeValidationResults,
    )) {
      lines.push(`  ${line}`);
    }
  }
  return lines;
}
