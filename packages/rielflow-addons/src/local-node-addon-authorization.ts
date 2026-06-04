import type {
  DirectExecutableAddonGrant,
  ResolvedAddonSource,
  ValidationIssue,
} from "../../rielflow-core/src/index";
import type { LocalNodeAddonManifest } from "./local-node-addons";

export type ExecutableAddonAuthorizationSourceKind =
  | "packageDependencyLock"
  | "directExecutableAddonGrant";

export interface ExecutableAddonAuthorizationSummary {
  readonly sourceKind: ExecutableAddonAuthorizationSourceKind;
  readonly sourceScope: ResolvedAddonSource["scope"];
  readonly sourceScopeRoot?: string;
  readonly packageId: string;
  readonly registryUrl?: string;
  readonly registryRef?: string;
  readonly installId?: string;
  readonly addonName: string;
  readonly addonVersion: string;
  readonly contentDigest: string;
  readonly declaredCapabilities: readonly NonNullable<
    LocalNodeAddonManifest["capabilities"]
  >[number][];
  readonly grantedCapabilities: Readonly<Record<string, unknown>>;
}

export interface ExecutableAddonGrantValidationResult {
  readonly issues: readonly ValidationIssue[];
  readonly authorization?: ExecutableAddonAuthorizationSummary;
}

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function recordString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function findMatchingAddonLock(input: {
  readonly source: ResolvedAddonSource;
  readonly packageRecord: Readonly<Record<string, unknown>>;
  readonly contentDigest: string;
  readonly grants: readonly DirectExecutableAddonGrant[];
}): DirectExecutableAddonGrant["addons"][number] | undefined {
  const packageId = recordString(input.packageRecord, "packageId");
  const registryUrl = recordString(input.packageRecord, "registryUrl");
  const registryRef = recordString(input.packageRecord, "registryRef");
  if (packageId === undefined) {
    return undefined;
  }
  for (const grant of input.grants) {
    if (
      grant.packageId !== packageId ||
      (grant.kind !== undefined && grant.kind !== "node-addon") ||
      (grant.registry !== undefined && grant.registry !== registryUrl) ||
      (grant.branch !== undefined && grant.branch !== registryRef)
    ) {
      continue;
    }
    const addonGrant = grant.addons.find(
      (entry) =>
        entry.name === input.source.addonName &&
        entry.version === input.source.version &&
        entry.contentDigest === input.contentDigest,
    );
    if (addonGrant !== undefined) {
      return addonGrant;
    }
  }
  return undefined;
}

export function buildExecutableAddonAuthorizationSummary(input: {
  readonly source: ResolvedAddonSource;
  readonly manifest: LocalNodeAddonManifest;
  readonly packageRecord: Readonly<Record<string, unknown>>;
  readonly contentDigest: string;
  readonly lock: DirectExecutableAddonGrant["addons"][number];
  readonly sourceKind: ExecutableAddonAuthorizationSourceKind;
}): ExecutableAddonAuthorizationSummary | undefined {
  const packageId = recordString(input.packageRecord, "packageId");
  if (packageId === undefined) {
    return undefined;
  }
  const registryUrl = recordString(input.packageRecord, "registryUrl");
  const registryRef = recordString(input.packageRecord, "registryRef");
  const installId = recordString(input.packageRecord, "installId");
  return {
    sourceKind: input.sourceKind,
    sourceScope: input.source.scope,
    ...(input.source.scopeRoot === undefined
      ? {}
      : { sourceScopeRoot: input.source.scopeRoot }),
    packageId,
    ...(registryUrl === undefined ? {} : { registryUrl }),
    ...(registryRef === undefined ? {} : { registryRef }),
    ...(installId === undefined ? {} : { installId }),
    addonName: input.source.addonName,
    addonVersion: input.source.version,
    contentDigest: input.contentDigest,
    declaredCapabilities: (input.manifest.capabilities ?? []).map(
      (capability) => ({
        ...capability,
        required: capability.required !== false,
      }),
    ),
    grantedCapabilities: input.lock.capabilityGrant ?? {},
  };
}

export function validateCapabilityGrant(input: {
  readonly source: ResolvedAddonSource;
  readonly manifest: LocalNodeAddonManifest;
  readonly lock: DirectExecutableAddonGrant["addons"][number];
  readonly sourceKind: "package dependency lock" | "directExecutableAddonGrant";
  readonly requiresEnvRead: boolean;
  readonly path: string;
}): readonly ValidationIssue[] {
  const declaredCapabilities = new Set(
    (input.manifest.capabilities ?? []).map((capability) => capability.name),
  );
  const capabilityGrant = input.lock.capabilityGrant ?? {};
  for (const capabilityName of Object.keys(capabilityGrant)) {
    if (!declaredCapabilities.has(capabilityName)) {
      return [
        makeIssue(
          input.path,
          `${input.sourceKind} requests undeclared capability '${capabilityName}' for '${input.source.addonName}'`,
        ),
      ];
    }
  }
  for (const capability of input.manifest.capabilities ?? []) {
    if (capability.required === false) {
      continue;
    }
    if (capabilityGrant[capability.name]?.allowed !== true) {
      return [
        makeIssue(
          input.path,
          `${input.sourceKind} must allow required capability '${capability.name}' for '${input.source.addonName}'`,
        ),
      ];
    }
  }
  if (input.requiresEnvRead && capabilityGrant["env.read"]?.allowed !== true) {
    return [
      makeIssue(
        input.path,
        `${input.sourceKind} must allow capability 'env.read' for addon.env on '${input.source.addonName}'`,
      ),
    ];
  }
  if (
    input.requiresEnvRead &&
    capabilityGrant["env.read"]?.scope !== "addon.env"
  ) {
    return [
      makeIssue(
        input.path,
        `${input.sourceKind} must scope capability 'env.read' to 'addon.env' for '${input.source.addonName}'`,
      ),
    ];
  }
  return [];
}
