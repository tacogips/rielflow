export interface SaveWorkflowInput {
  readonly workflow: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
  readonly expectedRevision?: string;
}

export interface SaveWorkflowSuccess {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly revision: string;
}

export interface SaveWorkflowFailure {
  readonly code: "INVALID_WORKFLOW_NAME" | "VALIDATION" | "CONFLICT" | "IO";
  readonly message: string;
  readonly issues?: readonly {
    readonly severity: "error" | "warning";
    readonly path: string;
    readonly message: string;
  }[];
  readonly currentRevision?: string;
}

/** Obsolete sidecar filename from an earlier tooling path; removed on save if still present. */
export const OBSOLETE_WORKFLOW_VISUALIZATION_FILE = "workflow-vis.json";
export const WORKFLOW_DEFINITION_FILE = "workflow.json";
