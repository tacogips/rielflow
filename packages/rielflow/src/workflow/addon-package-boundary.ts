import type {
  AsyncNodeAddonPayloadResolver,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
} from "./types";
import {
  createAsyncNodeAddonRegistry,
  createNodeAddonRegistry,
  makeIssue,
} from "./node-addons/addon-constants-and-agent-config";

export function createBoundaryNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): NodeAddonPayloadResolver {
  return createNodeAddonRegistry(definitions, {
    asyncValidateHookMessage: (addonName) =>
      `third-party node add-on '${addonName}' uses an async validate hook; use validateWorkflowBundleAsync for async add-ons`,
  });
}

export function createBoundaryAsyncNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): AsyncNodeAddonPayloadResolver {
  return createAsyncNodeAddonRegistry(definitions);
}

interface BoundaryNodeAddonResolveInputBase extends NodeAddonResolveInput {
  readonly options?: unknown;
  readonly workflowSource?: unknown;
}

type AddonPackageModule = Readonly<Record<string, unknown>>;

export type AddonPackageLoader = () => Promise<AddonPackageModule>;

interface BoundaryAddonPackageEntrypoints {
  readonly builtEntrypoint: URL;
  readonly sourceEntrypoint: URL;
  readonly importOrder: readonly URL[];
}

interface BoundaryAsyncNodeAddonResolveInput
  extends BoundaryNodeAddonResolveInputBase {
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}

interface BoundarySyncNodeAddonResolveInput
  extends BoundaryNodeAddonResolveInputBase {
  readonly thirdPartyResolvers?: readonly NodeAddonPayloadResolver[];
}

function isMissingPackageEntrypoint(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as Readonly<Record<string, unknown>>;
  const code = typeof record["code"] === "string" ? record["code"] : undefined;
  const message =
    typeof record["message"] === "string" ? record["message"] : String(error);
  return (
    code === "ERR_MODULE_NOT_FOUND" ||
    code === "MODULE_NOT_FOUND" ||
    code === "ENOENT" ||
    message.includes("Cannot find module") ||
    message.includes("Module not found")
  );
}

async function importAddonPackageEntrypoint(
  packageEntryUrl: URL,
): Promise<AddonPackageModule> {
  return (await import(packageEntryUrl.href)) as AddonPackageModule;
}

export function createBoundaryAddonPackageLoader(input: {
  readonly builtEntrypoint: URL;
  readonly sourceEntrypoint: URL;
  readonly importOrder?: readonly URL[];
  readonly fallbackModule?: AddonPackageModule;
  readonly fallbackLoader?: AddonPackageLoader;
}): AddonPackageLoader {
  return async () => {
    const importOrder = input.importOrder ?? [
      input.builtEntrypoint,
      input.sourceEntrypoint,
    ];

    for (const [index, entrypoint] of importOrder.entries()) {
      try {
        return await importAddonPackageEntrypoint(entrypoint);
      } catch (error: unknown) {
        const isLastEntrypoint = index === importOrder.length - 1;
        if (
          isLastEntrypoint &&
          input.fallbackModule !== undefined &&
          isMissingPackageEntrypoint(error)
        ) {
          return input.fallbackModule;
        }
        if (
          isLastEntrypoint &&
          input.fallbackLoader !== undefined &&
          isMissingPackageEntrypoint(error)
        ) {
          return await input.fallbackLoader();
        }
        if (isLastEntrypoint || !isMissingPackageEntrypoint(error)) {
          throw error;
        }
      }
    }

    throw new Error("add-on package loader has no entrypoints");
  };
}

async function importBundledAddonPackage(): Promise<AddonPackageModule> {
  return (await import("rielflow-addons")) as AddonPackageModule;
}

export function resolveDefaultBoundaryAddonPackageEntrypoints(
  entrypointUrl: URL,
): BoundaryAddonPackageEntrypoints {
  const pathname = entrypointUrl.pathname.replaceAll("\\", "/");
  const isSourceTreeEntrypoint = pathname.includes("/packages/rielflow/src/");
  const packageBaseUrl = pathname.includes("/packages/rielflow/dist/")
    ? new URL("../../rielflow-addons/", entrypointUrl)
    : isSourceTreeEntrypoint
      ? new URL("../../../rielflow-addons/", entrypointUrl)
      : pathname.includes("/dist/")
        ? new URL("../packages/rielflow-addons/", entrypointUrl)
        : new URL("packages/rielflow-addons/", entrypointUrl);
  const builtEntrypoint = new URL("dist/index.js", packageBaseUrl);
  const sourceEntrypoint = new URL("src/index.ts", packageBaseUrl);

  return {
    builtEntrypoint,
    sourceEntrypoint,
    importOrder: isSourceTreeEntrypoint
      ? [sourceEntrypoint, builtEntrypoint]
      : [builtEntrypoint, sourceEntrypoint],
  };
}

const loadDefaultBoundaryAddonPackage = createBoundaryAddonPackageLoader({
  ...resolveDefaultBoundaryAddonPackageEntrypoints(new URL(import.meta.url)),
  fallbackLoader: importBundledAddonPackage,
});

export async function loadBoundaryAddonPackage(
  loader: AddonPackageLoader = loadDefaultBoundaryAddonPackage,
): Promise<AddonPackageModule> {
  try {
    return await loader();
  } catch (error: unknown) {
    const reason = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`unable to load add-on package${reason}`);
  }
}

export async function resolveBoundaryNodeAddonPayloadAsync(
  input: BoundaryAsyncNodeAddonResolveInput,
): Promise<NodeAddonResolveResult> {
  const module = await loadBoundaryAddonPackage();
  const resolver = module["resolveNodeAddonPayloadAsync"];
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
