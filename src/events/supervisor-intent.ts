import { isJsonObject } from "../shared/json";
import {
  defaultSupervisorWorkflowName,
  resolveSupervisedCorrelationKey,
} from "./supervisor-correlation";
import { createEventSupervisedRunRepository } from "./supervised-runs";
import type {
  EventBinding,
  EventSourceConfig,
  EventSupervisorAction,
  EventSupervisorIntentMappingCommandMap,
  EventSupervisorIntentMappingLlm,
  EventSupervisorIntentMappingStructuredOnly,
  EventSupervisorIntentMappingStructuredOrCommand,
  ExternalEventEnvelope,
} from "./types";
import type { WorkflowTriggerRunnerOptions } from "./trigger-runner";
import { runSupervisorLlmResolver } from "./supervisor-llm-resolver";
import {
  EVENT_SUPERVISOR_ACTIONS,
  EVENT_SUPERVISOR_ACTION_SET,
  parseSupervisorCommandText,
} from "./supervisor-command-contract";

const ALL_ACTIONS: readonly EventSupervisorAction[] = EVENT_SUPERVISOR_ACTIONS;

function isSupervisorAction(value: unknown): value is EventSupervisorAction {
  return typeof value === "string" && EVENT_SUPERVISOR_ACTION_SET.has(value);
}

function normalizeAllowActions(
  binding: EventBinding,
): readonly EventSupervisorAction[] {
  const raw = binding.execution?.control?.allowActions;
  if (raw === undefined || raw.length === 0) {
    return ALL_ACTIONS;
  }
  return raw;
}

