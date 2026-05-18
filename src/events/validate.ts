import { isJsonObject } from "../shared/json";
import { listWorkflowCatalogSources } from "../workflow/catalog";
import {
  isEventOutputDestinationEnabled,
  isEventSourceEnabled,
  loadEventConfiguration,
} from "./config";
import {
  validateBindingOutputDestinations,
  validateDestination,
} from "./validate-destinations";
import { validateTaskPlanning } from "./validate-task-planning";
import {
  eventConfigError as error,
  eventConfigWarning as warning,
  isNonEmptyString,
  isPositiveInteger,
  validateEnvName,
  validateSecretEnvName,
} from "./validation-utils";
import { validateMatrixSource } from "./validate-source-matrix";
import {
  validateChatSdkBindingCapabilities,
  validateChatSdkSource,
} from "./validate-source-chat-sdk";
import { validateScheduleRegistrationBinding } from "./validate-schedule-registration";
import { isValidCronSchedule, isValidTimeZone } from "./adapters/cron";
import {
  isValidEventHttpPath,
  resolveEventSourceHttpPath,
} from "./http-routes";
import {
  loadSupervisorProfilesFromEventRoot,
  type WorkflowSupervisorProfile,
} from "./supervisor-profiles";
import {
  EVENT_SUPERVISOR_ACTIONS,
  EVENT_SUPERVISOR_ACTION_SET,
} from "./supervisor-command-contract";
import type {
  EventBinding,
  EventConfigLoadOptions,
  EventConfigValidationIssue,
  EventConfigValidationResult,
  EventConfiguration,
  EventInputMapping,
  EventOutputDestinationConfig,
  EventSourceConfig,
} from "./types";

const SUPPORTED_SOURCE_KINDS = new Set([
  "chat-sdk",
  "cron",
  "matrix",
  "webhook",
  "s3-repository",
]);

function validateUniqueIds(
  label: string,
  entries: readonly { readonly id: string }[],
  issues: EventConfigValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push(error(`${label}.${entry.id}`, `duplicate ${label} id`));
      continue;
    }
    seen.add(entry.id);
  }
}

function validateUniqueEventHttpPaths(
  sources: readonly EventSourceConfig[],
  issues: EventConfigValidationIssue[],
): void {
  const seenByPath = new Map<string, string>();
  for (const source of sources) {
    const routePath = resolveEventSourceHttpPath(source);
    if (routePath === undefined) {
      continue;
    }
    const existingSourceId = seenByPath.get(routePath);
    if (existingSourceId !== undefined) {
      issues.push(
        error(
          `sources.${source.id}.path`,
          `event HTTP path '${routePath}' is already used by source '${existingSourceId}'`,
        ),
      );
      continue;
    }
    seenByPath.set(routePath, source.id);
  }
}

function validateTemplateValue(
  value: unknown,
  pathName: string,
  issues: EventConfigValidationIssue[],
): void {
  if (typeof value === "string") {
    const matches = value.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g);
    for (const match of matches) {
      const ref = match[1];
      if (
        ref === undefined ||
        (!ref.startsWith("event.") &&
          !ref.startsWith("source.") &&
          !ref.startsWith("binding."))
      ) {
        issues.push(
          error(pathName, `unsupported template reference '${ref ?? ""}'`),
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateTemplateValue(entry, `${pathName}[${String(index)}]`, issues);
    });
    return;
  }
  if (isJsonObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      validateTemplateValue(entry, `${pathName}.${key}`, issues);
    }
  }
}

function validateInputMapping(
  binding: EventBinding,
  issues: EventConfigValidationIssue[],
): void {
  const mapping: EventInputMapping = binding.inputMapping;
  if (mapping.mode === "template") {
    validateTemplateValue(
      mapping.template,
      `bindings.${binding.id}.inputMapping.template`,
      issues,
    );
  }
}

function validateSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (!SUPPORTED_SOURCE_KINDS.has(source.kind)) {
    issues.push(
      error(
        `sources.${source.id}.kind`,
        `unsupported source kind '${source.kind}'`,
      ),
    );
  }

  if (source.kind === "matrix") {
    validateMatrixSource(source, issues);
  }

  if (source.kind === "chat-sdk") {
    validateChatSdkSource(source, issues);
  }

  if (source.kind === "cron") {
    if (!isNonEmptyString(source["schedule"])) {
      issues.push(
        error(`sources.${source.id}.schedule`, "cron schedule is required"),
      );
    } else if (!isValidCronSchedule(source["schedule"])) {
      issues.push(
        error(
          `sources.${source.id}.schedule`,
          "cron schedule must have five valid fields",
        ),
      );
    }
    if (!isNonEmptyString(source["timezone"])) {
      issues.push(
        error(`sources.${source.id}.timezone`, "timezone is required"),
      );
    } else if (!isValidTimeZone(source["timezone"])) {
      issues.push(
        error(
          `sources.${source.id}.timezone`,
          "timezone must be a valid IANA time zone",
        ),
      );
    }
  }

  if (source.kind === "webhook") {
    if (
      !isNonEmptyString(source["path"]) ||
      !isValidEventHttpPath(source["path"])
    ) {
      issues.push(
        error(
          `sources.${source.id}.path`,
          "webhook path must start with '/' and must not contain whitespace, '?' or '#'",
        ),
      );
    }
    validateSecretEnvName(
      source["signingSecretEnv"],
      `sources.${source.id}.signingSecretEnv`,
      issues,
    );
    validateEnvName(
      source["replyEndpointEnv"],
      `sources.${source.id}.replyEndpointEnv`,
      "reply endpoint env var name",
      issues,
    );
  }

  if (source.kind === "s3-repository") {
    if (!isNonEmptyString(source["bucket"])) {
      issues.push(error(`sources.${source.id}.bucket`, "bucket is required"));
    }
    const eventReceiver = source["eventReceiver"];
    if (!isJsonObject(eventReceiver)) {
      issues.push(
        error(
          `sources.${source.id}.eventReceiver`,
          "event receiver is required",
        ),
      );
    } else {
      if (eventReceiver["mode"] === "polling") {
        issues.push(
          error(
            `sources.${source.id}.eventReceiver.mode`,
            "polling receiver mode is not supported",
          ),
        );
      }
      const receiverPath = eventReceiver["path"];
      if (
        receiverPath !== undefined &&
        (!isNonEmptyString(receiverPath) || !isValidEventHttpPath(receiverPath))
      ) {
        issues.push(
          error(
            `sources.${source.id}.eventReceiver.path`,
            "event receiver path must start with '/' and must not contain whitespace, '?' or '#'",
          ),
        );
      }
      validateSecretEnvName(
        eventReceiver["signingSecretEnv"],
        `sources.${source.id}.eventReceiver.signingSecretEnv`,
        issues,
      );
    }
    const objectAccess = source["objectAccess"];
    if (
      !isJsonObject(objectAccess) ||
      objectAccess["mode"] !== "metadata-only"
    ) {
      issues.push(
        error(
          `sources.${source.id}.objectAccess.mode`,
          "object access must explicitly be metadata-only",
        ),
      );
    }
    const rootPrefix = source["rootPrefix"];
    if (
      rootPrefix !== undefined &&
      (!isNonEmptyString(rootPrefix) ||
        rootPrefix.startsWith("/") ||
        rootPrefix.includes(".."))
    ) {
      issues.push(
        error(
          `sources.${source.id}.rootPrefix`,
          "root prefix must be a safe object-key prefix",
        ),
      );
    }
  }
}

async function listWorkflowNames(
  options: EventConfigLoadOptions,
  issues: EventConfigValidationIssue[],
): Promise<Set<string>> {
  const sources = await listWorkflowCatalogSources(options);
  if (!sources.ok) {
    issues.push(error("workflows", sources.error.message));
    return new Set();
  }
  return new Set(sources.value.map((source) => source.workflowName));
}

const SUPERVISOR_ACTION_SET = EVENT_SUPERVISOR_ACTION_SET;
const SUPERVISOR_ACTION_LIST = EVENT_SUPERVISOR_ACTIONS.join(", ");

function isSupervisorActionName(value: unknown): value is string {
  return typeof value === "string" && SUPERVISOR_ACTION_SET.has(value);
}

export function assertSupervisedBindingGraphqlPolicy(
  binding: EventBinding,
): void {
  const issues: EventConfigValidationIssue[] = [];
  validateSupervisedBinding(binding, issues);
  const firstError = issues.find((issue) => issue.severity === "error");
  if (firstError !== undefined) {
    throw new Error(`${firstError.path}: ${firstError.message}`);
  }
}

