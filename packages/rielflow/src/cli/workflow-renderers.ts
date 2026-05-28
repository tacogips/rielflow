import type { WorkflowStructureRow } from "../workflow/inspect";
import type { NodeValidationResult } from "../workflow/validate";

export function renderWorkflowStructureLines(
  rows: readonly WorkflowStructureRow[],
  options: { readonly indentUnit: string } = { indentUnit: "  " },
): string[] {
  if (rows.length === 0) {
    return ["(none)"];
  }
  return rows.flatMap((row) => [
    `${options.indentUnit.repeat(row.indent)}${row.stepId}`,
    `${options.indentUnit.repeat(row.indent + 1)}${row.description}`,
  ]);
}

export function renderNodeValidationSummaryLines(
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
