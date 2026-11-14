import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../shared/json";

export type ManagedWorkflowConcurrencyMode =
  | "single-active"
  | "single-selected"
  | "multiple-active";

export interface ManagedWorkflowConcurrencyPolicy {
  readonly mode: ManagedWorkflowConcurrencyMode;
  readonly requiresAliasForParallelRuns?: boolean;
}

export type ManagedWorkflowTerminalInputBehavior =
  | "clarify"
  | "restart"
  | "fork";

export interface ManagedWorkflowLifecyclePolicy {
  readonly stopOnSwitch?: boolean;
  readonly startOnSwitch?: boolean;
  readonly terminalInputBehavior?: ManagedWorkflowTerminalInputBehavior;
}

export type ManagedWorkflowAction =
  | "start"
  | "submit-input"
  | "status"
  | "stop"
  | "restart"
  | "switch-workflow";

export interface ManagedWorkflowDefinition {
  readonly key: string;
  readonly workflowName: string;
  readonly displayName?: string;
  readonly aliases?: readonly string[];
  readonly description?: string;
  readonly dispatchExamples?: readonly string[];
  readonly inputContract?: Readonly<Record<string, unknown>>;
  readonly allowedActions?: readonly ManagedWorkflowAction[];
  readonly concurrency?: ManagedWorkflowConcurrencyPolicy;
  readonly lifecycle?: ManagedWorkflowLifecyclePolicy;
}

export type SupervisorDirectAnswerDecisionKind =
  | "answer-directly"
  | "status"
  | "clarify";

export interface SupervisorDirectAnswerPolicy {
  readonly enabled: boolean;
  readonly allowedDecisionKinds?: readonly SupervisorDirectAnswerDecisionKind[];
}

export interface SupervisorConversationPolicy {
  readonly maxActiveManagedRunsPerConversation?: number;
  readonly allowDestructiveFanout?: boolean;
  readonly allowStatusFanout?: boolean;
  readonly llmDecisionMinConfidence?: number;
  readonly defaultActionWhenUnclear?: "clarify" | "no-op";
}

export interface WorkflowSupervisorProfile {
  readonly supervisorProfileId: string;
  readonly profileRevision: string;
  readonly supervisorWorkflowName: string;
  readonly description?: string;
  readonly managedWorkflows: readonly ManagedWorkflowDefinition[];
  readonly conversationPolicy?: SupervisorConversationPolicy;
  readonly directAnswerPolicy?: SupervisorDirectAnswerPolicy;
}

const DEFAULT_MANAGED_ACTIONS: readonly ManagedWorkflowAction[] = [
  "start",
  "submit-input",
  "status",
  "stop",
  "restart",
];

const MANAGED_ACTION_SET = new Set<string>([
  "start",
  "submit-input",
  "status",
  "stop",
  "restart",
  "switch-workflow",
]);

const CONCURRENCY_MODES = new Set<string>([
  "single-active",
  "single-selected",
  "multiple-active",
]);

const TERMINAL_BEHAVIORS = new Set<string>(["clarify", "restart", "fork"]);

const DIRECT_ANSWER_KINDS = new Set<string>([
  "answer-directly",
  "status",
  "clarify",
]);

