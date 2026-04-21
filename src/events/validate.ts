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
        (!ref.startsWith("event.") && !ref.startsWith("source."))
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
