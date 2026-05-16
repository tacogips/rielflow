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

interface BoundaryNodeAddonResolveInputBase extends NodeAddonResolveInput {
  readonly options?: unknown;
  readonly workflowSource?: unknown;
}

type AddonPackageModule = Readonly<Record<string, unknown>>;

export type AddonPackageLoader = () => Promise<AddonPackageModule>;

interface BoundaryAddonPackageEntrypoints {
  readonly builtEntrypoint: URL;
  readonly sourceEntrypoint: URL;
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
}): AddonPackageLoader {
  return async () => {
    try {
      return await importAddonPackageEntrypoint(input.builtEntrypoint);
    } catch (error: unknown) {
      if (!isMissingPackageEntrypoint(error)) {
        throw error;
      }
      return await importAddonPackageEntrypoint(input.sourceEntrypoint);
    }
  };
}

export function resolveDefaultBoundaryAddonPackageEntrypoints(
  entrypointUrl: URL,
): BoundaryAddonPackageEntrypoints {
  const pathname = entrypointUrl.pathname.replaceAll("\\", "/");
  const packageBaseUrl = pathname.includes("/packages/divedra/dist/")
    ? new URL("../../divedra-addons/", entrypointUrl)
    : pathname.includes("/dist/")
      ? new URL("../packages/divedra-addons/", entrypointUrl)
      : new URL("../../packages/divedra-addons/", entrypointUrl);

  return {
    builtEntrypoint: new URL("dist/index.js", packageBaseUrl),
    sourceEntrypoint: new URL("src/index.ts", packageBaseUrl),
  };
}

const loadDefaultBoundaryAddonPackage = createBoundaryAddonPackageLoader(
  resolveDefaultBoundaryAddonPackageEntrypoints(new URL(import.meta.url)),
);

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
