import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveEventPathText } from "divedra-events/path-resolution";
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
  EVENT_SUPERVISOR_ACTIONS,
  parseSupervisorChatCommandDecision,
  type SupervisorChatCommandDecision,
} from "./supervisor-command-contract";
import {
  fallbackSupervisorDispatchProposalForLowConfidence,
  parseSupervisorDispatchProposal,
  type ManagedWorkflowRunRecordLight,
  type SupervisorDispatchProposal,
} from "./supervisor-dispatch-contract";
import type { WorkflowSupervisorProfile } from "./supervisor-profiles";
import type { EventSupervisorAction } from "./types";

const ALL_SUPERVISOR_CHAT_ACTIONS: readonly EventSupervisorAction[] =
  EVENT_SUPERVISOR_ACTIONS;

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

const DEFAULT_DISPATCH_LLM_MIN_CONFIDENCE = 0.75;

export type DispatchResolverInvalidOutputBehavior =
  | "clarify"
  | "no-op"
  | "error";

export type RunSupervisorDispatchLlmResolverResult =
  | { readonly ok: true; readonly proposal: SupervisorDispatchProposal }
  | { readonly ok: false; readonly error: string };

export interface RunSupervisorDispatchLlmResolverInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig | undefined;
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly inputPath?: string | undefined;
  readonly profile: WorkflowSupervisorProfile;
  readonly supervisorConversationId: string;
  readonly sourceMessageId: string;
  readonly conversationRevision: number;
  readonly managedRuns: readonly ManagedWorkflowRunRecordLight[];
  /**
   * Minimum proposal confidence; proposals below this become clarify/no-op per
   * {@link RunSupervisorDispatchLlmResolverInput.invalidOutputBehavior}.
   */
  readonly minConfidence?: number;
  /**
   * When resolver `output.json` is not valid JSON, structurally invalid, or
   * below {@link RunSupervisorDispatchLlmResolverInput.minConfidence}.
   * Defaults to `"clarify"`.
   */
  readonly invalidOutputBehavior?: DispatchResolverInvalidOutputBehavior;
  readonly options: WorkflowTriggerRunnerOptions;
}

interface ReadResolverWorkflowNodeOutputInput {
  readonly resolverWorkflowName: string;
  readonly resolverNodeId: string;
  readonly resolverVariables: Readonly<Record<string, unknown>>;
  readonly options: WorkflowTriggerRunnerOptions;
}

type ReadResolverWorkflowNodeOutputResult =
  | {
      readonly ok: true;
      readonly outputJsonPath: string;
      readonly rawJson: string;
    }
  | { readonly ok: false; readonly error: string };

interface ResolveSupervisorEventTextInput {
  readonly binding: EventBinding;
  readonly event: ExternalEventEnvelope;
  readonly source?: EventSourceConfig | undefined;
  readonly inputPath?: string | undefined;
  readonly allowArrayTraversal?: boolean | undefined;
  readonly trimString?: boolean | undefined;
}

export function resolveSupervisorEventText(
  input: ResolveSupervisorEventTextInput,
): string | undefined {
  return resolveEventPathText({
    path: input.inputPath,
    defaultPath: "event.input.text",
    roots: {
      binding: input.binding,
      event: input.event,
      source: input.source,
    },
    allowedRoots: ["binding", "event", "source"],
    allowArrayTraversal: input.allowArrayTraversal,
    filterEmptySegments: true,
    trimString: input.trimString,
  });
}

function resultForInvalidDispatchResolverOutput(
  behavior: DispatchResolverInvalidOutputBehavior,
  reason: string,
): RunSupervisorDispatchLlmResolverResult {
  if (behavior === "error") {
    return { ok: false, error: reason };
  }
  if (behavior === "clarify") {
    return {
      ok: true,
      proposal: fallbackSupervisorDispatchProposalForLowConfidence(reason),
    };
  }
  return {
    ok: true,
    proposal: {
      action: "no-op",
      reason,
      confidence: 1,
    },
  };
}

async function readResolverWorkflowNodeOutput(
  input: ReadResolverWorkflowNodeOutputInput,
): Promise<ReadResolverWorkflowNodeOutputResult> {
  const runResult = await runWorkflow(input.resolverWorkflowName, {
    ...input.options,
    runtimeVariables: input.resolverVariables,
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
  try {
    return {
      ok: true,
      outputJsonPath,
      rawJson: await readFile(outputJsonPath, "utf8"),
    };
  } catch {
    return {
      ok: false,
      error: `resolver node output artifact not found at '${outputJsonPath}'`,
    };
  }
}

function parseResolverOutputJson(
  rawJson: string,
  outputJsonPath: string,
):
  | { readonly ok: true; readonly parsed: unknown }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  try {
    return { ok: true, parsed: JSON.parse(rawJson) as unknown };
  } catch {
    return {
      ok: false,
      error: `resolver node output.json is not valid JSON at '${outputJsonPath}'`,
    };
  }
}

function extractResolverPayload(parsed: unknown): unknown {
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "payload" in parsed
  ) {
    return (parsed as Readonly<Record<string, unknown>>)["payload"];
  }
  return parsed;
}

/**
 * Interprets parsed resolver `output.json` (optionally adapter-wrapped with a
 * `payload` field) into a dispatch proposal, applying the same confidence floor
 * and invalid-output behavior as {@link runSupervisorDispatchLlmResolver}.
 */