function readNonEmptyString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readOptionalNumber(
  input: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function readOptionalBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Structural parse of a supervisor profile JSON object.
 * Does not check workflow catalog membership (use {@link validateSupervisorProfileAgainstCatalog}).
 */
export function parseWorkflowSupervisorProfile(
  value: unknown,
):
  | { readonly ok: true; readonly value: WorkflowSupervisorProfile }
  | { readonly ok: false; readonly error: string } {
  if (!isJsonObject(value)) {
    return { ok: false, error: "profile must be a JSON object" };
  }

  const supervisorProfileId = readNonEmptyString(value, "supervisorProfileId");
  if (supervisorProfileId === undefined) {
    return { ok: false, error: "supervisorProfileId must be a non-empty string" };
  }

  const profileRevision = readNonEmptyString(value, "profileRevision");
  if (profileRevision === undefined) {
    return { ok: false, error: "profileRevision must be a non-empty string" };
  }

  const supervisorWorkflowName = readNonEmptyString(
    value,
    "supervisorWorkflowName",
  );
  if (supervisorWorkflowName === undefined) {
    return {
      ok: false,
      error: "supervisorWorkflowName must be a non-empty string",
    };
  }

  const description = readNonEmptyString(value, "description");
  const managedRaw = value["managedWorkflows"];
  if (!Array.isArray(managedRaw)) {
    return { ok: false, error: "managedWorkflows must be an array" };
  }

  const managedWorkflows: ManagedWorkflowDefinition[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < managedRaw.length; i += 1) {
    const entry = managedRaw[i];
    const label = `managedWorkflows[${String(i)}]`;
    if (!isJsonObject(entry)) {
      return { ok: false, error: `${label} must be an object` };
    }
    const key = readNonEmptyString(entry, "key");
    if (key === undefined) {
      return { ok: false, error: `${label}.key must be a non-empty string` };
    }
    if (seenKeys.has(key)) {
      return { ok: false, error: `duplicate managed workflow key '${key}'` };
    }
    seenKeys.add(key);

    const workflowName = readNonEmptyString(entry, "workflowName");
    if (workflowName === undefined) {
      return {
        ok: false,
        error: `${label}.workflowName must be a non-empty string`,
      };
    }

    const displayName = readNonEmptyString(entry, "displayName");
    const desc = readNonEmptyString(entry, "description");

    const aliasesRaw = entry["aliases"];
    let aliases: readonly string[] | undefined;
    if (aliasesRaw !== undefined) {
      if (!Array.isArray(aliasesRaw) || aliasesRaw.length === 0) {
        return {
          ok: false,
          error: `${label}.aliases must be a non-empty string array when set`,
        };
      }
      const normalized: string[] = [];
      for (const [j, a] of aliasesRaw.entries()) {
        if (typeof a !== "string" || a.trim().length === 0) {
          return {
            ok: false,
            error: `${label}.aliases[${String(j)}] must be a non-empty string`,
          };
        }
        normalized.push(a.trim());
      }
      aliases = normalized;
    }

    const examplesRaw = entry["dispatchExamples"];
    let dispatchExamples: readonly string[] | undefined;
    if (examplesRaw !== undefined) {
      if (!Array.isArray(examplesRaw)) {
        return {
          ok: false,
          error: `${label}.dispatchExamples must be an array when set`,
        };
      }
      const ex: string[] = [];
      for (const [j, e] of examplesRaw.entries()) {
        if (typeof e !== "string") {
          return {
            ok: false,
            error: `${label}.dispatchExamples[${String(j)}] must be a string`,
          };
        }
        ex.push(e);
      }
      dispatchExamples = ex;
    }

    const inputContract = entry["inputContract"];
    if (
      inputContract !== undefined &&
      (!isJsonObject(inputContract) || Array.isArray(inputContract))
    ) {
      return {
        ok: false,
        error: `${label}.inputContract must be an object when set`,
      };
    }

    const allowedRaw = entry["allowedActions"];
    let allowedActions: readonly ManagedWorkflowAction[] | undefined;
    if (allowedRaw !== undefined) {
      if (!Array.isArray(allowedRaw) || allowedRaw.length === 0) {
        return {
          ok: false,
          error: `${label}.allowedActions must be a non-empty array when set`,
        };
      }
      const actions: ManagedWorkflowAction[] = [];
      for (const [j, a] of allowedRaw.entries()) {
        if (typeof a !== "string" || !MANAGED_ACTION_SET.has(a)) {
          return {
            ok: false,
            error: `${label}.allowedActions[${String(j)}] is not a supported action`,
          };
        }
        actions.push(a as ManagedWorkflowAction);
      }
      allowedActions = actions;
    }

    let concurrency: ManagedWorkflowConcurrencyPolicy | undefined;
    const concRaw = entry["concurrency"];
    if (concRaw !== undefined) {
      if (!isJsonObject(concRaw)) {
        return {
          ok: false,
          error: `${label}.concurrency must be an object when set`,
        };
      }
      const mode = concRaw["mode"];
      if (typeof mode !== "string" || !CONCURRENCY_MODES.has(mode)) {
        return {
          ok: false,
          error: `${label}.concurrency.mode must be single-active, single-selected, or multiple-active`,
        };
      }
      const requiresAlias = readOptionalBoolean(
        concRaw,
        "requiresAliasForParallelRuns",
      );
      concurrency = {
        mode: mode as ManagedWorkflowConcurrencyMode,
        ...(requiresAlias === undefined ? {} : { requiresAliasForParallelRuns: requiresAlias }),
      };
    }

    let lifecycle: ManagedWorkflowLifecyclePolicy | undefined;
    const lifeRaw = entry["lifecycle"];
    if (lifeRaw !== undefined) {
      if (!isJsonObject(lifeRaw)) {
        return {
          ok: false,
          error: `${label}.lifecycle must be an object when set`,
        };
      }
      const terminalInputBehavior = lifeRaw["terminalInputBehavior"];
      if (
        terminalInputBehavior !== undefined &&
        (typeof terminalInputBehavior !== "string" ||
          !TERMINAL_BEHAVIORS.has(terminalInputBehavior))
      ) {
        return {
          ok: false,
          error: `${label}.lifecycle.terminalInputBehavior must be clarify, restart, or fork`,
        };
      }
      const stopOnSwitch = readOptionalBoolean(lifeRaw, "stopOnSwitch");
      const startOnSwitch = readOptionalBoolean(lifeRaw, "startOnSwitch");
      lifecycle = {
        ...(terminalInputBehavior === undefined
          ? {}
          : {
              terminalInputBehavior:
                terminalInputBehavior as ManagedWorkflowTerminalInputBehavior,
            }),
        ...(stopOnSwitch === undefined ? {} : { stopOnSwitch }),
        ...(startOnSwitch === undefined ? {} : { startOnSwitch }),
      };
    }

    managedWorkflows.push({
      key,
      workflowName,
      ...(displayName === undefined ? {} : { displayName }),
      ...(desc === undefined ? {} : { description: desc }),
      ...(aliases === undefined ? {} : { aliases }),
      ...(dispatchExamples === undefined ? {} : { dispatchExamples }),
      ...(inputContract === undefined
        ? {}
        : { inputContract: inputContract as Readonly<Record<string, unknown>> }),
      ...(allowedActions === undefined ? {} : { allowedActions }),
      ...(concurrency === undefined ? {} : { concurrency }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
    });
  }

  let directAnswerPolicy: SupervisorDirectAnswerPolicy | undefined;
  const daRaw = value["directAnswerPolicy"];
  if (daRaw !== undefined) {
    if (!isJsonObject(daRaw)) {
      return { ok: false, error: "directAnswerPolicy must be an object when set" };
    }
    const enabled = daRaw["enabled"];
    if (typeof enabled !== "boolean") {
      return {
        ok: false,
        error: "directAnswerPolicy.enabled must be a boolean",
      };
    }
    const kindsRaw = daRaw["allowedDecisionKinds"];
    let allowedDecisionKinds:
      | readonly SupervisorDirectAnswerDecisionKind[]
      | undefined;
    if (kindsRaw !== undefined) {
      if (!Array.isArray(kindsRaw)) {
        return {
          ok: false,
          error: "directAnswerPolicy.allowedDecisionKinds must be an array when set",
        };
      }
      const kinds: SupervisorDirectAnswerDecisionKind[] = [];
      for (const [j, k] of kindsRaw.entries()) {
        if (typeof k !== "string" || !DIRECT_ANSWER_KINDS.has(k)) {
          return {
            ok: false,
            error: `directAnswerPolicy.allowedDecisionKinds[${String(j)}] is invalid`,
          };
        }
        kinds.push(k as SupervisorDirectAnswerDecisionKind);
      }
      allowedDecisionKinds = kinds;
    }
    directAnswerPolicy = {
      enabled,
      ...(allowedDecisionKinds === undefined ? {} : { allowedDecisionKinds }),
    };
  }

  let conversationPolicy: SupervisorConversationPolicy | undefined;
  const convRaw = value["conversationPolicy"];
  if (convRaw !== undefined) {
    if (!isJsonObject(convRaw)) {
      return {
        ok: false,
        error: "conversationPolicy must be an object when set",
      };
    }
    const maxRuns = readOptionalNumber(convRaw, "maxActiveManagedRunsPerConversation");
    if (
      maxRuns !== undefined &&
      (!Number.isInteger(maxRuns) || maxRuns < 1)
    ) {
      return {
        ok: false,
        error:
          "conversationPolicy.maxActiveManagedRunsPerConversation must be a positive integer",
      };
    }
    const minConf = readOptionalNumber(convRaw, "llmDecisionMinConfidence");
    if (
      minConf !== undefined &&
      (minConf < 0 || minConf > 1 || !Number.isFinite(minConf))
    ) {
      return {
        ok: false,
        error:
          "conversationPolicy.llmDecisionMinConfidence must be between 0 and 1",
      };
    }
    const defaultAction = convRaw["defaultActionWhenUnclear"];
    if (
      defaultAction !== undefined &&
      defaultAction !== "clarify" &&
      defaultAction !== "no-op"
    ) {
      return {
        ok: false,
        error:
          "conversationPolicy.defaultActionWhenUnclear must be clarify or no-op",
      };
    }
    const allowDestructiveFanout = readOptionalBoolean(
      convRaw,
      "allowDestructiveFanout",
    );
    const allowStatusFanout = readOptionalBoolean(convRaw, "allowStatusFanout");
    conversationPolicy = {
      ...(maxRuns === undefined ? {} : { maxActiveManagedRunsPerConversation: maxRuns }),
      ...(minConf === undefined ? {} : { llmDecisionMinConfidence: minConf }),
      ...(defaultAction === undefined
        ? {}
        : {
            defaultActionWhenUnclear: defaultAction as "clarify" | "no-op",
          }),
      ...(allowDestructiveFanout === undefined
        ? {}
        : { allowDestructiveFanout }),
      ...(allowStatusFanout === undefined ? {} : { allowStatusFanout }),
    };
  }

  const profile: WorkflowSupervisorProfile = {
    supervisorProfileId,
    profileRevision,
    supervisorWorkflowName,
    ...(description === undefined ? {} : { description }),
    managedWorkflows,
    ...(conversationPolicy === undefined ? {} : { conversationPolicy }),
    ...(directAnswerPolicy === undefined ? {} : { directAnswerPolicy }),
  };

  const semantic = validateSupervisorProfileSemantics(profile);
  if (!semantic.ok) {
    return semantic;
  }

  return { ok: true, value: profile };
}

function validateSupervisorProfileSemantics(
  profile: WorkflowSupervisorProfile,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string } {
  const direct = profile.directAnswerPolicy;
  const hasManaged = profile.managedWorkflows.length > 0;
  if (!hasManaged) {
    if (direct === undefined || !direct.enabled) {
      return {
        ok: false,
        error:
          "managedWorkflows is empty: enable directAnswerPolicy.enabled or add at least one managed workflow",
      };
    }
  }

  if (direct !== undefined && !direct.enabled && direct.allowedDecisionKinds !== undefined) {
    if (direct.allowedDecisionKinds.length > 0) {
      return {
        ok: false,
        error:
          "directAnswerPolicy.allowedDecisionKinds must be empty or omitted when directAnswerPolicy.enabled is false",
      };
    }
  }

  for (const mw of profile.managedWorkflows) {
    const conc = mw.concurrency;
    if (conc?.mode === "multiple-active" && conc.requiresAliasForParallelRuns !== true) {
      return {
        ok: false,
        error: `managed workflow '${mw.key}': multiple-active concurrency should set requiresAliasForParallelRuns=true`,
      };
    }
    const life = mw.lifecycle;
    if (
      life?.stopOnSwitch === true &&
      life?.startOnSwitch === true
    ) {
      return {
        ok: false,
        error: `managed workflow '${mw.key}': lifecycle.stopOnSwitch and startOnSwitch cannot both be true`,
      };
    }
  }

  return { ok: true };
}

/**
 * Ensures supervisor and managed workflow names exist in the workflow catalog.
 */
export function validateSupervisorProfileAgainstCatalog(
  profile: WorkflowSupervisorProfile,
  workflowNames: ReadonlySet<string>,
): readonly string[] {
  const errors: string[] = [];
  if (!workflowNames.has(profile.supervisorWorkflowName)) {
    errors.push(
      `supervisorWorkflowName '${profile.supervisorWorkflowName}' is not in the workflow catalog`,
    );
  }
  for (const mw of profile.managedWorkflows) {
    if (!workflowNames.has(mw.workflowName)) {
      errors.push(
        `managed workflow '${mw.key}' references unknown workflowName '${mw.workflowName}'`,
      );
    }
  }
  return errors;
}

export interface SupervisorProfileLoadIssue {
  readonly path: string;
  readonly message: string;
}

export interface SupervisorProfileLoadResult {
  readonly profilesById: ReadonlyMap<string, WorkflowSupervisorProfile>;
  readonly issues: readonly SupervisorProfileLoadIssue[];
}

/**
 * Loads `*.json` supervisor profiles from `<eventRoot>/supervisors/`.
 */
export async function loadSupervisorProfilesFromEventRoot(
  eventRoot: string,
  workflowNames: ReadonlySet<string>,
): Promise<SupervisorProfileLoadResult> {
  const dir = path.join(eventRoot, "supervisors");
  let files: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { profilesById: new Map(), issues: [] };
    }
    throw error;
  }

  const issues: SupervisorProfileLoadIssue[] = [];
  const profilesById = new Map<string, WorkflowSupervisorProfile>();

  for (const name of files) {
    const filePath = path.join(dir, name);
    const label = `supervisors/${name}`;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    } catch (e) {
      issues.push({
        path: label,
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const parsed = parseWorkflowSupervisorProfile(raw);
    if (!parsed.ok) {
      issues.push({ path: label, message: parsed.error });
      continue;
    }
    const catalogErrors = validateSupervisorProfileAgainstCatalog(
      parsed.value,
      workflowNames,
    );
    for (const msg of catalogErrors) {
      issues.push({ path: label, message: msg });
    }
    if (catalogErrors.length > 0) {
      continue;
    }
    const id = parsed.value.supervisorProfileId;
    if (profilesById.has(id)) {
      issues.push({
        path: label,
        message: `duplicate supervisorProfileId '${id}'`,
      });
      continue;
    }
    profilesById.set(id, parsed.value);
  }

  return { profilesById, issues };
}

export function resolveManagedWorkflowDefaultActions(
  mw: ManagedWorkflowDefinition,
): readonly ManagedWorkflowAction[] {
  return mw.allowedActions ?? DEFAULT_MANAGED_ACTIONS;
}
