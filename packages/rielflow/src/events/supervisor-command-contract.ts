import { isJsonObject } from "../shared/json";
import type { EventSupervisorAction } from "./types";

export type SupervisorChatDecisionAction =
  | "ignore"
  | "start"
  | "status"
  | "progress"
  | "inbox"
  | "read"
  | "logs"
  | "export"
  | "stop"
  | "cancel"
  | "restart"
  | "rerun"
  | "input"
  | "submit"
  | "resume";

export const EVENT_SUPERVISOR_ACTIONS: readonly EventSupervisorAction[] = [
  "start",
  "status",
  "progress",
  "inbox",
  "read",
  "logs",
  "export",
  "stop",
  "cancel",
  "restart",
  "rerun",
  "input",
  "submit",
  "resume",
];

export const EVENT_SUPERVISOR_ACTION_SET: ReadonlySet<string> = new Set(
  EVENT_SUPERVISOR_ACTIONS,
);

export const DEFAULT_EVENT_SUPERVISOR_COMMANDS: Readonly<
  Record<EventSupervisorAction, readonly string[]>
> = {
  start: ["start"],
  status: ["status"],
  progress: ["progress"],
  inbox: ["inbox"],
  read: ["read"],
  logs: ["logs"],
  export: ["export"],
  stop: ["stop"],
  cancel: ["cancel"],
  restart: ["restart"],
  rerun: ["rerun"],
  input: ["input"],
  submit: ["submit"],
  resume: ["resume"],
};

export interface ParsedSupervisorCommand {
  readonly action: EventSupervisorAction;
  readonly args: readonly string[];
  readonly parserMode: "deterministic-token";
}

export interface SupervisorCommandAnalysisRequest {
  readonly text: string;
  readonly reason: "empty" | "unknown-first-token";
  readonly configuredCommands: Readonly<Record<string, readonly string[]>>;
}

export type SupervisorCommandParseResult =
  | {
      readonly outcome: "command";
      readonly command: ParsedSupervisorCommand;
    }
  | {
      readonly outcome: "command-analysis";
      readonly request: SupervisorCommandAnalysisRequest;
    };

export interface SupervisorChatCommandDecision {
  readonly action: SupervisorChatDecisionAction;
  readonly managedWorkflowName: string;
  readonly confidence: number;
  readonly reason: string;
  readonly commandText?: string;
  readonly runtimeVariables?: Readonly<Record<string, unknown>>;
}

const DECISION_ACTIONS = new Set<string>([
  "ignore",
  ...EVENT_SUPERVISOR_ACTIONS,
]);

function normalizeConfiguredCommandMap(
  configured: Readonly<
    Partial<Record<EventSupervisorAction, string | readonly string[]>>
  >,
): Readonly<Record<string, readonly string[]>> {
  const out: Partial<Record<EventSupervisorAction, readonly string[]>> = {};
  for (const action of EVENT_SUPERVISOR_ACTIONS) {
    const raw = configured[action] ?? DEFAULT_EVENT_SUPERVISOR_COMMANDS[action];
    if (typeof raw === "string") {
      out[action] = raw.length === 0 ? [] : [raw];
      continue;
    }
    out[action] = raw.filter((token) => token.length > 0);
  }
  return out as Readonly<Record<string, readonly string[]>>;
}

function tokenizeSupervisorText(text: string): readonly string[] {
  return text.split(/[ \t]+/).filter((token) => token.length > 0);
}

export function parseSupervisorCommandText(input: {
  readonly text: string;
  readonly commands?: Readonly<
    Partial<Record<EventSupervisorAction, string | readonly string[]>>
  >;
}): SupervisorCommandParseResult {
  const configuredCommands = normalizeConfiguredCommandMap(
    input.commands ?? {},
  );
  const tokens = tokenizeSupervisorText(input.text);
  const first = tokens[0];
  if (first === undefined) {
    return {
      outcome: "command-analysis",
      request: {
        text: input.text,
        reason: "empty",
        configuredCommands,
      },
    };
  }
  for (const action of EVENT_SUPERVISOR_ACTIONS) {
    const commandTokens = configuredCommands[action] ?? [];
    if (commandTokens.includes(first)) {
      return {
        outcome: "command",
        command: {
          action,
          args: tokens.slice(1),
          parserMode: "deterministic-token",
        },
      };
    }
  }
  return {
    outcome: "command-analysis",
    request: {
      text: input.text,
      reason: "unknown-first-token",
      configuredCommands,
    },
  };
}

function isSupervisorChatDecisionAction(
  value: unknown,
): value is SupervisorChatDecisionAction {
  return typeof value === "string" && DECISION_ACTIONS.has(value);
}

/**
 * Strict structural parse of a supervisor chat command decision from an unknown JSON value.
 * Returns ok with the validated decision, or ok=false with an error message.
 *
 * Multi-workflow dispatcher proposals use {@link parseSupervisorDispatchProposal} in
 * `supervisor-dispatch-contract.ts`.
 */
export function parseSupervisorChatCommandDecision(
  value: unknown,
):
  | { readonly ok: true; readonly value: SupervisorChatCommandDecision }
  | { readonly ok: false; readonly error: string } {
  if (!isJsonObject(value)) {
    return { ok: false, error: "decision must be a JSON object" };
  }

  const action = value["action"];
  if (!isSupervisorChatDecisionAction(action)) {
    return {
      ok: false,
      error: `action must be one of: ${[...DECISION_ACTIONS].join(", ")}; got ${JSON.stringify(action)}`,
    };
  }

  const managedWorkflowName = value["managedWorkflowName"];
  if (
    typeof managedWorkflowName !== "string" ||
    managedWorkflowName.trim().length === 0
  ) {
    return {
      ok: false,
      error: "managedWorkflowName must be a non-empty string",
    };
  }

  const confidence = value["confidence"];
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return { ok: false, error: "confidence must be a finite number" };
  }

  const reason = value["reason"];
  if (typeof reason !== "string") {
    return { ok: false, error: "reason must be a string" };
  }

  const commandText = value["commandText"];
  if (commandText !== undefined && typeof commandText !== "string") {
    return { ok: false, error: "commandText must be a string when present" };
  }

  const runtimeVariables = value["runtimeVariables"];
  if (runtimeVariables !== undefined && !isJsonObject(runtimeVariables)) {
    return {
      ok: false,
      error: "runtimeVariables must be an object when present",
    };
  }

  return {
    ok: true,
    value: {
      action,
      managedWorkflowName: managedWorkflowName.trim(),
      confidence,
      reason,
      ...(commandText === undefined ? {} : { commandText }),
      ...(runtimeVariables === undefined
        ? {}
        : {
            runtimeVariables: runtimeVariables as Readonly<
              Record<string, unknown>
            >,
          }),
    },
  };
}
