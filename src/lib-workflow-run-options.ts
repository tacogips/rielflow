import type { AutoImprovePolicyInput } from "./workflow/auto-improve-policy";
import type { WorkflowRunOptions } from "./workflow/engine";
import type { SessionStoreOptions } from "./workflow/session-store";
import type { MockNodeScenario } from "./workflow/scenario-adapter";
import type { ChatReplyDispatcher, LoadOptions } from "./workflow/types";
import { normalizeWorkflowWorkingDirectoryOverride } from "./workflow/working-directory";

export interface LibraryWorkflowRunOptionsInput
  extends LoadOptions,
    SessionStoreOptions {
  readonly workflowWorkingDirectory?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
  readonly mockScenario?: MockNodeScenario;
  readonly maxSteps?: number;
  readonly maxLoopIterations?: number;
  readonly defaultTimeoutMs?: number;
  readonly dryRun?: boolean;
  readonly eventReplyDispatcher?: ChatReplyDispatcher;
  readonly nestedSuperviserDriver?: boolean;
}

export interface BuildLibraryWorkflowRunOptionsConfig {
  readonly includeWorkflowSourceOptions?: boolean;
  readonly includeRuntimeVariables?: boolean;
  readonly includeExecutionLimits?: boolean;
  readonly includeDryRun?: boolean;
  readonly includeEventReplyDispatcher?: boolean;
  readonly autoImprove?: AutoImprovePolicyInput;
}

export function buildLibraryWorkflowRunOptions(
  input: LibraryWorkflowRunOptionsInput,
  config: BuildLibraryWorkflowRunOptionsConfig = {},
): WorkflowRunOptions {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workflowWorkingDirectory,
  );

  return {
    ...(input.workflowRoot === undefined
      ? {}
      : { workflowRoot: input.workflowRoot }),
    ...(config.includeWorkflowSourceOptions === true &&
    input.workflowScope !== undefined
      ? { workflowScope: input.workflowScope }
      : {}),
    ...(config.includeWorkflowSourceOptions === true &&
    input.userRoot !== undefined
      ? { userRoot: input.userRoot }
      : {}),
    ...(config.includeWorkflowSourceOptions === true &&
    input.projectRoot !== undefined
      ? { projectRoot: input.projectRoot }
      : {}),
    ...(input.artifactRoot === undefined
      ? {}
      : { artifactRoot: input.artifactRoot }),
    ...(input.rootDataDir === undefined
      ? {}
      : { rootDataDir: input.rootDataDir }),
    ...(input.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: input.sessionStoreRoot }),
    ...(input.scheduledEventManager === undefined
      ? {}
      : { scheduledEventManager: input.scheduledEventManager }),
    ...(input.env === undefined ? {} : { env: input.env }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.nodeAddons === undefined ? {} : { nodeAddons: input.nodeAddons }),
    ...(input.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: input.asyncNodeAddonResolvers }),
    ...(input.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: input.nodeAddonResolvers }),
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(config.includeRuntimeVariables === true &&
    input.runtimeVariables !== undefined
      ? { runtimeVariables: input.runtimeVariables }
      : {}),
    ...(input.mockScenario === undefined
      ? {}
      : { mockScenario: input.mockScenario }),
    ...(config.includeExecutionLimits === true && input.maxSteps !== undefined
      ? { maxSteps: input.maxSteps }
      : {}),
    ...(config.includeExecutionLimits === true &&
    input.maxLoopIterations !== undefined
      ? { maxLoopIterations: input.maxLoopIterations }
      : {}),
    ...(config.includeExecutionLimits === true &&
    input.defaultTimeoutMs !== undefined
      ? { defaultTimeoutMs: input.defaultTimeoutMs }
      : {}),
    ...(config.includeDryRun === true && input.dryRun !== undefined
      ? { dryRun: input.dryRun }
      : {}),
    ...(config.includeEventReplyDispatcher === true &&
    input.eventReplyDispatcher !== undefined
      ? { eventReplyDispatcher: input.eventReplyDispatcher }
      : {}),
    ...(config.autoImprove === undefined
      ? {}
      : { autoImprove: config.autoImprove }),
    ...(input.nestedSuperviserDriver === true
      ? { nestedSuperviserDriver: true as const }
      : {}),
  };
}
