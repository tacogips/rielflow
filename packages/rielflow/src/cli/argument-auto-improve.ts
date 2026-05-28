import type { AutoImproveCliInputs } from "./storage-and-options";
import { parseAutoImprovePolicyFromCliFlags } from "./storage-and-options";

export interface ParsedAutoImproveFlagState {
  readonly autoImprovePolicy: ReturnType<
    typeof parseAutoImprovePolicyFromCliFlags
  >;
  readonly isSessionHealthCommand: boolean;
}

export function parseAutoImproveFlagState(input: {
  readonly positionals: readonly string[];
  readonly disableAutoImprove: boolean;
  readonly autoImprove: boolean;
  readonly nestedSuperviser: boolean;
  readonly firstAutoImprovePolicyFlag: string | undefined;
  readonly superviserWorkflowId: string | undefined;
  readonly monitorIntervalMs: number | undefined;
  readonly stallTimeoutMs: number | undefined;
  readonly maxSupervisedAttempts: number | undefined;
  readonly maxWorkflowPatches: number | undefined;
  readonly workflowMutationMode: AutoImproveCliInputs["workflowMutationMode"];
  readonly noAllowTargetedRerun: boolean;
}): ParsedAutoImproveFlagState {
  const isSessionHealthCommand =
    input.positionals[0] === "session" && input.positionals[1] === "health";
  const enabled =
    !isSessionHealthCommand &&
    (input.disableAutoImprove ||
      input.autoImprove ||
      input.nestedSuperviser ||
      input.firstAutoImprovePolicyFlag !== undefined);
  return {
    isSessionHealthCommand,
    autoImprovePolicy: parseAutoImprovePolicyFromCliFlags({
      enabled,
      ...(input.superviserWorkflowId === undefined
        ? {}
        : { superviserWorkflowId: input.superviserWorkflowId }),
      ...(input.monitorIntervalMs === undefined
        ? {}
        : { monitorIntervalMs: input.monitorIntervalMs }),
      ...(input.stallTimeoutMs === undefined ||
      (!input.autoImprove && isSessionHealthCommand)
        ? {}
        : { stallTimeoutMs: input.stallTimeoutMs }),
      ...(input.maxSupervisedAttempts === undefined
        ? {}
        : { maxSupervisedAttempts: input.maxSupervisedAttempts }),
      ...(input.disableAutoImprove
        ? { maxWorkflowPatches: 0 }
        : input.maxWorkflowPatches === undefined
          ? {}
          : { maxWorkflowPatches: input.maxWorkflowPatches }),
      ...(input.disableAutoImprove || input.workflowMutationMode === undefined
        ? {}
        : { workflowMutationMode: input.workflowMutationMode }),
      ...(input.noAllowTargetedRerun ? { allowTargetedRerun: false } : {}),
    }),
  };
}
