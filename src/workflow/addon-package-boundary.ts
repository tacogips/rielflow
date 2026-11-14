import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  WorkflowNodeAddonRef,
} from "./types";

interface PromiseLikeValue {
  readonly then: unknown;
}

function isPromiseLike(value: unknown): value is PromiseLikeValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

function makeIssue(path: string, message: string) {
  return { severity: "error" as const, path, message };
}

function definitionVersionMatches(
  definition: NodeAddonDefinition,
  addon: WorkflowNodeAddonRef,
): boolean {
  return (
    definition.version === undefined ||
    addon.version === undefined ||
    definition.version === addon.version
  );
}

function describeAddonDefinitionVersions(
  definitions: readonly NodeAddonDefinition[],
): string {
  return definitions
    .map((definition) => definition.version ?? "<unspecified>")
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

export function createBoundaryNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): NodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return (input) => {
    const matchingNameDefinitions = registeredDefinitions.filter(
      (definition) => definition.name === input.addon.name,
    );
    if (matchingNameDefinitions.length === 0) {
      return undefined;
    }

    const matchingDefinitions = matchingNameDefinitions.filter((definition) =>
      definitionVersionMatches(definition, input.addon),
    );
    if (matchingDefinitions.length === 0) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `unsupported version '${input.addon.version ?? "<unspecified>"}' for third-party node add-on '${input.addon.name}'; registered versions: ${describeAddonDefinitionVersions(matchingNameDefinitions)}`,
          ),
        ],
      };
    }

    if (input.addon.version === undefined && matchingDefinitions.length > 1) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `must be specified because multiple versions are registered for third-party node add-on '${input.addon.name}': ${describeAddonDefinitionVersions(matchingDefinitions)}`,
          ),
        ],
      };
    }

    const [definition] = matchingDefinitions;
    if (definition === undefined) {
      return undefined;
    }
    const resolved = definition.resolve(input);
    if (isPromiseLike(resolved)) {
      void Promise.resolve(resolved).catch(() => undefined);
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on '${input.addon.name}' uses an async definition resolver; use loadWorkflowFromDisk or validateWorkflowBundleAsync for async add-ons`,
          ),
        ],
      };
    }
    return resolved;
  };
}

export function createBoundaryAsyncNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): AsyncNodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return async (input) => {
    const matchingNameDefinitions = registeredDefinitions.filter(
      (definition) => definition.name === input.addon.name,
    );
    if (matchingNameDefinitions.length === 0) {
      return undefined;
    }

    const matchingDefinitions = matchingNameDefinitions.filter((definition) =>
      definitionVersionMatches(definition, input.addon),
    );
    if (matchingDefinitions.length === 0) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `unsupported version '${input.addon.version ?? "<unspecified>"}' for third-party node add-on '${input.addon.name}'; registered versions: ${describeAddonDefinitionVersions(matchingNameDefinitions)}`,
          ),
        ],
      };
    }

    if (input.addon.version === undefined && matchingDefinitions.length > 1) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `must be specified because multiple versions are registered for third-party node add-on '${input.addon.name}': ${describeAddonDefinitionVersions(matchingDefinitions)}`,
          ),
        ],
      };
    }

    const [definition] = matchingDefinitions;
    if (definition === undefined) {
      return undefined;
    }
    return await definition.resolve(input);
  };
}

const addonPackageEntrypointCandidates = [
  "../packages/divedra-addons/dist/index.js",
  "../../packages/divedra-addons/dist/index.js",
  "../../divedra-addons/dist/index.js",
] as const;

interface BoundaryNodeAddonResolveInputBase extends NodeAddonResolveInput {
  readonly options?: unknown;
  readonly workflowSource?: unknown;
}

interface BoundaryAsyncNodeAddonResolveInput
  extends BoundaryNodeAddonResolveInputBase {
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}

interface BoundarySyncNodeAddonResolveInput
  extends BoundaryNodeAddonResolveInputBase {
  readonly thirdPartyResolvers?: readonly NodeAddonPayloadResolver[];
}

async function loadAddonPackage(): Promise<Readonly<Record<string, unknown>>> {
  let lastError: unknown;
  for (const candidate of addonPackageEntrypointCandidates) {
    try {
      return (await import(
        new URL(candidate, import.meta.url).href
      )) as Readonly<Record<string, unknown>>;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  const reason = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`unable to load add-on package${reason}`);
}

export async function resolveBoundaryNodeAddonPayloadAsync(
  input: BoundaryAsyncNodeAddonResolveInput,
): Promise<NodeAddonResolveResult> {
  const module = await loadAddonPackage();
  const resolver = module[["resolve", "NodeAddonPayloadAsync"].join("")];
  if (typeof resolver !== "function") {
    throw new Error("add-on package does not expose async payload resolution");
  }
  return (await resolver(input)) as NodeAddonResolveResult;
}

export function resolveBoundaryNodeAddonPayloadSync(
  input: BoundarySyncNodeAddonResolveInput,
): NodeAddonResolveResult {
  for (const resolver of input.thirdPartyResolvers ?? []) {
    const resolved = resolver(input);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return {
    issues: [
      makeIssue(
        input.path,
        `node add-on '${input.addon.name}' requires asynchronous add-on package resolution; use loadWorkflowFromDisk or validateWorkflowBundleAsync`,
      ),
    ],
  };
}
