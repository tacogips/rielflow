import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "./node-template-fields";
import { renderPromptTemplate } from "./render";
import { err, ok, type Result } from "./result";
import {
  validateJsonSchemaDefinition,
  validateJsonValueAgainstSchema,
} from "./json-schema";
import type {
  JsonObject,
  NodeAddonResolveResult,
  NodePayload,
  ResolvedAddonSource,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "./types";

export interface LocalNodeAddonManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedRoles: readonly ["worker"];
  readonly resolution: LocalNodeAddonResolutionTemplate;
  readonly configSchema?: JsonObject;
  readonly envSchema?: JsonObject;
  readonly inputSchema?: JsonObject;
}

export interface LocalNodeAddonResolutionTemplate
  extends Readonly<Record<string, unknown>> {
  readonly kind: "node-payload-template";
  readonly nodeType?: "agent" | "command" | "container" | "user-action";
}

export interface LocalNodeAddonFailure {
  readonly code: "IO" | "VALIDATION";
  readonly message: string;
  readonly issues?: readonly ValidationIssue[];
}

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function readOptionalJsonSchema(
  raw: Readonly<Record<string, unknown>>,
  key: "configSchema" | "envSchema" | "inputSchema",
  issues: ValidationIssue[],
): JsonObject | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonObject(value)) {
    issues.push(makeIssue(`addon.${key}`, "must be an object when provided"));
    return undefined;
  }
  for (const schemaIssue of validateJsonSchemaDefinition(value)) {
    issues.push(
      makeIssue(
        `addon.${key}${schemaIssue.path === "$schema" ? "" : schemaIssue.path.slice("$schema".length)}`,
        schemaIssue.message,
      ),
    );
  }
  return value;
}

function normalizeManifest(
  source: ResolvedAddonSource,
  value: unknown,
): Result<LocalNodeAddonManifest, LocalNodeAddonFailure> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return err({
      code: "VALIDATION",
      message: "local add-on manifest validation failed",
      issues: [makeIssue("addon", "must be an object")],
    });
  }

  if (value["name"] !== source.addonName) {
    issues.push(
      makeIssue(
        "addon.name",
        `must match path add-on name '${source.addonName}'`,
      ),
    );
  }
  if (value["version"] !== source.version) {
    issues.push(
      makeIssue("addon.version", `must match path version '${source.version}'`),
    );
  }
  if (
    typeof value["description"] !== "string" ||
    value["description"].length === 0
  ) {
    issues.push(makeIssue("addon.description", "must be a non-empty string"));
  }
  const allowedRoles = value["allowedRoles"];
  if (
    !Array.isArray(allowedRoles) ||
    allowedRoles.length !== 1 ||
    allowedRoles[0] !== "worker"
  ) {
    issues.push(makeIssue("addon.allowedRoles", 'must be ["worker"]'));
  }

  const resolution = value["resolution"];
  let normalizedResolution: LocalNodeAddonResolutionTemplate | undefined;
  if (!isRecord(resolution)) {
    issues.push(makeIssue("addon.resolution", "must be an object"));
  } else if (resolution["kind"] !== "node-payload-template") {
    issues.push(
      makeIssue("addon.resolution.kind", "must be 'node-payload-template'"),
    );
  } else {
    const nodeType = resolution["nodeType"];
    if (
      nodeType !== undefined &&
      nodeType !== "agent" &&
      nodeType !== "command" &&
      nodeType !== "container" &&
      nodeType !== "user-action"
    ) {
      issues.push(
        makeIssue(
          "addon.resolution.nodeType",
          "must be agent, command, container, or user-action when provided",
        ),
      );
    } else {
      normalizedResolution = resolution as LocalNodeAddonResolutionTemplate;
    }
  }

  const configSchema = readOptionalJsonSchema(value, "configSchema", issues);
  const envSchema = readOptionalJsonSchema(value, "envSchema", issues);
  const inputSchema = readOptionalJsonSchema(value, "inputSchema", issues);

  if (issues.length > 0 || normalizedResolution === undefined) {
    return err({
      code: "VALIDATION",
      message: "local add-on manifest validation failed",
      issues,
    });
  }

  return ok({
    name: source.addonName,
    version: source.version,
    description: value["description"] as string,
    allowedRoles: ["worker"],
    resolution: normalizedResolution,
    ...(configSchema === undefined ? {} : { configSchema }),
    ...(envSchema === undefined ? {} : { envSchema }),
    ...(inputSchema === undefined ? {} : { inputSchema }),
  });
}

