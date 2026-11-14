export type WorkflowCheckoutScope = "project" | "user";

export interface WorkflowCheckoutFailure {
  readonly code:
    | "AMBIGUOUS_GITHUB_DIRECTORY_URL"
    | "DUPLICATE_CHECKOUT"
    | "FETCH_FAILED"
    | "INVALID_REMOTE_DIRECTORY"
    | "INVALID_SOURCE_URL"
    | "INVALID_WORKFLOW_NAME"
    | "IO"
    | "UNSAFE_DESTINATION"
    | "UNSUPPORTED_SOURCE_URL"
    | "USAGE"
    | "VALIDATION";
  readonly message: string;
}

export interface WorkflowCheckoutResult {
  readonly workflowName: string;
  readonly sourceUrl: string;
  readonly scope: WorkflowCheckoutScope;
  readonly destinationDirectory: string;
  readonly registryPath: string;
  readonly validationStatus: "valid";
  readonly overwritten: boolean;
}
