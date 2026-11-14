import type { RunCliScopeContext } from "./storage-and-options";
import { runCliWorkflowPackageScope } from "./workflow-package-command-handler";

export async function runCliWorkflowRegistryScope(
  context: RunCliScopeContext,
): Promise<number> {
  const { io, positionals, target } = context;
  if (target !== "list") {
    io.stderr("workflow registry supports: list");
    return 2;
  }
  if (positionals.length > 3) {
    io.stderr("workflow registry list accepts no positional arguments");
    return 2;
  }
  return await runCliWorkflowPackageScope({
    ...context,
    command: "package",
    target: "registry",
    positionals: [positionals[0] ?? "workflow", "package", "registry", "list"],
  });
}
