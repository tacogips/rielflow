import type { WorkflowSupervisorBinding } from "./supervisor-client-types";

const DEFAULT_SUPERVISOR_WORKFLOW = "divedra-default-workflow-supervisor";

export function resolveAutoImproveEnabled(
  binding: WorkflowSupervisorBinding,
): boolean {
  const raw = binding.execution?.autoImprove;
  if (raw === undefined) {
    return false;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  return raw.enabled === true;
}

export function resolveMaxRestarts(binding: WorkflowSupervisorBinding): number {
  const n = binding.execution?.maxRestartsOnFailure;
  if (n === undefined || !Number.isFinite(n)) {
    return 3;
  }
  return Math.max(0, Math.floor(n));
}

export function resolveSupervisorWorkflowName(
  binding: WorkflowSupervisorBinding,
): string {
  const name = binding.execution?.supervisorWorkflowName;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  return DEFAULT_SUPERVISOR_WORKFLOW;
}

export function dedupeNodeIds(nodeIds: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of nodeIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}