function validateSupervisedBinding(
  binding: EventBinding,
  issues: EventConfigValidationIssue[],
): void {
  const execution = binding.execution;
  if (execution?.mode !== "supervised") {
    return;
  }
  const pathPrefix = `bindings.${binding.id}.execution`;
  if (
    execution.supervisorWorkflowName !== undefined &&
    execution.supervisorWorkflowName !== null &&
    (typeof execution.supervisorWorkflowName !== "string" ||
      execution.supervisorWorkflowName.length === 0)
  ) {
    issues.push(
      error(
        `${pathPrefix}.supervisorWorkflowName`,
        "supervisorWorkflowName must be a non-empty string when set",
      ),
    );
  }
  const maxRestarts = execution.maxRestartsOnFailure;
  if (
    maxRestarts !== undefined &&
    (!Number.isInteger(maxRestarts) || maxRestarts < 0)
  ) {
    issues.push(
      error(
        `${pathPrefix}.maxRestartsOnFailure`,
        "maxRestartsOnFailure must be a non-negative integer",
      ),
    );
  }
  const control = execution.control;
  if (control?.correlationKey !== undefined) {
    if (typeof control.correlationKey !== "string") {
      issues.push(
        error(
          `${pathPrefix}.control.correlationKey`,
          "correlationKey must be a string template",
        ),
      );
    } else {
      validateTemplateValue(
        control.correlationKey,
        `${pathPrefix}.control.correlationKey`,
        issues,
      );
    }
  }
  if (
    control?.startOnFirstInput !== undefined &&
    typeof control.startOnFirstInput !== "boolean"
  ) {
    issues.push(
      error(
        `${pathPrefix}.control.startOnFirstInput`,
        "startOnFirstInput must be a boolean when set",
      ),
    );
  }
  const allow = control?.allowActions;
  if (allow !== undefined) {
    if (!Array.isArray(allow) || allow.length === 0) {
      issues.push(
        error(
          `${pathPrefix}.control.allowActions`,
          "allowActions must be a non-empty array when set",
        ),
      );
    } else {
      for (const [index, entry] of allow.entries()) {
        if (typeof entry !== "string" || !SUPERVISOR_ACTION_SET.has(entry)) {
          issues.push(
            error(
              `${pathPrefix}.control.allowActions[${String(index)}]`,
              `unknown supervisor action '${String(entry)}'`,
            ),
          );
        }
      }
    }
  }
  const intent = control?.intentMapping;
  if (intent !== undefined && !isJsonObject(intent)) {
    issues.push(
      error(
        `${pathPrefix}.control.intentMapping`,
        "intentMapping must be an object",
      ),
    );
  } else if (isJsonObject(intent)) {
    const mode = intent["mode"];
    if (
      mode !== "structured-or-command" &&
      mode !== "command-map" &&
      mode !== "structured-only" &&
      mode !== "llm-command"
    ) {
      issues.push(
        error(
          `${pathPrefix}.control.intentMapping.mode`,
          "intentMapping.mode must be structured-or-command, command-map, structured-only, or llm-command",
        ),
      );
    }
    const defaultAction = intent["defaultAction"];
    if (mode !== "llm-command") {
      if (
        defaultAction !== undefined &&
        !isSupervisorActionName(defaultAction)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.defaultAction`,
            `defaultAction must be one of ${SUPERVISOR_ACTION_LIST} when set`,
          ),
        );
      }
    }
    if (mode === "llm-command") {
      const resolverWorkflowName = intent["resolverWorkflowName"];
      if (
        typeof resolverWorkflowName !== "string" ||
        resolverWorkflowName.length === 0
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.resolverWorkflowName`,
            "llm-command intentMapping.resolverWorkflowName must be a non-empty string",
          ),
        );
      }
      const resolverNodeId = intent["resolverNodeId"];
      if (typeof resolverNodeId !== "string" || resolverNodeId.length === 0) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.resolverNodeId`,
            "llm-command intentMapping.resolverNodeId must be a non-empty string",
          ),
        );
      }
      const minConfidence = intent["minConfidence"];
      if (minConfidence !== undefined) {
        if (
          typeof minConfidence !== "number" ||
          minConfidence < 0 ||
          minConfidence > 1
        ) {
          issues.push(
            error(
              `${pathPrefix}.control.intentMapping.minConfidence`,
              "minConfidence must be a number in [0, 1] when set",
            ),
          );
        }
      }
      const llmDefaultAction = intent["defaultAction"];
      if (
        llmDefaultAction !== undefined &&
        llmDefaultAction !== "input" &&
        llmDefaultAction !== "ignore"
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.defaultAction`,
            "llm-command defaultAction must be 'input' or 'ignore' when set",
          ),
        );
      }
      const inputPath = intent["inputPath"];
      if (
        inputPath !== undefined &&
        (typeof inputPath !== "string" || inputPath.length === 0)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.inputPath`,
            "inputPath must be a non-empty dotted path when set",
          ),
        );
      }
    }
    if (mode === "command-map") {
      const commands = intent["commands"];
      if (!isJsonObject(commands)) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.commands`,
            "command-map intentMapping.commands must be an object",
          ),
        );
      } else {
        for (const [actionName, token] of Object.entries(commands)) {
          if (!isSupervisorActionName(actionName)) {
            issues.push(
              error(
                `${pathPrefix}.control.intentMapping.commands.${actionName}`,
                `unknown supervisor action '${actionName}'`,
              ),
            );
            continue;
          }
          if (typeof token === "string" && token.length > 0) {
            continue;
          }
          if (
            Array.isArray(token) &&
            token.length > 0 &&
            token.every(
              (entry) => typeof entry === "string" && entry.length > 0,
            )
          ) {
            continue;
          }
          issues.push(
            error(
              `${pathPrefix}.control.intentMapping.commands.${actionName}`,
              "command token must be a non-empty string or non-empty string array",
            ),
          );
        }
      }
      const inputPath = intent["inputPath"];
      if (
        inputPath !== undefined &&
        (typeof inputPath !== "string" || inputPath.length === 0)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.inputPath`,
            "inputPath must be a non-empty dotted path when set",
          ),
        );
      }
      const resolverWorkflowName = intent["resolverWorkflowName"];
      const resolverNodeId = intent["resolverNodeId"];
      if (
        resolverWorkflowName !== undefined &&
        (typeof resolverWorkflowName !== "string" ||
          resolverWorkflowName.length === 0)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.resolverWorkflowName`,
            "command-map resolverWorkflowName must be a non-empty string when set",
          ),
        );
      }
      if (
        resolverNodeId !== undefined &&
        (typeof resolverNodeId !== "string" || resolverNodeId.length === 0)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.resolverNodeId`,
            "command-map resolverNodeId must be a non-empty string when set",
          ),
        );
      }
      if (
        (resolverWorkflowName === undefined) !==
        (resolverNodeId === undefined)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping`,
            "command-map command-analysis fallback requires resolverWorkflowName and resolverNodeId together",
          ),
        );
      }
      const minConfidence = intent["minConfidence"];
      if (
        minConfidence !== undefined &&
        (typeof minConfidence !== "number" ||
          minConfidence < 0 ||
          minConfidence > 1)
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.minConfidence`,
            "minConfidence must be a number in [0, 1] when set",
          ),
        );
      }
      const fallbackAction = intent["fallbackAction"];
      if (
        fallbackAction !== undefined &&
        fallbackAction !== "proposal" &&
        fallbackAction !== "ignore"
      ) {
        issues.push(
          error(
            `${pathPrefix}.control.intentMapping.fallbackAction`,
            "fallbackAction must be 'proposal' or 'ignore' when set",
          ),
        );
      }
    }
  }
}

function validateSupervisorDispatchBinding(
  binding: EventBinding,
  profilesById: ReadonlyMap<string, WorkflowSupervisorProfile>,
  workflowNames: ReadonlySet<string>,
  issues: EventConfigValidationIssue[],
): void {
  const execution = binding.execution;
  if (execution?.mode !== "supervisor-dispatch") {
    return;
  }
  const pathPrefix = `bindings.${binding.id}.execution`;
  const profileIdRaw = execution.supervisorProfileId;
  if (typeof profileIdRaw !== "string" || profileIdRaw.trim().length === 0) {
    issues.push(
      error(
        `${pathPrefix}.supervisorProfileId`,
        "supervisorProfileId is required when execution.mode is supervisor-dispatch",
      ),
    );
    return;
  }
  const profileId = profileIdRaw.trim();
  const profile = profilesById.get(profileId);
  if (profile === undefined) {
    issues.push(
      error(
        `${pathPrefix}.supervisorProfileId`,
        `unknown supervisor profile '${profileId}' (expected JSON under supervisors/)`,
      ),
    );
    return;
  }

  const overrideSw = execution.supervisorWorkflowName;
  if (overrideSw !== undefined && overrideSw !== null) {
    if (typeof overrideSw !== "string" || overrideSw.length === 0) {
      issues.push(
        error(
          `${pathPrefix}.supervisorWorkflowName`,
          "supervisorWorkflowName must be a non-empty string when set",
        ),
      );
    } else if (overrideSw.trim() !== profile.supervisorWorkflowName) {
      issues.push(
        error(
          `${pathPrefix}.supervisorWorkflowName`,
          `must match profile supervisorWorkflowName '${profile.supervisorWorkflowName}'`,
        ),
      );
    }
  }

  const bwn = binding.workflowName;
  if (bwn !== undefined && bwn.trim().length > 0) {
    if (bwn.trim() !== profile.supervisorWorkflowName) {
      issues.push(
        error(
          `bindings.${binding.id}.workflowName`,
          `for supervisor-dispatch, workflowName must be omitted or equal the profile supervisorWorkflowName '${profile.supervisorWorkflowName}'`,
        ),
      );
    } else if (!workflowNames.has(bwn.trim())) {
      issues.push(
        error(
          `bindings.${binding.id}.workflowName`,
          `unknown workflow '${bwn.trim()}'`,
        ),
      );
    }
  }
}

function validateMailboxBridge(
  binding: EventBinding,
  issues: EventConfigValidationIssue[],
): void {
  const mb = binding.mailboxBridge;
  if (mb === undefined) {
    return;
  }
  const base = `bindings.${binding.id}.mailboxBridge`;
  if (!isJsonObject(mb as unknown)) {
    issues.push(error(base, "mailboxBridge must be an object when set"));
    return;
  }
  const mode = binding.execution?.mode;
  const supervisedLike =
    mode === "supervised" || mode === "supervisor-dispatch";
  if (mb.input?.consumer === "supervisor" && !supervisedLike) {
    issues.push(
      error(
        `${base}.input.consumer`,
        'mailboxBridge.input.consumer "supervisor" requires execution.mode "supervised" or "supervisor-dispatch"',
      ),
    );
  }
  if (mb.input?.consumer === "direct-workflow" && supervisedLike) {
    issues.push(
      error(
        `${base}.input.consumer`,
        'mailboxBridge.input.consumer "direct-workflow" cannot be used with execution.mode "supervised" or "supervisor-dispatch"',
      ),
    );
  }
  const replyMode = mb.output?.reply?.mode;
  if (
    replyMode !== undefined &&
    (typeof replyMode !== "string" ||
      (replyMode !== "none" && replyMode !== "final"))
  ) {
    issues.push(
      error(
        `${base}.output.reply.mode`,
        `invalid reply mode '${String(replyMode)}' (expected none or final)`,
      ),
    );
  }
  const progressMode = mb.output?.progress?.mode;
  if (
    progressMode !== undefined &&
    (typeof progressMode !== "string" ||
      (progressMode !== "none" && progressMode !== "status-only"))
  ) {
    issues.push(
      error(
        `${base}.output.progress.mode`,
        `invalid progress mode '${String(progressMode)}' (expected none or status-only)`,
      ),
    );
  }
  const controlMode = mb.output?.control?.mode;
  if (
    controlMode !== undefined &&
    (typeof controlMode !== "string" ||
      (controlMode !== "none" && controlMode !== "status-only"))
  ) {
    issues.push(
      error(
        `${base}.output.control.mode`,
        `invalid control mode '${String(controlMode)}' (expected none or status-only)`,
      ),
    );
  }
}

function validateBinding(
  binding: EventBinding,
  sourcesById: ReadonlyMap<string, EventSourceConfig>,
  destinationsById: ReadonlyMap<string, EventOutputDestinationConfig>,
  workflowNames: ReadonlySet<string>,
  profilesById: ReadonlyMap<string, WorkflowSupervisorProfile>,
  issues: EventConfigValidationIssue[],
): void {
  const source = sourcesById.get(binding.sourceId);
  if (source === undefined) {
    issues.push(
      error(
        `bindings.${binding.id}.sourceId`,
        `unknown source '${binding.sourceId}'`,
      ),
    );
  }
  validateBindingOutputDestinations(
    binding.id,
    binding.outputDestinations,
    destinationsById,
    issues,
  );
  const isDispatch =
    binding.execution?.mode === "supervisor-dispatch" ||
    binding.execution?.mode === "schedule-registration";
  const workflowName = binding.workflowName?.trim();
  if (workflowName !== undefined && workflowName.length > 0) {
    if (!workflowNames.has(workflowName)) {
      issues.push(
        error(
          `bindings.${binding.id}.workflowName`,
          `unknown workflow '${workflowName}'`,
        ),
      );
    }
  } else if (!isDispatch) {
    issues.push(
      error(
        `bindings.${binding.id}.workflowName`,
        "workflowName is required for non-dispatcher bindings",
      ),
    );
  }
  validateInputMapping(binding, issues);
  const maxConcurrentPerKey = binding.execution?.maxConcurrentPerKey;
  if (
    maxConcurrentPerKey !== undefined &&
    !isPositiveInteger(maxConcurrentPerKey)
  ) {
    issues.push(
      error(
        `bindings.${binding.id}.execution.maxConcurrentPerKey`,
        "maxConcurrentPerKey must be at least 1",
      ),
    );
  }
  const isHttpBackedSource =
    source === undefined
      ? false
      : resolveEventSourceHttpPath(source) !== undefined;
  if (
    isHttpBackedSource &&
    binding.execution?.async === false &&
    binding.execution.allowUnsafeSyncWebhook !== true
  ) {
    issues.push(
      error(
        `bindings.${binding.id}.execution.async`,
        "HTTP-backed event bindings must be async unless explicitly allowed",
      ),
    );
  }
  if (binding.enabled === false) {
    issues.push(warning(`bindings.${binding.id}`, "binding is disabled"));
  }
  validateSupervisedBinding(binding, issues);
  validateSupervisorDispatchBinding(
    binding,
    profilesById,
    workflowNames,
    issues,
  );
  validateScheduleRegistrationBinding(binding, workflowNames, issues);
  validateMailboxBridge(binding, issues);
  validateChatSdkBindingCapabilities({ binding, source, issues });
  validateTaskPlanning(binding, issues);
}

export async function validateEventConfiguration(
  configuration: EventConfiguration,
  options: EventConfigLoadOptions = {},
): Promise<EventConfigValidationResult> {
  const issues: EventConfigValidationIssue[] = [];
  validateUniqueIds("sources", configuration.sources, issues);
  validateUniqueIds("destinations", configuration.destinations, issues);
  validateUniqueIds("bindings", configuration.bindings, issues);

  const sourcesById = new Map(
    configuration.sources.map((source) => [source.id, source] as const),
  );
  for (const source of configuration.sources) {
    validateSource(source, issues);
    if (!isEventSourceEnabled(source)) {
      issues.push(warning(`sources.${source.id}`, "source is disabled"));
    }
  }
  for (const destination of configuration.destinations) {
    validateDestination(destination, sourcesById, issues);
    if (!isEventOutputDestinationEnabled(destination)) {
      issues.push(
        warning(`destinations.${destination.id}`, "destination is disabled"),
      );
    }
  }
  validateUniqueEventHttpPaths(
    configuration.sources.filter(isEventSourceEnabled),
    issues,
  );

  const destinationsById = new Map(
    configuration.destinations.map(
      (destination) => [destination.id, destination] as const,
    ),
  );
  const workflowNames = await listWorkflowNames(options, issues);
  const supervisorProfileLoad = await loadSupervisorProfilesFromEventRoot(
    configuration.eventRoot,
    workflowNames,
  );
  for (const issue of supervisorProfileLoad.issues) {
    issues.push(error(issue.path, issue.message));
  }
  const profilesById = supervisorProfileLoad.profilesById;
  for (const binding of configuration.bindings) {
    validateBinding(
      binding,
      sourcesById,
      destinationsById,
      workflowNames,
      profilesById,
      issues,
    );
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export async function loadAndValidateEventConfiguration(
  options: EventConfigLoadOptions = {},
): Promise<
  EventConfigValidationResult & { readonly configuration: EventConfiguration }
> {
  const configuration = await loadEventConfiguration(options);
  const result = await validateEventConfiguration(configuration, options);
  return {
    ...result,
    configuration,
  };
}
