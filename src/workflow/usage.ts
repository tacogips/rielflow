import { loadWorkflowFromCatalog } from "./load";
import {
  listWorkflowCatalogSources,
  withResolvedWorkflowSourceOptions,
} from "./catalog";
import {
  deriveWorkflowCallableContractSummary,
  deriveWorkflowStepSummaries,
  type WorkflowCallableContractSummary,
  type WorkflowStepSummary,
} from "./inspect";
import { err, ok, type Result } from "./result";
import type { WorkflowCatalogFailure } from "./catalog";
import type { LoadFailure } from "./load";
import type {
  LoadOptions,
  ResolvedWorkflowSource,
  WorkflowScopeSelector,
  WorkflowSourceScope,
} from "./types";

export interface WorkflowUsageSource {
  readonly scope: WorkflowSourceScope;
  readonly workflowRoot: string;
  readonly workflowDirectory: string;
  readonly scopeRoot?: string;
}

export interface WorkflowUsageSummary {
  readonly workflowName: string;
  readonly workflowId: string;
  readonly description: string;
  readonly source?: WorkflowUsageSource;
  readonly callable: WorkflowCallableContractSummary;
  readonly steps: readonly WorkflowStepSummary[];
}

export interface WorkflowUsageCatalog {
  readonly workflows: readonly WorkflowUsageSummary[];
}

export interface WorkflowUsageCatalogInput {
  readonly workflowScope?: WorkflowScopeSelector;
}

export interface WorkflowUsageLookupInput {
  readonly workflowName: string;
  readonly workflowScope?: WorkflowScopeSelector;
}

function toWorkflowUsageSource(
  source: ResolvedWorkflowSource,
): WorkflowUsageSource {
  return {
    scope: source.scope,
    workflowRoot: source.workflowRoot,
    workflowDirectory: source.workflowDirectory,
    ...(source.scopeRoot === undefined ? {} : { scopeRoot: source.scopeRoot }),
  };
}

export async function buildWorkflowUsageSummary(
  input: WorkflowUsageLookupInput,
  options: LoadOptions = {},
): Promise<Result<WorkflowUsageSummary, WorkflowCatalogFailure | LoadFailure>> {
  const loaded = await loadWorkflowFromCatalog(input.workflowName, {
    ...options,
    ...(input.workflowScope === undefined
      ? {}
      : { workflowScope: input.workflowScope }),
  });
  if (!loaded.ok) {
    return err(loaded.error);
  }

  return ok({
    workflowName: loaded.value.workflowName,
    workflowId: loaded.value.bundle.workflow.workflowId,
    description: loaded.value.bundle.workflow.description,
    ...(loaded.value.source === undefined
      ? {}
      : { source: toWorkflowUsageSource(loaded.value.source) }),
    callable: deriveWorkflowCallableContractSummary(loaded.value.bundle),
    steps: deriveWorkflowStepSummaries(loaded.value.bundle.workflow),
  });
}

export async function buildWorkflowUsageCatalog(
  input: WorkflowUsageCatalogInput = {},
  options: LoadOptions = {},
): Promise<Result<WorkflowUsageCatalog, WorkflowCatalogFailure | LoadFailure>> {
  const sources = await listWorkflowCatalogSources({
    ...options,
    ...(input.workflowScope === undefined
      ? {}
      : { workflowScope: input.workflowScope }),
  });
  if (!sources.ok) {
    return err(sources.error);
  }

  const workflows: WorkflowUsageSummary[] = [];
  for (const source of sources.value) {
    const loaded = await loadWorkflowFromCatalog(
      source.workflowName,
      withResolvedWorkflowSourceOptions(source, options),
    );
    if (!loaded.ok) {
      return err(loaded.error);
    }
    workflows.push({
      workflowName: loaded.value.workflowName,
      workflowId: loaded.value.bundle.workflow.workflowId,
      description: loaded.value.bundle.workflow.description,
      ...(loaded.value.source === undefined
        ? {}
        : { source: toWorkflowUsageSource(loaded.value.source) }),
      callable: deriveWorkflowCallableContractSummary(loaded.value.bundle),
      steps: deriveWorkflowStepSummaries(loaded.value.bundle.workflow),
    });
  }

  return ok({ workflows });
}
