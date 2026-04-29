import { isJsonObject } from "../shared/json";
import { resolveSupervisedCorrelationKey } from "./supervisor-correlation";
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

const ALL_ACTIONS: readonly EventSupervisorAction[] = [
  "start",
  "stop",
  "restart",
  "status",
  "input",
];

function isSupervisorAction(value: unknown): value is EventSupervisorAction {
  return (
    value === "start" ||
    value === "stop" ||
    value === "restart" ||
    value === "status" ||
    value === "input"
  );
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
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function resolveCommandMapCandidates(text: string): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const [firstToken] = trimmed.split(/\s+/, 1);
  if (firstToken === undefined || firstToken === trimmed) {
    return [trimmed];
  }
  return [trimmed, firstToken];
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

export type SupervisorIntentResolution =
  | {
      readonly outcome: "action";
      readonly action: EventSupervisorAction;
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
    if (text === undefined || text.length === 0) {
      const fallback = mapping.defaultAction ?? "input";
      if (!allow.includes(fallback)) {
        return {
          outcome: "skip",
          reason: `default action '${fallback}' is not allowed`,
        };
      }
      return { outcome: "action", action: fallback };
    }
    const candidates = resolveCommandMapCandidates(text);
    for (const action of ALL_ACTIONS) {
      const token = mapping.commands[action];
      if (token !== undefined && candidates.includes(token)) {
        if (!allow.includes(action)) {
          return {
            outcome: "skip",
            reason: `action '${action}' is not allowed`,
          };
        }
        return { outcome: "action", action };
      }
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

  const managedWorkflowName = input.binding.workflowName.trim();
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
