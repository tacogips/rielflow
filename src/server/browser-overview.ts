import {
  BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT,
  overviewBrowserHtml,
  type BrowserWorkflowOverviewViewModel as PackageBrowserWorkflowOverviewViewModel,
} from "divedra-server";
import type { WorkflowCatalogFailure } from "../workflow/catalog";
import { ok, type Result } from "../workflow/result";
import {
  buildWorkflowCatalogOverview,
  buildWorkflowStatusOverview,
  selectDefaultWorkflowOverviewRow,
  workflowStatusOverviewInputFromOverviewRow,
  type WorkflowOverviewRow,
  type WorkflowStatusOverview,
} from "../workflow/overview";
import type { SessionStoreFailure } from "../workflow/session-store";
import type { ApiContext } from "./api";

export { BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT, overviewBrowserHtml };

export type BrowserWorkflowOverviewViewModel =
  PackageBrowserWorkflowOverviewViewModel<
    WorkflowOverviewRow,
    WorkflowStatusOverview
  >;

export async function buildBrowserWorkflowOverviewViewModel(
  context: ApiContext,
): Promise<
  Result<
    BrowserWorkflowOverviewViewModel,
    WorkflowCatalogFailure | SessionStoreFailure
  >
> {
  const catalogResult = await buildWorkflowCatalogOverview({}, context);
  if (!catalogResult.ok) {
    return catalogResult;
  }
  let workflows = catalogResult.value.workflows;
  if (
    context.fixedWorkflowName !== undefined &&
    context.fixedResolvedWorkflowSource === undefined
  ) {
    workflows = workflows.filter(
      (row) => row.workflowName === context.fixedWorkflowName,
    );
  }
  const selectOptions =
    context.fixedWorkflowName === undefined
      ? undefined
      : {
          fixedWorkflowName: context.fixedWorkflowName,
          ...(context.fixedResolvedWorkflowSource === undefined
            ? {}
            : {
                fixedResolvedWorkflowSource:
                  context.fixedResolvedWorkflowSource,
              }),
        };
  const selectedRow = selectDefaultWorkflowOverviewRow(
    workflows,
    selectOptions,
  );
  if (selectedRow === null) {
    return ok({ workflows, selectedWorkflow: null });
  }
  const baseInput = workflowStatusOverviewInputFromOverviewRow(selectedRow);
  const statusResult = await buildWorkflowStatusOverview(
    {
      ...baseInput,
      limit: BROWSER_WORKFLOW_OVERVIEW_RECENT_LIMIT,
    },
    context,
  );
  if (!statusResult.ok) {
    return statusResult;
  }
  return ok({ workflows, selectedWorkflow: statusResult.value });
}
