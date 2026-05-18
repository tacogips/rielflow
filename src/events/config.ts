import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../shared/json";
import { resolveEffectiveRoots } from "../workflow/paths";
import type {
  EventBinding,
  EventConfigLoadOptions,
  EventConfiguration,
  EventInputMapping,
  EventOutputDestinationConfig,
  EventSourceConfig,
  EventWorkflowExecutionPolicy,
} from "./types";

function resolveRootPath(root: string, cwd: string): string {
  return path.isAbsolute(root) ? root : path.resolve(cwd, root);
}

export function resolveEventRoot(options: EventConfigLoadOptions = {}): string {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configuredRoot = options.eventRoot ?? env["DIVEDRA_EVENT_ROOT"];
  if (configuredRoot !== undefined && configuredRoot.length > 0) {
    return resolveRootPath(configuredRoot, cwd);
  }
  const workflowRoot = resolveEffectiveRoots(options).workflowRoot;
  return path.join(path.dirname(workflowRoot), ".divedra-events");
}

async function readJsonFilesInDirectory(
  directory: string,
): Promise<readonly { readonly filePath: string; readonly value: unknown }[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const loaded: { readonly filePath: string; readonly value: unknown }[] = [];
  for (const fileName of files) {
    const filePath = path.join(directory, fileName);
    const content = await readFile(filePath, "utf8");
    loaded.push({ filePath, value: JSON.parse(content) as unknown });
  }
  return loaded;
}

function readOptionalBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined {
  const value = input[key];
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asSourceConfig(value: unknown, label: string): EventSourceConfig {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  const id = readOptionalString(value, "id");
  const kind = readOptionalString(value, "kind");
  if (id === undefined || kind === undefined) {
    throw new Error(`${label} must include non-empty id and kind`);
  }
  return {
    ...value,
    id,
    kind,
    ...(readOptionalBoolean(value, "enabled") === undefined
      ? {}
      : { enabled: readOptionalBoolean(value, "enabled") }),
  } as EventSourceConfig;
}

function asDestinationConfig(
  value: unknown,
  label: string,
): EventOutputDestinationConfig {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  const id = readOptionalString(value, "id");
  const kind = readOptionalString(value, "kind");
  if (id === undefined || kind === undefined) {
    throw new Error(`${label} must include non-empty id and kind`);
  }
  return {
    ...value,
    id,
    kind,
    ...(readOptionalBoolean(value, "enabled") === undefined
      ? {}
      : { enabled: readOptionalBoolean(value, "enabled") }),
  } as EventOutputDestinationConfig;
}

function asExecutionPolicy(
  value: unknown,
): EventWorkflowExecutionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    return {};
  }
  return value;
}

function asInputMapping(value: unknown, label: string): EventInputMapping {
  if (!isJsonObject(value)) {
    throw new Error(`${label}.inputMapping must be a JSON object`);
  }
  if (value["mode"] === "event-input") {
    const mirrorToHumanInput = readOptionalBoolean(value, "mirrorToHumanInput");
    return {
      mode: "event-input",
      ...(mirrorToHumanInput === undefined ? {} : { mirrorToHumanInput }),
    };
  }
  if (value["mode"] === "template" && value["template"] !== undefined) {
    const mirrorToHumanInput = readOptionalBoolean(value, "mirrorToHumanInput");
    return {
      mode: "template",
      template: value["template"],
      ...(mirrorToHumanInput === undefined ? {} : { mirrorToHumanInput }),
    };
  }
  throw new Error(
    `${label}.inputMapping must use mode 'event-input' or 'template'`,
  );
}

function isSupervisorDispatchExecution(
  execution: EventWorkflowExecutionPolicy | undefined,
): boolean {
  return (
    execution?.mode === "supervisor-dispatch" ||
    execution?.mode === "schedule-registration"
  );
}

function asBinding(value: unknown, label: string): EventBinding {
  if (!isJsonObject(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  const id = readOptionalString(value, "id");
  const sourceId = readOptionalString(value, "sourceId");
  if (id === undefined || sourceId === undefined) {
    throw new Error(`${label} must include non-empty id and sourceId`);
  }
  const execution = asExecutionPolicy(value["execution"]);
  const workflowName = readOptionalString(value, "workflowName");
  if (!isSupervisorDispatchExecution(execution) && workflowName === undefined) {
    throw new Error(
      `${label} must include non-empty workflowName unless execution.mode is supervisor-dispatch or schedule-registration`,
    );
  }
  const match = value["match"];
  const enabled = readOptionalBoolean(value, "enabled");
  const outputDestinations = value["outputDestinations"];
  return {
    ...value,
    id,
    sourceId,
    ...(workflowName === undefined ? {} : { workflowName }),
    inputMapping: asInputMapping(value["inputMapping"], label),
    ...(enabled === undefined ? {} : { enabled }),
    ...(Array.isArray(outputDestinations) ? { outputDestinations } : {}),
    ...(isJsonObject(match) ? { match } : {}),
    ...(execution === undefined ? {} : { execution }),
  };
}

export async function loadEventConfiguration(
  options: EventConfigLoadOptions = {},
): Promise<EventConfiguration> {
  const eventRoot = resolveEventRoot(options);
  const [sourceFiles, destinationFiles, bindingFiles] = await Promise.all([
    readJsonFilesInDirectory(path.join(eventRoot, "sources")),
    readJsonFilesInDirectory(path.join(eventRoot, "destinations")),
    readJsonFilesInDirectory(path.join(eventRoot, "bindings")),
  ]);
  return {
    eventRoot,
    sources: sourceFiles.map((entry) =>
      asSourceConfig(entry.value, entry.filePath),
    ),
    destinations: destinationFiles.map((entry) =>
      asDestinationConfig(entry.value, entry.filePath),
    ),
    bindings: bindingFiles.map((entry) =>
      asBinding(entry.value, entry.filePath),
    ),
  };
}

export function isEventSourceEnabled(source: EventSourceConfig): boolean {
  return source.enabled !== false;
}

export function isEventOutputDestinationEnabled(
  destination: EventOutputDestinationConfig,
): boolean {
  return destination.enabled !== false;
}

export function isEventBindingEnabled(binding: EventBinding): boolean {
  return binding.enabled !== false;
}
