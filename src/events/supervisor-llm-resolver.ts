import { readFile } from "node:fs/promises";
import path from "node:path";
import { runWorkflow } from "../workflow/engine";
import { loadSession } from "../workflow/session-store";
import type { WorkflowTriggerRunnerOptions } from "./trigger-runner";
import type {
  EventBinding,
  EventSourceConfig,
  ExternalEventEnvelope,
} from "./types";
import { defaultSupervisorWorkflowName } from "./supervisor-correlation";
import {
  parseSupervisorChatCommandDecision,
  type SupervisorChatCommandDecision,
} from "./supervisor-command-contract";
import type { EventSupervisorAction } from "./types";

const ALL_SUPERVISOR_CHAT_ACTIONS: readonly EventSupervisorAction[] = [
  "start",
  "stop",
  "restart",
  "status",
  "input",
];

export interface RunSupervisorLlmResolverInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig | undefined;
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly inputPath?: string | undefined;
  readonly allowedActions: readonly EventSupervisorAction[];
  readonly activeSupervisedRunId?: string;
  /** When resolver output JSON fails validation, treat as ignore or input per binding policy. */
  readonly defaultAction?: "input" | "ignore";
  readonly options: WorkflowTriggerRunnerOptions;
}

export type RunSupervisorLlmResolverResult =
  | { readonly ok: true; readonly decision: SupervisorChatCommandDecision }
  | { readonly ok: false; readonly error: string };

function readEventPath(
  event: ExternalEventEnvelope,
  source: EventSourceConfig | undefined,
  binding: EventBinding,
  inputPath: string | undefined,
): string | undefined {
  const dotPath = inputPath ?? "event.input.text";
  const segments = dotPath.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return undefined;
  }
  const rootName = segments[0];
  const rest = segments.slice(1);
  let root: unknown;
  if (rootName === "event") {
    root = event;
  } else if (rootName === "source") {
    root = source;
  } else if (rootName === "binding") {
    root = binding;
  } else {
    return undefined;
  }
  let current: unknown = root;
  for (const segment of rest) {
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  if (typeof current === "string") {
    return current.trim() || undefined;
  }
  if (typeof current === "number" || typeof current === "boolean") {
    return String(current);
  }
  return undefined;
}

/**
 * Runs the LLM resolver workflow and extracts a supervisor chat command decision
 * from the named resolver node's output artifact.
 */
export async function runSupervisorLlmResolver(
  input: RunSupervisorLlmResolverInput,
): Promise<RunSupervisorLlmResolverResult> {
  const text = readEventPath(
    input.event,
    input.source,
    input.binding,
    input.inputPath,
  );

  const supervisorWorkflowName =
    input.binding.execution?.supervisorWorkflowName ??
    defaultSupervisorWorkflowName();

  const allowedActionsForResolver: readonly EventSupervisorAction[] =
    input.allowedActions.length > 0
      ? input.allowedActions
      : ALL_SUPERVISOR_CHAT_ACTIONS;

  const resolverVariables: Readonly<Record<string, unknown>> = {
    ...(text !== undefined ? { text } : {}),
    managedWorkflowName: input.binding.workflowName,
    supervisorWorkflowName,
    allowedActions: [...allowedActionsForResolver],
    ...(input.activeSupervisedRunId !== undefined
      ? { activeSupervisedRunId: input.activeSupervisedRunId }
      : {}),
  };

  const runResult = await runWorkflow(input.resolverWorkflowName, {
    ...input.options,
    runtimeVariables: resolverVariables,
  });

  if (!runResult.ok) {
    return {
      ok: false,
      error: `resolver workflow failed: ${runResult.error.message}`,
    };
  }

  const sessionId = runResult.value.session.sessionId;
  const sessionResult = await loadSession(sessionId, input.options);
  if (!sessionResult.ok) {
    return {
      ok: false,
      error: `failed to load resolver session '${sessionId}': ${sessionResult.error.message}`,
    };
  }

  const executions = sessionResult.value.nodeExecutions;
  let lastSucceededExec: (typeof executions)[number] | undefined;
  for (const exec of executions) {
    if (exec.nodeId === input.resolverNodeId && exec.status === "succeeded") {
      lastSucceededExec = exec;
    }
  }

  if (lastSucceededExec === undefined) {
    return {
      ok: false,
      error: `no succeeded execution found for resolver node '${input.resolverNodeId}' in session '${sessionId}'`,
    };
  }

  const outputJsonPath = path.join(
    lastSucceededExec.artifactDir,
    "output.json",
  );
  let rawJson: string;
  try {
    rawJson = await readFile(outputJsonPath, "utf8");
  } catch {
    return {
      ok: false,
      error: `resolver node output artifact not found at '${outputJsonPath}'`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    const fb = input.defaultAction;
    const managedWorkflowName = input.binding.workflowName.trim();
    if (fb === "ignore") {
      return {
        ok: true,
        decision: {
          action: "ignore",
          managedWorkflowName,
          confidence: 1,
          reason:
            "defaultAction ignore after resolver output.json was not valid JSON",
        },
      };
    }
    if (fb === "input") {
      return {
        ok: true,
        decision: {
          action: "input",
          managedWorkflowName,
          confidence: 1,
          reason:
            "defaultAction input after resolver output.json was not valid JSON",
        },
      };
    }
    return {
      ok: false,
      error: `resolver node output.json is not valid JSON at '${outputJsonPath}'`,
    };
  }

  // The engine writes the full adapter output to output.json; the actual node
  // decision payload is nested under the "payload" key.
  let decisionValue: unknown = parsed;
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "payload" in parsed
  ) {
    decisionValue = (parsed as Readonly<Record<string, unknown>>)["payload"];
  }

  const decision = parseSupervisorChatCommandDecision(decisionValue);
  if (!decision.ok) {
    const fallback = input.defaultAction;
    const managedWorkflowName = input.binding.workflowName.trim();
    if (fallback === "ignore") {
      return {
        ok: true,
        decision: {
          action: "ignore",
          managedWorkflowName,
          confidence: 1,
          reason: `defaultAction ignore after invalid resolver output: ${decision.error}`,
        },
      };
    }
    if (fallback === "input") {
      return {
        ok: true,
        decision: {
          action: "input",
          managedWorkflowName,
          confidence: 1,
          reason: `defaultAction input after invalid resolver output: ${decision.error}`,
        },
      };
    }
    return {
      ok: false,
      error: `resolver node output failed validation: ${decision.error}`,
    };
  }

  return { ok: true, decision: decision.value };
}
