export interface CliFlagCombinationValidationInput {
  readonly parseError: string | undefined;
  readonly autoImprove: boolean;
  readonly disableAutoImprove: boolean;
  readonly nestedSuperviser: boolean;
  readonly maxWorkflowPatches: number | undefined;
  readonly workflowMutationMode: "execution-copy" | "in-place" | undefined;
  readonly isSessionHealthCommand: boolean;
  readonly firstAutoImproveOnlyPolicyFlag: string | undefined;
  readonly autoImprovePolicyError: string | undefined;
  readonly preInstallCheck: boolean;
  readonly noPreInstallCheck: boolean;
}

export function validateCliFlagCombinations(
  input: CliFlagCombinationValidationInput,
): string | undefined {
  if (input.parseError !== undefined) {
    return input.parseError;
  }
  if (input.autoImprove && input.disableAutoImprove) {
    return "--auto-improve cannot be combined with --no-auto-improve";
  }
  if (input.nestedSuperviser && input.disableAutoImprove) {
    return "--nested-superviser / --nested-supervisor cannot be combined with --no-auto-improve";
  }
  if (input.disableAutoImprove && input.maxWorkflowPatches !== undefined) {
    return "--max-workflow-patches cannot be combined with --no-auto-improve";
  }
  if (input.disableAutoImprove && input.workflowMutationMode !== undefined) {
    return "--workflow-mutation-mode cannot be combined with --no-auto-improve";
  }
  if (
    input.isSessionHealthCommand &&
    !input.autoImprove &&
    input.firstAutoImproveOnlyPolicyFlag !== undefined
  ) {
    return `${input.firstAutoImproveOnlyPolicyFlag} requires --auto-improve`;
  }
  if (input.autoImprovePolicyError !== undefined) {
    return `invalid --auto-improve policy: ${input.autoImprovePolicyError}`;
  }
  if (input.preInstallCheck && input.noPreInstallCheck) {
    return "--pre-install-check cannot be combined with --no-pre-install-check";
  }
  return undefined;
}
