import { isJsonObject } from "../shared/json";
import { listWorkflowCatalogSources } from "../workflow/catalog";
import { isEventSourceEnabled, loadEventConfiguration } from "./config";
import { isValidCronSchedule, isValidTimeZone } from "./adapters/cron";
import {
  isValidEventHttpPath,
  resolveEventSourceHttpPath,
} from "./http-routes";
import type {
  EventBinding,
  EventConfigLoadOptions,
  EventConfigValidationIssue,
  EventConfigValidationResult,
  EventConfiguration,
  EventInputMapping,
  EventSourceConfig,
} from "./types";

const SUPPORTED_SOURCE_KINDS = new Set(["cron", "webhook", "s3-repository"]);
const SAFE_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

function error(pathName: string, message: string): EventConfigValidationIssue {
  return { severity: "error", path: pathName, message };
}

function warning(
  pathName: string,
  message: string,
): EventConfigValidationIssue {
  return { severity: "warning", path: pathName, message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

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
    value.forEach((entry, index) =>
      validateTemplateValue(entry, `${pathName}[${String(index)}]`, issues),
    );
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

function validateEnvName(
  value: unknown,
  pathName: string,
  label: string,
  issues: EventConfigValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  if (!isNonEmptyString(value) || !SAFE_ENV_NAME_PATTERN.test(value)) {
    issues.push(error(pathName, `${label} must be an uppercase env name`));
  }
}

function validateSecretEnvName(
  value: unknown,
  pathName: string,
  issues: EventConfigValidationIssue[],
): void {
  validateEnvName(value, pathName, "secret env var name", issues);
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

const SUPERVISOR_ACTION_SET = new Set<string>([
  "start",
  "stop",
  "restart",
  "status",
  "input",
]);

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
            "defaultAction must be one of start, stop, restart, status, or input when set",
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
          if (typeof token !== "string" || token.length === 0) {
            issues.push(
              error(
                `${pathPrefix}.control.intentMapping.commands.${actionName}`,
                "command token must be a non-empty string",
              ),
            );
          }
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
    }
  }
}

function validateBinding(
  binding: EventBinding,
  sourcesById: ReadonlyMap<string, EventSourceConfig>,
  workflowNames: ReadonlySet<string>,
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
  if (!workflowNames.has(binding.workflowName)) {
    issues.push(
      error(
        `bindings.${binding.id}.workflowName`,
        `unknown workflow '${binding.workflowName}'`,
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
}

export async function validateEventConfiguration(
  configuration: EventConfiguration,
  options: EventConfigLoadOptions = {},
): Promise<EventConfigValidationResult> {
  const issues: EventConfigValidationIssue[] = [];
  validateUniqueIds("sources", configuration.sources, issues);
  validateUniqueIds("bindings", configuration.bindings, issues);

  for (const source of configuration.sources) {
    validateSource(source, issues);
    if (!isEventSourceEnabled(source)) {
      issues.push(warning(`sources.${source.id}`, "source is disabled"));
    }
  }
  validateUniqueEventHttpPaths(
    configuration.sources.filter(isEventSourceEnabled),
    issues,
  );

  const sourcesById = new Map(
    configuration.sources.map((source) => [source.id, source] as const),
  );
  const workflowNames = await listWorkflowNames(options, issues);
  for (const binding of configuration.bindings) {
    validateBinding(binding, sourcesById, workflowNames, issues);
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
