import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
} from "./types";
import {
  isPromiseLike,
  makeIssue,
  selectNodeAddonDefinition,
} from "./node-addons/addon-constants-and-agent-config";

export function createBoundaryNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): NodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return (input) => {
    const selection = selectNodeAddonDefinition({
      definitions: registeredDefinitions,
      addon: input.addon,
      path: input.path,
    });
    if (selection.kind === "missing") {
      return undefined;
    }
    if (selection.kind === "issues") {
      return { issues: selection.issues };
    }
    const resolved = selection.definition.resolve(input);
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
    const selection = selectNodeAddonDefinition({
      definitions: registeredDefinitions,
      addon: input.addon,
      path: input.path,
    });
    if (selection.kind === "missing") {
      return undefined;
    }
    if (selection.kind === "issues") {
      return { issues: selection.issues };
    }
    return await selection.definition.resolve(input);
  };
}

const addonPackageEntrypointCandidates = [
  "../packages/divedra-addons/dist/index.js",
  "../../packages/divedra-addons/dist/index.js",
  "../../packages/divedra-addons/src/index.ts",
  "../../divedra-addons/dist/index.js",
  "../../divedra-addons/src/index.ts",
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

export async function loadBoundaryAddonPackage(): Promise<
  Readonly<Record<string, unknown>>
> {
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
  const module = await loadBoundaryAddonPackage();
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
