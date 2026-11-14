import type { AutoImprovePolicyInput } from "divedra-core";
import type { WorkflowRunOptions } from "divedra-core";
import type { SessionStoreOptions } from "divedra-core";
import type { MockNodeScenario } from "./workflow/scenario-adapter";
import type { ChatReplyDispatcher, LoadOptions } from "divedra-core";
import { normalizeWorkflowWorkingDirectoryOverride } from "divedra-core";
import { createLifecycleSupervisionPolicyInput } from "./workflow/auto-improve-policy";

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

export interface WorkflowExecutionOptionProjectionInput {
  readonly workingDirectory?: string;
  readonly autoImprove?: AutoImprovePolicyInput;
  readonly disableAutoImprove?: boolean;
  readonly nestedSuperviser?: boolean;
  readonly defaultTimeoutMs?: number;
  readonly debug?: boolean;
  readonly dryRun?: boolean;
  readonly maxConcurrency?: number;
  readonly maxLoopIterations?: number;
  readonly maxSteps?: number;
}

export interface WorkflowExecutionRequestProjectionInput {
  readonly workingDirectory?: string;
  readonly dryRun?: boolean;
  readonly maxLoopIterations?: number;
  readonly maxSteps?: number;
  readonly defaultTimeoutMs?: number;
}

export function buildLocalWorkflowRunOptionProjection(
  input: WorkflowExecutionOptionProjectionInput,
  defaultAutoImprove = false,
): Pick<
  WorkflowRunOptions,
  | "autoImprove"
  | "nestedSuperviserDriver"
  | "defaultTimeoutMs"
  | "debug"
  | "dryRun"
  | "maxConcurrency"
  | "maxLoopIterations"
  | "maxSteps"
  | "workflowWorkingDirectory"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  const autoImprove =
    input.autoImprove ??
    (!defaultAutoImprove
      ? undefined
      : input.disableAutoImprove
        ? createLifecycleSupervisionPolicyInput()
        : { enabled: true });
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: input.maxConcurrency }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
    ...(input.debug ? { debug: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
    ...(autoImprove === undefined ? {} : { autoImprove }),
    ...(input.nestedSuperviser ? { nestedSuperviserDriver: true } : {}),
  };
}

export function buildRemoteWorkflowExecutionInputProjection(
  input: WorkflowExecutionOptionProjectionInput,
): Readonly<Record<string, unknown>> {
  const workingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  const autoImprove: AutoImprovePolicyInput =
    input.autoImprove ??
    (input.disableAutoImprove
      ? createLifecycleSupervisionPolicyInput()
      : { enabled: true });
  return {
    autoImprove,
    ...(input.nestedSuperviser ? { nestedSuperviser: true } : {}),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(input.dryRun ? { dryRun: true } : {}),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: input.maxConcurrency }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
}

export function buildRemoteWorkflowExecutionRequestProjection(
  input: WorkflowExecutionRequestProjectionInput,
): Readonly<Record<string, unknown>> {
  const workingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  return {
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
}

export function buildLocalWorkflowExecutionRequestProjection(
  input: WorkflowExecutionRequestProjectionInput,
): Pick<
  WorkflowRunOptions,
  | "workflowWorkingDirectory"
  | "dryRun"
  | "maxLoopIterations"
  | "maxSteps"
  | "defaultTimeoutMs"
> {
  const workflowWorkingDirectory = normalizeWorkflowWorkingDirectoryOverride(
    input.workingDirectory,
  );
  return {
    ...(workflowWorkingDirectory === undefined
      ? {}
      : { workflowWorkingDirectory }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.maxSteps === undefined ? {} : { maxSteps: input.maxSteps }),
    ...(input.maxLoopIterations === undefined
      ? {}
      : { maxLoopIterations: input.maxLoopIterations }),
    ...(input.defaultTimeoutMs === undefined
      ? {}
      : { defaultTimeoutMs: input.defaultTimeoutMs }),
  };
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
    ...(input.nodePatch === undefined ? {} : { nodePatch: input.nodePatch }),
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
