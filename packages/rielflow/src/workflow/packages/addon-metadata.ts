import path from "node:path";
import { err, ok, type Result } from "../result";
import type {
  WorkflowAddonCapability,
  WorkflowAddonCapabilityName,
  WorkflowPackageAddonCapabilityGrant,
  WorkflowPackageAddonExecutionDescriptor,
  WorkflowPackageFailure,
  WorkflowPackageManifestAddonDependencyLock,
} from "./types";

const WORKFLOW_ADDON_CAPABILITY_NAME_SET: ReadonlySet<string> = new Set([
  "network.egress",
  "filesystem.read",
  "filesystem.write",
  "process.spawn",
  "container.build",
  "container.run",
  "device.gpu",
  "env.read",
]);

const SENSITIVE_WORKFLOW_ADDON_CAPABILITIES: ReadonlySet<string> = new Set([
  "network.egress",
  "process.spawn",
  "device.gpu",
  "env.read",
]);

const WORKFLOW_ADDON_EXECUTION_KIND_SET: ReadonlySet<string> = new Set([
  "declarative",
  "container",
  "local-command",
]);

function packageFailure(
  code: WorkflowPackageFailure["code"],
  message: string,
): WorkflowPackageFailure {
  return { code, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizePackageRelativePath(value: string): string | undefined {
  if (
    value.length === 0 ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return undefined;
  }
  const segments = value
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return segments.join("/");
}

function normalizeSafeAddonArtifactPath(
  value: unknown,
  pathLabel: string,
): Result<string | undefined, WorkflowPackageFailure> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.length === 0) {
    return err(
      packageFailure("INVALID_MANIFEST", `${pathLabel} must be a string`),
    );
  }
  const normalized = normalizePackageRelativePath(value);
  if (normalized === undefined || normalized === ".") {
    return err(packageFailure("UNSAFE_PATH", `${pathLabel} is unsafe`));
  }
  return ok(normalized);
}

function normalizeWorkflowAddonCapabilityName(
  value: unknown,
): WorkflowAddonCapabilityName | undefined {
  return typeof value === "string" &&
    WORKFLOW_ADDON_CAPABILITY_NAME_SET.has(value)
    ? (value as WorkflowAddonCapabilityName)
    : undefined;
}

