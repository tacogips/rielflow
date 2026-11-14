import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfiguredRootPath } from "../../rielflow-core/src/paths";
import {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "../../rielflow-core/src/index";
import { renderPromptTemplate } from "../../rielflow-core/src/index";
import { err, ok, type Result } from "../../rielflow-core/src/index";
import {
  validateJsonSchemaDefinition,
  validateJsonValueAgainstSchema,
} from "../../rielflow-core/src/index";
import {
  computeInstalledAddonContentDigest,
  isExecutableLocalAddon,
  validateExecutableResolutionMetadata,
} from "./local-node-addon-executable-validation";
import {
  buildExecutableAddonAuthorizationSummary,
  findMatchingAddonLock,
  validateCapabilityGrant,
  type ExecutableAddonGrantValidationResult,
} from "./local-node-addon-authorization";
import type {
  JsonObject,
  LoadOptions,
  NodeAddonResolveResult,
  NodeValidationResultInput,
  NodePayload,
  ResolvedAddonSource,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "../../rielflow-core/src/index";

export interface LocalNodeAddonManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly allowedRoles: readonly ["worker"];
  readonly resolution: LocalNodeAddonResolutionTemplate;
  readonly execution?: LocalNodeAddonExecutionDescriptor;
  readonly capabilities?: readonly LocalNodeAddonCapability[];
  readonly configSchema?: JsonObject;
  readonly envSchema?: JsonObject;
  readonly inputSchema?: JsonObject;
}

export type LocalNodeAddonExecutionKind =
  | "declarative"
  | "container"
  | "local-command";

export interface LocalNodeAddonExecutionDescriptor {
  readonly kind: LocalNodeAddonExecutionKind;
  readonly entrypoint?: string;
  readonly containerfilePath?: string;
  readonly runtimeHints?: readonly string[];
}

export interface LocalNodeAddonCapability {
  readonly name: string;
  readonly required?: boolean;
  readonly scope?: string;
  readonly reason?: string;
  readonly defaultPolicy?: "deny" | "prompt" | "allow";
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

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return strings.length === value.length ? strings : undefined;
}

function isSafeAddonRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  return (
    segments.length > 0 &&
    !segments.some((segment) => segment === "." || segment === "..")
  );
}

function normalizeExecutionDescriptor(
  value: unknown,
  issues: ValidationIssue[],
): LocalNodeAddonExecutionDescriptor | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("addon.execution", "must be an object"));
    return undefined;
  }
  const kind = value["kind"];
  if (
    kind !== "declarative" &&
    kind !== "container" &&
    kind !== "local-command"
  ) {
    issues.push(
      makeIssue(
        "addon.execution.kind",
        "must be declarative, container, or local-command",
      ),
    );
    return undefined;
  }
  const entrypoint = value["entrypoint"];
  if (
    entrypoint !== undefined &&
    (typeof entrypoint !== "string" || !isSafeAddonRelativePath(entrypoint))
  ) {
    issues.push(
      makeIssue(
        "addon.execution.entrypoint",
        "must be a safe relative path",
      ),
    );
  }
  const containerfilePath = value["containerfilePath"];
  if (
    containerfilePath !== undefined &&
    (typeof containerfilePath !== "string" ||
      !isSafeAddonRelativePath(containerfilePath))
  ) {
    issues.push(
      makeIssue(
        "addon.execution.containerfilePath",
        "must be a safe relative path",
      ),
    );
  }
  const runtimeHints = readStringArray(value["runtimeHints"]);
  if (value["runtimeHints"] !== undefined && runtimeHints === undefined) {
    issues.push(
      makeIssue(
        "addon.execution.runtimeHints",
        "must be an array of non-empty strings",
      ),
    );
  }
  return {
    kind,
    ...(typeof entrypoint === "string" ? { entrypoint } : {}),
    ...(typeof containerfilePath === "string" ? { containerfilePath } : {}),
    ...(runtimeHints === undefined ? {} : { runtimeHints }),
  };
}

