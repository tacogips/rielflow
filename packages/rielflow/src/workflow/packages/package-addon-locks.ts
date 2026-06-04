import path from "node:path";
import type { WorkflowCheckoutScope } from "../checkout";
import type {
  DirectExecutableAddonGrant,
  ResolvedWorkflowSource,
} from "../types";
import type { WorkflowPackageDependencyInstallResult } from "./types";

export function addonDependencyLocksFromDependencies(
  dependencies: readonly WorkflowPackageDependencyInstallResult[],
): readonly DirectExecutableAddonGrant[] {
  return dependencies
    .filter(
      (
        dependency,
      ): dependency is WorkflowPackageDependencyInstallResult & {
        readonly packageKind: "node-addon";
        readonly addons: NonNullable<
          WorkflowPackageDependencyInstallResult["addons"]
        >;
      } =>
        dependency.packageKind === "node-addon" &&
        dependency.addons !== undefined &&
        dependency.addons.length > 0,
    )
    .map((dependency) => ({
      packageId: dependency.packageId,
      registry: dependency.registryUrl,
      branch: dependency.registryRef,
      kind: "node-addon" as const,
      addons: dependency.addons,
    }));
}

export function workflowPackageValidationSource(input: {
  readonly scope: WorkflowCheckoutScope;
  readonly workflowRoot: string;
  readonly workflowName: string;
  readonly scopeRoot: string;
}): ResolvedWorkflowSource {
  return {
    scope: input.scope,
    workflowRoot: input.workflowRoot,
    workflowName: input.workflowName,
    workflowDirectory: path.join(input.workflowRoot, input.workflowName),
    scopeRoot: input.scopeRoot,
  };
}