export async function loadLocalNodeAddonManifest(
  source: ResolvedAddonSource,
): Promise<Result<LocalNodeAddonManifest, LocalNodeAddonFailure>> {
  try {
    const raw = await readFile(source.manifestPath, "utf8");
    return normalizeManifest(source, JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    return err({
      code: "IO",
      message: `failed reading local add-on manifest '${source.manifestPath}': ${errorMessageFromUnknown(error)}`,
    });
  }
}

function schemaValidationIssues(input: {
  readonly schema: JsonObject;
  readonly value: unknown;
  readonly path: string;
}): readonly ValidationIssue[] {
  return validateJsonValueAgainstSchema({
    schema: input.schema,
    value: input.value,
  }).map((entry) =>
    makeIssue(
      `${input.path}${entry.path === "$" ? "" : entry.path.slice(1)}`,
      entry.message,
    ),
  );
}

function validateAddonInput(
  addon: WorkflowNodeAddonRef,
  manifest: LocalNodeAddonManifest,
  pathPrefix: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (addon.config !== undefined && !isRecord(addon.config)) {
    issues.push(makeIssue(`${pathPrefix}.config`, "must be an object"));
  }
  if (addon.inputs !== undefined && !isRecord(addon.inputs)) {
    issues.push(makeIssue(`${pathPrefix}.inputs`, "must be an object"));
  }
  if (addon.env !== undefined && !isRecord(addon.env)) {
    issues.push(makeIssue(`${pathPrefix}.env`, "must be an object"));
  }
  if (addon.env !== undefined && manifest.envSchema === undefined) {
    issues.push(
      makeIssue(
        `${pathPrefix}.env`,
        "is not supported by this local add-on manifest",
      ),
    );
  }
  if (manifest.configSchema !== undefined) {
    issues.push(
      ...schemaValidationIssues({
        schema: manifest.configSchema,
        value: addon.config ?? {},
        path: `${pathPrefix}.config`,
      }),
    );
  }
  if (manifest.inputSchema !== undefined) {
    issues.push(
      ...schemaValidationIssues({
        schema: manifest.inputSchema,
        value: addon.inputs ?? {},
        path: `${pathPrefix}.inputs`,
      }),
    );
  }
  if (manifest.envSchema !== undefined) {
    issues.push(
      ...schemaValidationIssues({
        schema: manifest.envSchema,
        value: addon.env ?? {},
        path: `${pathPrefix}.env`,
      }),
    );
  }
  return issues;
}

function renderTemplateValue(
  value: unknown,
  context: Readonly<Record<string, unknown>>,
): unknown {
  if (typeof value === "string") {
    return renderPromptTemplate(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, context));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        renderTemplateValue(entry, context),
      ]),
    );
  }
  return value;
}

function resolveAddonRelativePath(
  source: ResolvedAddonSource,
  relativePath: string,
): Result<string, ValidationIssue> {
  if (
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return err(
      makeIssue("addon.resolution", "template file paths must be relative"),
    );
  }
  const segments = relativePath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return err(
      makeIssue(
        "addon.resolution",
        "template file paths must not contain '.' or '..' segments",
      ),
    );
  }

  const resolved = path.resolve(source.addonDirectory, ...segments);
  const relative = path.relative(source.addonDirectory, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return err(
      makeIssue(
        "addon.resolution",
        "template file paths must stay within the add-on version directory",
      ),
    );
  }
  return ok(resolved);
}

async function resolveTemplateFiles(input: {
  readonly source: ResolvedAddonSource;
  readonly payload: Record<string, unknown>;
  readonly issues: ValidationIssue[];
}): Promise<void> {
  for (const { path: containerPath, record } of listNodeTemplateFieldContainers(
    input.payload,
  )) {
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateFile = record[spec.fileField];
      const issuePath =
        containerPath.length === 0
          ? `addon.resolution.${spec.fileField}`
          : `addon.resolution.${containerPath}.${spec.fileField}`;
      if (templateFile === undefined) {
        continue;
      }
      if (typeof templateFile !== "string" || templateFile.length === 0) {
        input.issues.push(makeIssue(issuePath, "must be a non-empty string"));
        continue;
      }
      const resolvedPath = resolveAddonRelativePath(input.source, templateFile);
      if (!resolvedPath.ok) {
        input.issues.push(makeIssue(issuePath, resolvedPath.error.message));
        continue;
      }
      try {
        record[spec.textField] = await readFile(resolvedPath.value, "utf8");
        delete record[spec.fileField];
      } catch (error: unknown) {
        input.issues.push(
          makeIssue(
            issuePath,
            `failed reading template file '${templateFile}': ${errorMessageFromUnknown(error)}`,
          ),
        );
      }
    }
  }
}

export async function resolveLocalNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly source: ResolvedAddonSource;
}): Promise<NodeAddonResolveResult> {
  const manifestResult = await loadLocalNodeAddonManifest(input.source);
  if (!manifestResult.ok) {
    return {
      issues: manifestResult.error.issues ?? [
        makeIssue(input.path, manifestResult.error.message),
      ],
    };
  }
  const manifest = manifestResult.value;
  const issues = [...validateAddonInput(input.addon, manifest, input.path)];

  const context = {
    nodeId: input.nodeId,
    addon: {
      config: input.addon.config ?? {},
      inputs: input.addon.inputs ?? {},
    },
  };
  const rendered = renderTemplateValue(manifest.resolution, context);
  if (!isRecord(rendered)) {
    return {
      issues: [makeIssue(`${input.path}.payload`, "must resolve to an object")],
    };
  }

  const payload: Record<string, unknown> = { ...rendered };
  delete payload["kind"];
  payload["id"] = input.nodeId;
  payload["description"] =
    typeof payload["description"] === "string" &&
    payload["description"].length > 0
      ? payload["description"]
      : manifest.description;
  payload["variables"] = {
    ...(isRecord(payload["variables"]) ? payload["variables"] : {}),
    ...(input.addon.inputs ?? {}),
  };

  await resolveTemplateFiles({
    source: input.source,
    payload,
    issues,
  });

  return issues.length > 0
    ? { issues }
    : { payload: payload as unknown as NodePayload, issues: [] };
}