export function interpretSupervisorDispatchResolverRootJson(
  parsed: unknown,
  options: {
    readonly minConfidence: number;
    readonly invalidOutputBehavior: DispatchResolverInvalidOutputBehavior;
  },
): RunSupervisorDispatchLlmResolverResult {
  const decision = parseSupervisorDispatchProposal(
    extractResolverPayload(parsed),
  );
  if (!decision.ok) {
    return resultForInvalidDispatchResolverOutput(
      options.invalidOutputBehavior,
      `resolver dispatch output failed validation: ${decision.error}`,
    );
  }

  const proposal = decision.value;
  const min = options.minConfidence;
  if (
    proposal.confidence !== undefined &&
    Number.isFinite(proposal.confidence) &&
    proposal.confidence < min
  ) {
    return resultForInvalidDispatchResolverOutput(
      options.invalidOutputBehavior,
      `confidence ${String(proposal.confidence)} is below minimum ${String(min)}`,
    );
  }

  return { ok: true, proposal };
}

/**
 * Runs the dispatcher LLM resolver workflow and extracts a
 * {@link SupervisorDispatchProposal} from the named resolver node's
 * `output.json` artifact.
 */
export async function runSupervisorDispatchLlmResolver(
  input: RunSupervisorDispatchLlmResolverInput,
): Promise<RunSupervisorDispatchLlmResolverResult> {
  const text = resolveSupervisorEventText({
    binding: input.binding,
    event: input.event,
    source: input.source,
    inputPath: input.inputPath,
    trimString: true,
  });

  const minConfidence =
    input.minConfidence ??
    input.profile.conversationPolicy?.llmDecisionMinConfidence ??
    DEFAULT_DISPATCH_LLM_MIN_CONFIDENCE;

  const invalidOutputBehavior = input.invalidOutputBehavior ?? "clarify";

  const resolverVariables: Readonly<Record<string, unknown>> = {
    ...(text !== undefined ? { text } : {}),
    supervisorWorkflowName: input.profile.supervisorWorkflowName,
    supervisorProfile: input.profile,
    managedRuns: [...input.managedRuns],
    supervisorConversationId: input.supervisorConversationId,
    sourceMessageId: input.sourceMessageId,
    conversationRevision: input.conversationRevision,
  };

  const output = await readResolverWorkflowNodeOutput({
    resolverWorkflowName: input.resolverWorkflowName,
    resolverNodeId: input.resolverNodeId,
    resolverVariables,
    options: input.options,
  });
  if (!output.ok) {
    return output;
  }

  const parsed = parseResolverOutputJson(output.rawJson, output.outputJsonPath);
  if (!parsed.ok) {
    return resultForInvalidDispatchResolverOutput(
      invalidOutputBehavior,
      parsed.error,
    );
  }

  return interpretSupervisorDispatchResolverRootJson(parsed.parsed, {
    minConfidence,
    invalidOutputBehavior,
  });
}

/**
 * Runs the LLM resolver workflow and extracts a supervisor chat command decision
 * from the named resolver node's output artifact.
 */
export async function runSupervisorLlmResolver(
  input: RunSupervisorLlmResolverInput,
): Promise<RunSupervisorLlmResolverResult> {
  const text = resolveSupervisorEventText({
    binding: input.binding,
    event: input.event,
    source: input.source,
    inputPath: input.inputPath,
    trimString: true,
  });

  const supervisorWorkflowName =
    input.binding.execution?.supervisorWorkflowName ??
    defaultSupervisorWorkflowName();

  const allowedActionsForResolver: readonly EventSupervisorAction[] =
    input.allowedActions.length > 0
      ? input.allowedActions
      : ALL_SUPERVISOR_CHAT_ACTIONS;

  const managedWorkflowBindingName = input.binding.workflowName?.trim();
  if (
    managedWorkflowBindingName === undefined ||
    managedWorkflowBindingName.length === 0
  ) {
    return {
      ok: false,
      error: "binding.workflowName is required for supervised llm resolver",
    };
  }

  const resolverVariables: Readonly<Record<string, unknown>> = {
    ...(text !== undefined ? { text } : {}),
    managedWorkflowName: managedWorkflowBindingName,
    supervisorWorkflowName,
    allowedActions: [...allowedActionsForResolver],
    ...(input.activeSupervisedRunId !== undefined
      ? { activeSupervisedRunId: input.activeSupervisedRunId }
      : {}),
  };

  const output = await readResolverWorkflowNodeOutput({
    resolverWorkflowName: input.resolverWorkflowName,
    resolverNodeId: input.resolverNodeId,
    resolverVariables,
    options: input.options,
  });
  if (!output.ok) {
    return output;
  }

  const parsed = parseResolverOutputJson(output.rawJson, output.outputJsonPath);
  if (!parsed.ok) {
    const fb = input.defaultAction;
    const managedWorkflowName = managedWorkflowBindingName;
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
      error: parsed.error,
    };
  }

  // The engine writes the full adapter output to output.json; the actual node
  // decision payload is nested under the "payload" key.
  const decision = parseSupervisorChatCommandDecision(
    extractResolverPayload(parsed.parsed),
  );
  if (!decision.ok) {
    const fallback = input.defaultAction;
    const managedWorkflowName = managedWorkflowBindingName;
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

export {
  parseSupervisorDispatchProposal,
  validateSupervisorDispatchProposalAgainstContext,
  type ManagedWorkflowRunRecordLight,
  type WorkflowSupervisorDispatchContext,
} from "./supervisor-dispatch-contract";
