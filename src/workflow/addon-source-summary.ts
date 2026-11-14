import { resolveAddonSource } from "./catalog";
import type {
  LoadOptions,
  ResolvedWorkflowSource,
  WorkflowJson,
} from "./types";

export interface WorkflowAddonSourceSummary {
  readonly nodeId: string;
  readonly name: string;
  readonly version: string;
  readonly scope: "direct" | "project" | "user";
  readonly addonRoot: string;
  readonly addonDirectory: string;
  readonly manifestPath: string;
  readonly scopeRoot?: string;
}

export async function collectWorkflowAddonSourceSummaries(input: {
  readonly workflow: Pick<WorkflowJson, "nodes">;
  readonly options?: LoadOptions;
  readonly workflowSource?: ResolvedWorkflowSource;
}): Promise<readonly WorkflowAddonSourceSummary[]> {
  const summaries: WorkflowAddonSourceSummary[] = [];
  const options = input.options ?? {};
  const workflowSource = input.workflowSource ?? options.resolvedWorkflowSource;

  for (const node of input.workflow.nodes) {
    if (node.addon === undefined) {
      continue;
    }
    const source = await resolveAddonSource({
      addon: node.addon,
      options,
      ...(workflowSource === undefined ? {} : { workflowSource }),
    });
    if (!source.ok) {
      continue;
    }
    summaries.push({
      nodeId: node.id,
      name: source.value.addonName,
      version: source.value.version,
      scope: source.value.scope,
      addonRoot: source.value.addonRoot,
      addonDirectory: source.value.addonDirectory,
      manifestPath: source.value.manifestPath,
      ...(source.value.scopeRoot === undefined
        ? {}
        : { scopeRoot: source.value.scopeRoot }),
    });
  }

  return summaries;
}