function normalizeWorkflowAddonCapability(
  value: unknown,
  pathLabel: string,
): Result<WorkflowAddonCapability, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", `${pathLabel} must be an object`),
    );
  }
  const name = normalizeWorkflowAddonCapabilityName(value["name"]);
  const required = value["required"];
  const scope = value["scope"];
  const reason = value["reason"];
  const defaultPolicy = value["defaultPolicy"];
  if (
    name === undefined ||
    (required !== undefined && typeof required !== "boolean") ||
    (scope !== undefined &&
      (typeof scope !== "string" ||
        scope.trim().length === 0 ||
        scope.includes("*"))) ||
    (reason !== undefined &&
      (typeof reason !== "string" || reason.trim().length === 0)) ||
    (defaultPolicy !== undefined &&
      defaultPolicy !== "deny" &&
      defaultPolicy !== "prompt" &&
      defaultPolicy !== "allow")
  ) {
    return err(packageFailure("INVALID_MANIFEST", `${pathLabel} is invalid`));
  }
  if (SENSITIVE_WORKFLOW_ADDON_CAPABILITIES.has(name) && reason === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel}.reason is required for ${name}`,
      ),
    );
  }
  return ok({
    name,
    ...(required === undefined ? {} : { required }),
    ...(scope === undefined ? {} : { scope }),
    ...(reason === undefined ? {} : { reason }),
    ...(defaultPolicy === undefined ? {} : { defaultPolicy }),
  });
}

export function normalizeWorkflowAddonCapabilities(
  value: unknown,
  pathLabel: string,
): Result<
  readonly WorkflowAddonCapability[] | undefined,
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", `${pathLabel} must be an array`),
    );
  }
  const capabilities: WorkflowAddonCapability[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const normalized = normalizeWorkflowAddonCapability(
      entry,
      `${pathLabel}[${index}]`,
    );
    if (!normalized.ok) {
      return normalized;
    }
    const key = `${normalized.value.name}\0${normalized.value.scope ?? ""}`;
    if (seen.has(key)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `${pathLabel}[${index}] duplicates ${normalized.value.name}`,
        ),
      );
    }
    seen.add(key);
    capabilities.push(normalized.value);
  }
  return ok(capabilities);
}

export function normalizeWorkflowPackageAddonExecution(
  value: unknown,
  pathLabel: string,
): Result<
  WorkflowPackageAddonExecutionDescriptor | undefined,
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", `${pathLabel} must be an object`),
    );
  }
  const kind = value["kind"];
  if (
    typeof kind !== "string" ||
    !WORKFLOW_ADDON_EXECUTION_KIND_SET.has(kind)
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel}.kind must be declarative, container, or local-command`,
      ),
    );
  }
  const executionKind = kind as WorkflowPackageAddonExecutionDescriptor["kind"];
  const entrypoint = normalizeSafeAddonArtifactPath(
    value["entrypoint"],
    `${pathLabel}.entrypoint`,
  );
  if (!entrypoint.ok) {
    return entrypoint;
  }
  const containerfilePath = normalizeSafeAddonArtifactPath(
    value["containerfilePath"],
    `${pathLabel}.containerfilePath`,
  );
  if (!containerfilePath.ok) {
    return containerfilePath;
  }
  const runtimeHints = readStringArray(value["runtimeHints"]);
  if (value["runtimeHints"] !== undefined && runtimeHints === undefined) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel}.runtimeHints must be an array of non-empty strings`,
      ),
    );
  }
  if (
    executionKind !== "declarative" &&
    entrypoint.value === undefined &&
    containerfilePath.value === undefined
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel} must declare an entrypoint or containerfilePath`,
      ),
    );
  }
  if (
    executionKind === "declarative" &&
    (entrypoint.value !== undefined || containerfilePath.value !== undefined)
  ) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel} declarative execution must not declare executable artifacts`,
      ),
    );
  }
  return ok({
    kind: executionKind,
    ...(entrypoint.value === undefined ? {} : { entrypoint: entrypoint.value }),
    ...(containerfilePath.value === undefined
      ? {}
      : { containerfilePath: containerfilePath.value }),
    ...(runtimeHints === undefined ? {} : { runtimeHints }),
  });
}

function normalizeWorkflowPackageAddonCapabilityGrant(
  value: unknown,
  pathLabel: string,
): Result<WorkflowPackageAddonCapabilityGrant, WorkflowPackageFailure> {
  if (!isRecord(value)) {
    return err(
      packageFailure("INVALID_MANIFEST", `${pathLabel} must be an object`),
    );
  }
  const allowed = value["allowed"];
  const scope = value["scope"];
  if (
    typeof allowed !== "boolean" ||
    (scope !== undefined && (typeof scope !== "string" || scope.length === 0))
  ) {
    return err(packageFailure("INVALID_MANIFEST", `${pathLabel} is invalid`));
  }
  return ok({
    allowed,
    ...(scope === undefined ? {} : { scope }),
  });
}

export function normalizeWorkflowPackageAddonDependencyLocks(
  value: unknown,
  pathLabel: string,
): Result<
  readonly WorkflowPackageManifestAddonDependencyLock[] | undefined,
  WorkflowPackageFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!Array.isArray(value) || value.length === 0) {
    return err(
      packageFailure(
        "INVALID_MANIFEST",
        `${pathLabel} must be a non-empty array`,
      ),
    );
  }
  const locks: WorkflowPackageManifestAddonDependencyLock[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return err(
        packageFailure(
          "INVALID_MANIFEST",
          `${pathLabel}[${index}] must be an object`,
        ),
      );
    }
    const name = entry["name"];
    const version = entry["version"];
    const contentDigest = entry["contentDigest"];
    const optional = entry["optional"];
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      typeof version !== "string" ||
      version.length === 0 ||
      (contentDigest !== undefined &&
        (typeof contentDigest !== "string" ||
          !/^sha256:[a-f0-9]{64}$/.test(contentDigest))) ||
      (optional !== undefined && typeof optional !== "boolean")
    ) {
      return err(
        packageFailure("INVALID_MANIFEST", `${pathLabel}[${index}] is invalid`),
      );
    }
    const grantRaw = entry["capabilityGrant"];
    const grants: Partial<
      Record<WorkflowAddonCapabilityName, WorkflowPackageAddonCapabilityGrant>
    > = {};
    if (grantRaw !== undefined) {
      if (!isRecord(grantRaw)) {
        return err(
          packageFailure(
            "INVALID_MANIFEST",
            `${pathLabel}[${index}].capabilityGrant must be an object`,
          ),
        );
      }
      for (const [capabilityName, grantValue] of Object.entries(grantRaw)) {
        const normalizedName =
          normalizeWorkflowAddonCapabilityName(capabilityName);
        if (normalizedName === undefined) {
          return err(
            packageFailure(
              "INVALID_MANIFEST",
              `${pathLabel}[${index}].capabilityGrant contains unknown capability '${capabilityName}'`,
            ),
          );
        }
        const grant = normalizeWorkflowPackageAddonCapabilityGrant(
          grantValue,
          `${pathLabel}[${index}].capabilityGrant.${capabilityName}`,
        );
        if (!grant.ok) {
          return grant;
        }
        grants[normalizedName] = grant.value;
      }
    }
    locks.push({
      name,
      version,
      ...(contentDigest === undefined ? {} : { contentDigest }),
      ...(Object.keys(grants).length === 0 ? {} : { capabilityGrant: grants }),
      ...(optional === undefined ? {} : { optional }),
    });
  }
  return ok(locks);
}
