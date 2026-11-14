import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";
import type { WorkflowTriggerRunnerOptions } from "./trigger-runner";
import type { SupervisorIntentResolution } from "./supervisor-intent";
import { resolveSupervisorIntentAsync } from "./supervisor-intent";
import { isJsonObject } from "../shared/json";

const DESTRUCTIVE_ACTIONS = new Set<string>(["stop", "restart"]);

function isLlmCommandBinding(binding: EventBinding): boolean {
  const intent = binding.execution?.control?.intentMapping;
  return (
    binding.execution?.mode === "supervised" &&
    isJsonObject(intent) &&
    intent["mode"] === "llm-command"
  );
}

function allowsMultiTarget(binding: EventBinding): boolean {
  const intent = binding.execution?.control?.intentMapping;
  if (!isJsonObject(intent) || intent["mode"] !== "llm-command") {
    return false;
  }
  return intent["allowMultiTargetCommands"] === true;
}

export type LlmBatchPlan =
  | { readonly kind: "per-binding" }
  | {
      readonly kind: "ambiguous";
      readonly reason: string;
      readonly bindingIds: readonly string[];
      /** Cached intents for every llm-command binding so dispatch does not re-run resolvers. */
      readonly intents: ReadonlyMap<
        string,
        | SupervisorIntentResolution
        | { readonly outcome: "skip"; readonly reason: string }
      >;
    }
  | {
      readonly kind: "ready";
      readonly intents: ReadonlyMap<
        string,
        | SupervisorIntentResolution
        | { readonly outcome: "skip"; readonly reason: string }
      >;
    };

/**
 * Pre-computes LLM intent resolutions for all supervised llm-command bindings that
 * match the event. If 0 or 1 such bindings exist, returns `{ kind: "per-binding" }` so
 * the caller can handle them normally. If 2+, runs resolutions in parallel and detects
 * destructive fanout ambiguity.
 */
export async function planSupervisedLlmBindingsDispatch(input: {
  readonly bindings: readonly EventBinding[];
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig | undefined;
  readonly options: WorkflowTriggerRunnerOptions;
}): Promise<LlmBatchPlan> {
  const llmBindings = input.bindings.filter(isLlmCommandBinding);

  if (llmBindings.length <= 1) {
    return { kind: "per-binding" };
  }

  const resolved = await Promise.all(
    llmBindings.map(async (binding) => {
      const intent = await resolveSupervisorIntentAsync({
        binding,
        event: input.event,
        ...(input.source === undefined ? {} : { source: input.source }),
        divedraOptions: input.options,
      });
      return { bindingId: binding.id, binding, intent };
    }),
  );

  const allAllowMultiTarget = llmBindings.every(allowsMultiTarget);

  if (!allAllowMultiTarget) {
    const destructiveMatches = resolved.filter(
      (r) =>
        r.intent.outcome === "action" &&
        DESTRUCTIVE_ACTIONS.has(r.intent.action),
    );

    if (destructiveMatches.length >= 2) {
      const eventText =
        typeof input.event.input["text"] === "string"
          ? input.event.input["text"].trim().toLowerCase()
          : undefined;

      const targetWorkflowName =
        typeof input.event.input["targetWorkflowName"] === "string"
          ? input.event.input["targetWorkflowName"].trim()
          : undefined;

      const candidateNames = destructiveMatches
        .map((r) => r.binding.workflowName?.trim())
        .filter((name): name is string => name !== undefined && name.length > 0);

      let uniqueMatch: string | undefined;

      if (targetWorkflowName !== undefined) {
        const tn = targetWorkflowName.toLowerCase();
        const exactMatches = candidateNames.filter(
          (name) => name.toLowerCase() === tn,
        );
        if (exactMatches.length === 1) {
          uniqueMatch = exactMatches[0];
        }
      }

      if (uniqueMatch === undefined && eventText !== undefined) {
        const lowerText = eventText.toLowerCase();
        const substringMatches = candidateNames.filter((name) =>
          lowerText.includes(name.toLowerCase()),
        );
        if (substringMatches.length === 1) {
          uniqueMatch = substringMatches[0];
        }
      }

      if (uniqueMatch === undefined) {
        const ambiguousBindingIds = destructiveMatches.map((r) => r.bindingId);
        const ambiguousReason = `destructive supervisor action is ambiguous among bindings [${ambiguousBindingIds.join(", ")}]: cannot determine unique target workflow`;

        const intents = new Map<
          string,
          | SupervisorIntentResolution
          | { readonly outcome: "skip"; readonly reason: string }
        >();
        for (const r of resolved) {
          if (ambiguousBindingIds.includes(r.bindingId)) {
            intents.set(r.bindingId, {
              outcome: "skip",
              reason: ambiguousReason,
            });
          } else {
            intents.set(r.bindingId, r.intent);
          }
        }

        return {
          kind: "ambiguous",
          reason: ambiguousReason,
          bindingIds: ambiguousBindingIds,
          intents,
        };
      }

      const filteredResolved = resolved.map((r) => {
        if (
          r.intent.outcome === "action" &&
          DESTRUCTIVE_ACTIONS.has(r.intent.action) &&
          r.binding.workflowName !== uniqueMatch
        ) {
          return {
            ...r,
            intent: {
              outcome: "skip" as const,
              reason: `destructive action suppressed: unique target identified as '${uniqueMatch}'`,
            },
          };
        }
        return r;
      });

      const intents = new Map<
        string,
        | SupervisorIntentResolution
        | { readonly outcome: "skip"; readonly reason: string }
      >();
      for (const r of filteredResolved) {
        intents.set(r.bindingId, r.intent);
      }
      return { kind: "ready", intents };
    }
  }

  const intents = new Map<
    string,
    | SupervisorIntentResolution
    | { readonly outcome: "skip"; readonly reason: string }
  >();
  for (const r of resolved) {
    intents.set(r.bindingId, r.intent);
  }
  return { kind: "ready", intents };
}