function normalizeCapabilities(
  value: unknown,
  issues: ValidationIssue[],
): readonly LocalNodeAddonCapability[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(makeIssue("addon.capabilities", "must be an array"));
    return undefined;
  }
  const capabilities: LocalNodeAddonCapability[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      issues.push(
        makeIssue(`addon.capabilities[${index}]`, "must be an object"),
      );
      continue;
    }
    const name = entry["name"];
    const required = entry["required"];
    const scope = entry["scope"];
    const reason = entry["reason"];
    const defaultPolicy = entry["defaultPolicy"];
    if (typeof name !== "string" || name.length === 0) {
      issues.push(
        makeIssue(`addon.capabilities[${index}].name`, "must be a string"),
      );
      continue;
    }
    if (required !== undefined && typeof required !== "boolean") {
      issues.push(
        makeIssue(
          `addon.capabilities[${index}].required`,
          "must be a boolean",
        ),
      );
    }
    if (scope !== undefined && (typeof scope !== "string" || scope.length === 0)) {
      issues.push(
        makeIssue(`addon.capabilities[${index}].scope`, "must be a string"),
      );
    }
    if (
      reason !== undefined &&
      (typeof reason !== "string" || reason.length === 0)
    ) {
      issues.push(
        makeIssue(`addon.capabilities[${index}].reason`, "must be a string"),
      );
    }
    if (
      defaultPolicy !== undefined &&
      defaultPolicy !== "deny" &&
      defaultPolicy !== "prompt" &&
      defaultPolicy !== "allow"
    ) {
      issues.push(
        makeIssue(
          `addon.capabilities[${index}].defaultPolicy`,
          "must be deny, prompt, or allow",
        ),
      );
    }
    capabilities.push({
      name,
      ...(typeof required === "boolean" ? { required } : {}),
      ...(typeof scope === "string" ? { scope } : {}),
      ...(typeof reason === "string" ? { reason } : {}),
      ...(defaultPolicy === "deny" ||
      defaultPolicy === "prompt" ||
      defaultPolicy === "allow"
        ? { defaultPolicy }
        : {}),
    });
  }
  return capabilities;
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
  const execution = normalizeExecutionDescriptor(value["execution"], issues);
  const capabilities = normalizeCapabilities(value["capabilities"], issues);

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
    ...(execution === undefined ? {} : { execution }),
    ...(capabilities === undefined ? {} : { capabilities }),
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

function applyExecutableAddonDirectoryDefaults(input: {
  readonly manifest: LocalNodeAddonManifest;
  readonly source: ResolvedAddonSource;
  readonly payload: Record<string, unknown>;
}): void {
  if (
    input.payload["nodeType"] === "command" &&
    isRecord(input.payload["command"])
  ) {
    const command = { ...input.payload["command"] };
    if (input.manifest.execution?.kind === "local-command") {
      command["workingDirectory"] = input.source.addonDirectory;
      if (input.manifest.execution.entrypoint !== undefined) {
        command["runtimeScriptPath"] = path.join(
          input.source.addonDirectory,
          input.manifest.execution.entrypoint,
        );
      }
    }
    input.payload["command"] = command;
  }
  if (
    input.payload["nodeType"] === "container" &&
    isRecord(input.payload["container"])
  ) {
    const container = { ...input.payload["container"] };
    if (
      input.manifest.execution?.kind === "container" &&
      container["build"] !== undefined &&
      isRecord(container["build"])
    ) {
      const build = { ...container["build"] };
      build["contextPath"] = "rielflow-addon-build-context";
      build["runtimeContextPath"] = input.source.addonDirectory;
      if (input.manifest.execution.containerfilePath !== undefined) {
        build["containerfilePath"] = input.manifest.execution.containerfilePath;
        build["runtimeContainerfilePath"] = path.join(
          input.source.addonDirectory,
          input.manifest.execution.containerfilePath,
        );
      }
      container["build"] = build;
    }
    input.payload["container"] = container;
  }
}

function resolveUserRoot(options: LoadOptions | undefined): string {
  const env = options?.env ?? process.env;
  return resolveConfiguredRootPath(
    options?.userRoot ?? env["RIEL_USER_ROOT"] ?? "~/.rielflow",
    {
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      env,
    },
  );
}

function recordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function recordArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

