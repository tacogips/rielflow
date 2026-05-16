export interface BrowserWorkflowOverviewViewModel<
  TWorkflow = unknown,
  TSelectedWorkflow = unknown,
> {
  readonly workflows: readonly TWorkflow[];
  readonly selectedWorkflow: TSelectedWorkflow | null;
}
