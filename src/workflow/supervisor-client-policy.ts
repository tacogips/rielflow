import type { EventBinding } from "../events/types";
import { defaultSupervisorWorkflowName } from "../events/supervisor-correlation";

export function resolveAutoImproveEnabled(binding: EventBinding): boolean {
  const raw = binding.execution?.autoImprove;
  if (raw === undefined) {
    return false;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  return raw.enabled === true;
}

export function resolveMaxRestarts(binding: EventBinding): number {
  const n = binding.execution?.maxRestartsOnFailure;
  if (n === undefined || !Number.isFinite(n)) {
    return 3;
  }
  return Math.max(0, Math.floor(n));
}

export function resolveSupervisorWorkflowName(binding: EventBinding): string {
  const name = binding.execution?.supervisorWorkflowName;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  return defaultSupervisorWorkflowName();
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