async function readJsonRecord(
  filePath: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function findInstalledAddonPackageRecord(input: {
  readonly source: ResolvedAddonSource;
  readonly options?: LoadOptions;
}): Promise<
  | {
      readonly record: Readonly<Record<string, unknown>>;
      readonly addonRecord: Readonly<Record<string, unknown>>;
    }
  | undefined
> {
  const checkoutsRoot = path.join(
    resolveUserRoot(input.options),
    "workflow-registry",
    "checkouts",
  );
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(checkoutsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const expectedDirectory = path.resolve(input.source.addonDirectory);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const record = await readJsonRecord(path.join(checkoutsRoot, entry.name));
    if (record?.["packageKind"] !== "node-addon") {
      continue;
    }
    for (const addonRaw of recordArray(record, "addons")) {
      if (!isRecord(addonRaw)) {
        continue;
      }
      const destinationDirectory = recordString(
        addonRaw,
        "destinationDirectory",
      );
      if (
        destinationDirectory !== undefined &&
        path.resolve(destinationDirectory) === expectedDirectory
      ) {
        return { record, addonRecord: addonRaw };
      }
    }
  }
  return undefined;
}

async function validateExecutableAddonGrant(input: {
  readonly addon: WorkflowNodeAddonRef;
  readonly source: ResolvedAddonSource;
  readonly manifest: LocalNodeAddonManifest;
  readonly options?: LoadOptions;
  readonly path: string;
}): Promise<ExecutableAddonGrantValidationResult> {
  if (!isExecutableLocalAddon(input.manifest)) {
    return { issues: [] };
  }
  const metadataIssues = validateExecutableResolutionMetadata({
    manifest: input.manifest,
    path: input.path,
  });
  if (metadataIssues.length > 0) {
    return { issues: metadataIssues };
  }
  if (input.source.scope === "direct") {
    return input.options?.allowUnpackagedExecutableAddons === true
      ? { issues: [] }
      : {
          issues: [
            makeIssue(
              input.path,
              `executable local node add-on '${input.source.addonName}' cannot be loaded from a direct add-on root without allowUnpackagedExecutableAddons`,
            ),
          ],
        };
  }
  const installed = await findInstalledAddonPackageRecord({
    source: input.source,
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (installed === undefined) {
    return {
      issues: [
        makeIssue(
          input.path,
          `executable local node add-on '${input.source.addonName}' must resolve from package-owned installed provenance or an explicit direct add-on root`,
        ),
      ],
    };
  }
  const integrity = installed.record["integrity"];
  if (
    !isRecord(integrity) ||
    typeof integrity["digest"] !== "string" ||
    integrity["digest"].length === 0 ||
    integrity["digestAlgorithm"] !== "sha256"
  ) {
    return {
      issues: [
        makeIssue(
          input.path,
          `executable local node add-on '${input.source.addonName}' requires verified sha256 package integrity`,
        ),
      ],
    };
  }
  const storedContentDigest = recordString(installed.addonRecord, "contentDigest");
  if (storedContentDigest === undefined) {
    return {
      issues: [
        makeIssue(
          input.path,
          `executable local node add-on '${input.source.addonName}' requires installed add-on contentDigest`,
        ),
      ],
    };
  }
  const recomputedContentDigest = await computeInstalledAddonContentDigest({
    source: input.source,
    manifest: input.manifest,
    path: input.path,
  });
  if (!recomputedContentDigest.ok) {
    return { issues: recomputedContentDigest.error };
  }
  if (recomputedContentDigest.value !== storedContentDigest) {
    return {
      issues: [
        makeIssue(
          input.path,
          `executable local node add-on '${input.source.addonName}' contentDigest mismatch`,
        ),
      ],
    };
  }
  const matchingDependencyLock = findMatchingAddonLock({
    source: input.source,
    packageRecord: installed.record,
    contentDigest: recomputedContentDigest.value,
    grants: input.options?.addonDependencyLocks ?? [],
  });
  const requiresEnvRead = input.addon.env !== undefined;
  if (matchingDependencyLock !== undefined) {
    const issues = validateCapabilityGrant({
      source: input.source,
      manifest: input.manifest,
      lock: matchingDependencyLock,
      sourceKind: "package dependency lock",
      requiresEnvRead,
      path: input.path,
    });
    if (issues.length > 0) {
      return { issues };
    }
    const authorization = buildExecutableAddonAuthorizationSummary({
      source: input.source,
      manifest: input.manifest,
      packageRecord: installed.record,
      contentDigest: recomputedContentDigest.value,
      lock: matchingDependencyLock,
      sourceKind: "packageDependencyLock",
    });
    return authorization === undefined
      ? { issues }
      : { issues, authorization };
  }
  const matchingDirectGrant = findMatchingAddonLock({
    source: input.source,
    packageRecord: installed.record,
    contentDigest: recomputedContentDigest.value,
    grants: input.options?.directExecutableAddonGrants ?? [],
  });
  if (matchingDirectGrant === undefined) {
    return {
      issues: [
        makeIssue(
          input.path,
          `executable local node add-on '${input.source.addonName}' requires a matching package dependency lock or directExecutableAddonGrant`,
        ),
      ],
    };
  }
  const issues = validateCapabilityGrant({
    source: input.source,
    manifest: input.manifest,
    lock: matchingDirectGrant,
    sourceKind: "directExecutableAddonGrant",
    requiresEnvRead,
    path: input.path,
  });
  if (issues.length > 0) {
    return { issues };
  }
  const authorization = buildExecutableAddonAuthorizationSummary({
    source: input.source,
    manifest: input.manifest,
    packageRecord: installed.record,
    contentDigest: recomputedContentDigest.value,
    lock: matchingDirectGrant,
    sourceKind: "directExecutableAddonGrant",
  });
  return authorization === undefined ? { issues } : { issues, authorization };
}

export async function resolveLocalNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly source: ResolvedAddonSource;
  readonly options?: LoadOptions;
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
  const executableGrant = await validateExecutableAddonGrant({
    addon: input.addon,
    source: input.source,
    manifest,
    ...(input.options === undefined ? {} : { options: input.options }),
    path: input.path,
  });
  issues.push(...executableGrant.issues);

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
  applyExecutableAddonDirectoryDefaults({
    manifest,
    source: input.source,
    payload,
  });

  if (issues.length > 0) {
    return { issues };
  }
  const nodeValidationResults: NodeValidationResultInput[] =
    executableGrant.authorization === undefined
      ? []
      : [
          {
            status: "valid",
            message: `executable local node add-on '${input.source.addonName}' authorized by ${executableGrant.authorization.sourceKind}`,
            nodeId: input.nodeId,
            source: "addon",
            path: input.path,
            addonName: input.source.addonName,
            details: {
              executableAddonAuthorization: executableGrant.authorization,
            },
          },
        ];
  return {
    payload: payload as unknown as NodePayload,
    issues: [],
    ...(nodeValidationResults.length === 0 ? {} : { nodeValidationResults }),
  };
}