function readPath(root: unknown, pathSegments: readonly string[]): unknown {
  let current = root;
  for (const segment of pathSegments) {
    if (!isJsonObject(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

function resolveCommandMapText(
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
  binding: EventBinding,
  inputPath: string | undefined,
): string | undefined {
  const path = inputPath ?? "event.input.text";
  const segments = path.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  const rootName = segments[0];
  const rest = segments.slice(1);
  const root =
    rootName === "event"
      ? event
      : rootName === "source"
        ? source
        : rootName === "binding"
          ? binding
          : undefined;
  if (root === undefined) {
    return undefined;
  }
  const value = readPath(root, rest);
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

type DeterministicSupervisorIntentMapping =
  | EventSupervisorIntentMappingStructuredOrCommand
  | EventSupervisorIntentMappingCommandMap
  | EventSupervisorIntentMappingStructuredOnly;

function resolveIntentMapping(
  binding: EventBinding,
): DeterministicSupervisorIntentMapping {
  const configured = binding.execution?.control?.intentMapping;
  if (
    isJsonObject(configured) &&
    typeof configured["mode"] === "string" &&
    (configured["mode"] === "structured-or-command" ||
      configured["mode"] === "command-map" ||
      configured["mode"] === "structured-only")
  ) {
    return configured as DeterministicSupervisorIntentMapping;
  }
  return { mode: "structured-or-command", defaultAction: "input" };
}

function resolveLlmIntentMapping(
  binding: EventBinding,
): EventSupervisorIntentMappingLlm | undefined {
  const configured = binding.execution?.control?.intentMapping;
  if (
    isJsonObject(configured) &&
    configured["mode"] === "llm-command" &&
    typeof configured["resolverWorkflowName"] === "string" &&
    configured["resolverWorkflowName"].length > 0 &&
    typeof configured["resolverNodeId"] === "string" &&
    configured["resolverNodeId"].length > 0
  ) {
    return configured as unknown as EventSupervisorIntentMappingLlm;
  }
  return undefined;
}

function resolveCommandAnalysisResolver(
  binding: EventBinding,
  mapping: EventSupervisorIntentMappingCommandMap,
): {
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
} {
  const resolverWorkflowName =
    typeof mapping.resolverWorkflowName === "string" &&
    mapping.resolverWorkflowName.length > 0
      ? mapping.resolverWorkflowName
      : (binding.execution?.supervisorWorkflowName ??
        defaultSupervisorWorkflowName());
  const resolverNodeId =
    typeof mapping.resolverNodeId === "string" &&
    mapping.resolverNodeId.length > 0
      ? mapping.resolverNodeId
      : "command-analysis";
  return { resolverWorkflowName, resolverNodeId };
}

export type SupervisorIntentResolution =
  | {
      readonly outcome: "action";
      readonly action: EventSupervisorAction;
      readonly args?: readonly string[];
      readonly runtimeVariables?: Readonly<Record<string, unknown>>;
      readonly reason?: string;
      readonly commandText?: string;
    }
  | { readonly outcome: "skip"; readonly reason: string };

export function resolveSupervisorIntent(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
}): SupervisorIntentResolution {
  const configured = input.binding.execution?.control?.intentMapping;
  if (isJsonObject(configured) && configured["mode"] === "llm-command") {
    return {
      outcome: "skip",
      reason: "llm-command intent mapping requires async resolution",
    };
  }
  const allow = normalizeAllowActions(input.binding);
  const mapping = resolveIntentMapping(input.binding);

  if (mapping.mode === "structured-only") {
    const raw = input.event.input["action"];
    if (!isSupervisorAction(raw)) {
      return {
        outcome: "skip",
        reason: "structured-only intent mapping requires event.input.action",
      };
    }
    if (!allow.includes(raw)) {
      return { outcome: "skip", reason: `action '${raw}' is not allowed` };
    }
    return { outcome: "action", action: raw };
  }

  if (mapping.mode === "command-map") {
    const text = resolveCommandMapText(
      input.event,
      input.source,
      input.binding,
      mapping.inputPath,
    );
    const parsed = parseSupervisorCommandText({
      text: text ?? "",
      commands: mapping.commands,
    });
    if (parsed.outcome === "command") {
      const { action, args } = parsed.command;
      if (!allow.includes(action)) {
        return {
          outcome: "skip",
          reason: `action '${action}' is not allowed`,
        };
      }
      return {
        outcome: "action",
        action,
        args,
        ...(text === undefined ? {} : { commandText: text }),
      };
    }
    return {
      outcome: "skip",
      reason: `command-analysis required: ${parsed.request.reason}`,
    };
  }

  const raw = input.event.input["action"];
  if (isSupervisorAction(raw)) {
    if (!allow.includes(raw)) {
      return { outcome: "skip", reason: `action '${raw}' is not allowed` };
    }
    return { outcome: "action", action: raw };
  }

  const fallback = mapping.defaultAction ?? "input";
  if (!allow.includes(fallback)) {
    return {
      outcome: "skip",
      reason: `default action '${fallback}' is not allowed`,
    };
  }
  return { outcome: "action", action: fallback };
}

const DEFAULT_LLM_MIN_CONFIDENCE = 0.7;

/**
 * Async supervisor intent resolution that handles llm-command mode in addition to
 * all deterministic modes. For non-llm bindings, delegates synchronously to
 * resolveSupervisorIntent.
 */
export async function resolveSupervisorIntentAsync(input: {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig;
  readonly divedraOptions: WorkflowTriggerRunnerOptions;
}): Promise<SupervisorIntentResolution> {
  const llmMapping = resolveLlmIntentMapping(input.binding);
  const configured = input.binding.execution?.control?.intentMapping;
  const commandMapMapping =
    llmMapping === undefined &&
    isJsonObject(configured) &&
    configured["mode"] === "command-map"
      ? (configured as unknown as EventSupervisorIntentMappingCommandMap)
      : undefined;
  if (commandMapMapping !== undefined) {
    const deterministic = resolveSupervisorIntent({
      binding: input.binding,
      event: input.event,
      ...(input.source === undefined ? {} : { source: input.source }),
    });
    if (
      deterministic.outcome !== "skip" ||
      !deterministic.reason.startsWith("command-analysis required:")
    ) {
      return deterministic;
    }

    const allow = normalizeAllowActions(input.binding);
    const correlationKey = resolveSupervisedCorrelationKey({
      binding: input.binding,
      event: input.event,
      ...(input.source === undefined ? {} : { source: input.source }),
    });
    const activeRun = await createEventSupervisedRunRepository(
      input.divedraOptions,
    ).findActiveByCorrelation({
      sourceId: input.binding.sourceId,
      bindingId: input.binding.id,
      correlationKey,
    });

    const commandAnalysisResolver = resolveCommandAnalysisResolver(
      input.binding,
      commandMapMapping,
    );
    const resolverResult = await runSupervisorLlmResolver({
      binding: input.binding,
      event: input.event,
      ...(input.source === undefined ? {} : { source: input.source }),
      resolverWorkflowName: commandAnalysisResolver.resolverWorkflowName,
      resolverNodeId: commandAnalysisResolver.resolverNodeId,
      ...(typeof commandMapMapping.inputPath === "string"
        ? { inputPath: commandMapMapping.inputPath }
        : {}),
      allowedActions: allow,
      ...(activeRun?.supervisedRunId === undefined
        ? {}
        : { activeSupervisedRunId: activeRun.supervisedRunId }),
      ...(commandMapMapping.fallbackAction === "ignore"
        ? { defaultAction: "ignore" as const }
        : {}),
      options: input.divedraOptions,
    });

    if (!resolverResult.ok) {
      return {
        outcome: "skip",
        reason: `command-analysis resolver failed: ${resolverResult.error}`,
      };
    }

    const decision = resolverResult.decision;
    const minConfidence =
      typeof commandMapMapping.minConfidence === "number"
        ? commandMapMapping.minConfidence
        : DEFAULT_LLM_MIN_CONFIDENCE;
    if (decision.confidence < minConfidence) {
      return {
        outcome: "skip",
        reason: `command-analysis confidence ${decision.confidence.toFixed(3)} is below minimum ${minConfidence.toFixed(3)}`,
      };
    }
    if (decision.action === "ignore") {
      return { outcome: "skip", reason: "command-analysis decision: ignore" };
    }
    const resolvedAction = decision.action;
    if (!allow.includes(resolvedAction)) {
      return {
        outcome: "skip",
        reason: `command-analysis resolved action '${resolvedAction}' is not in the allowed actions list`,
      };
    }
    const managedWorkflowBinding = input.binding.workflowName?.trim();
    if (
      managedWorkflowBinding === undefined ||
      managedWorkflowBinding.length === 0
    ) {
      return {
        outcome: "skip",
        reason: "binding.workflowName is required for command-analysis",
      };
    }
    if (decision.managedWorkflowName !== managedWorkflowBinding) {
      return {
        outcome: "skip",
        reason: `command-analysis resolved managedWorkflowName '${decision.managedWorkflowName}' does not match binding workflowName '${managedWorkflowBinding}'`,
      };
    }
    return {
      outcome: "action",
      action: resolvedAction,
      ...(decision.runtimeVariables === undefined
        ? {}
        : { runtimeVariables: decision.runtimeVariables }),
      ...(decision.reason.length === 0 ? {} : { reason: decision.reason }),
      ...(decision.commandText === undefined
        ? {}
        : { commandText: decision.commandText }),
    };
  }

  if (llmMapping === undefined) {
    return resolveSupervisorIntent({
      binding: input.binding,
      event: input.event,
      ...(input.source === undefined ? {} : { source: input.source }),
    });
  }

  const allow = normalizeAllowActions(input.binding);
  const correlationKey = resolveSupervisedCorrelationKey({
    binding: input.binding,
    event: input.event,
    ...(input.source === undefined ? {} : { source: input.source }),
  });
  const activeRun = await createEventSupervisedRunRepository(
    input.divedraOptions,
  ).findActiveByCorrelation({
    sourceId: input.binding.sourceId,
    bindingId: input.binding.id,
    correlationKey,
  });

  const resolverResult = await runSupervisorLlmResolver({
    binding: input.binding,
    event: input.event,
    ...(input.source === undefined ? {} : { source: input.source }),
    resolverWorkflowName: llmMapping.resolverWorkflowName,
    resolverNodeId: llmMapping.resolverNodeId,
    ...(llmMapping.inputPath === undefined
      ? {}
      : { inputPath: llmMapping.inputPath }),
    allowedActions: allow,
    ...(activeRun?.supervisedRunId === undefined
      ? {}
      : { activeSupervisedRunId: activeRun.supervisedRunId }),
    ...(llmMapping.defaultAction === undefined
      ? {}
      : { defaultAction: llmMapping.defaultAction }),
    options: input.divedraOptions,
  });

  if (!resolverResult.ok) {
    return {
      outcome: "skip",
      reason: `llm resolver failed: ${resolverResult.error}`,
    };
  }

  const decision = resolverResult.decision;

  const minConfidence = llmMapping.minConfidence ?? DEFAULT_LLM_MIN_CONFIDENCE;
  if (decision.confidence < minConfidence) {
    return {
      outcome: "skip",
      reason: `llm decision confidence ${decision.confidence.toFixed(3)} is below minimum ${minConfidence.toFixed(3)}`,
    };
  }

  if (decision.action === "ignore") {
    return { outcome: "skip", reason: `llm decision: ignore` };
  }

  const resolvedAction = decision.action;
  if (!allow.includes(resolvedAction)) {
    return {
      outcome: "skip",
      reason: `llm resolved action '${resolvedAction}' is not in the allowed actions list`,
    };
  }

  const managedWorkflowBinding = input.binding.workflowName?.trim();
  if (
    managedWorkflowBinding === undefined ||
    managedWorkflowBinding.length === 0
  ) {
    return {
      outcome: "skip",
      reason:
        "binding.workflowName is required for supervised intent resolution",
    };
  }

  const managedWorkflowName = managedWorkflowBinding;
  if (decision.managedWorkflowName !== managedWorkflowName) {
    return {
      outcome: "skip",
      reason: `llm resolved managedWorkflowName '${decision.managedWorkflowName}' does not match binding workflowName '${managedWorkflowName}'`,
    };
  }

  return {
    outcome: "action",
    action: resolvedAction,
    ...(decision.runtimeVariables === undefined
      ? {}
      : { runtimeVariables: decision.runtimeVariables }),
    ...(decision.reason.length === 0 ? {} : { reason: decision.reason }),
    ...(decision.commandText === undefined
      ? {}
      : { commandText: decision.commandText }),
  };
}
