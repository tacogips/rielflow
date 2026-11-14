export type TuiRuntimeMode = "interactive" | "fallback";

export type TuiRuntimeReason =
  | "resume-session"
  | "interactive-terminal"
  | "non-interactive-terminal";

export interface TuiRuntimeSelectionInput {
  readonly isInteractiveTerminal: boolean;
  readonly resumeSessionId?: string;
}

export interface TuiRuntimeSelection {
  readonly mode: TuiRuntimeMode;
  readonly reason: TuiRuntimeReason;
  readonly requiresWorkflowArgument: boolean;
}

export interface TuiInteractiveScreenContext {
  readonly workflowNames: readonly string[];
}

export interface TuiInteractiveScreenResult {
  readonly workflowName: string;
  readonly runtimeVariables: Readonly<Record<string, unknown>>;
}

export interface TuiInteractiveScreenAdapter {
  readonly run: (
    context: TuiInteractiveScreenContext,
  ) => Promise<TuiInteractiveScreenResult>;
}

export function selectTuiRuntimeMode(
  input: TuiRuntimeSelectionInput,
): TuiRuntimeSelection {
  if (input.resumeSessionId !== undefined && !input.isInteractiveTerminal) {
    return {
      mode: "fallback",
      reason: "resume-session",
      requiresWorkflowArgument: false,
    };
  }

  if (input.resumeSessionId !== undefined) {
    return {
      mode: "interactive",
      reason: "resume-session",
      requiresWorkflowArgument: false,
    };
  }

  if (input.isInteractiveTerminal) {
    return {
      mode: "interactive",
      reason: "interactive-terminal",
      requiresWorkflowArgument: false,
    };
  }

  return {
    mode: "fallback",
    reason: "non-interactive-terminal",
    requiresWorkflowArgument: true,
  };
}
