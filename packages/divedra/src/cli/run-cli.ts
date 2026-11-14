import { inferRootDataDirFromExplicitStorageRoots } from "../workflow/paths";
import type {
  CliDependencies,
  CliIo,
  RunCliScopeContext,
} from "./storage-and-options";
import {
  DEFAULT_DEPS,
  DEFAULT_IO,
  normalizeCliPositionals,
  parseWorkflowScopeOption,
} from "./storage-and-options";
import { parseArgs } from "./argument-parser";
import {
  printHelp,
  resolveCliEnv,
  resolveGraphqlCliTransport,
} from "./input-output-helpers";
import {
  runCliCallStepScope,
  runCliEventsScope,
  runCliGraphqlScope,
  runCliHookScope,
  runCliServeScope,
} from "./scoped-command-handlers";
import { runCliWorkflowScope } from "./workflow-command-handler";
import { runCliSessionScope } from "./session-command-handler";

export async function runCli(
  argv: readonly string[],
  io: CliIo = DEFAULT_IO,
  deps: CliDependencies = DEFAULT_DEPS,
): Promise<number> {
  if (argv.includes("--help")) {
    printHelp(io);
    return 0;
  }
  const parsed = parseArgs(argv);
  if (parsed.error !== undefined) {
    io.stderr(parsed.error);
    return 2;
  }
  const positionals = normalizeCliPositionals(parsed.positionals);
  const [scope, command, target] = positionals;
  const env = resolveCliEnv(deps);
  const envWorkflowScope = env["DIVEDRA_WORKFLOW_SCOPE"];
  if (
    parsed.options.workflowScope === undefined &&
    envWorkflowScope !== undefined &&
    envWorkflowScope.length > 0 &&
    parseWorkflowScopeOption(envWorkflowScope) === undefined
  ) {
    io.stderr(
      `invalid DIVEDRA_WORKFLOW_SCOPE value '${envWorkflowScope}'; expected auto, project, or user`,
    );
    return 2;
  }
  const inferredRootDataDir = inferRootDataDirFromExplicitStorageRoots({
    ...(parsed.options.artifactRoot === undefined
      ? {}
      : { artifactRoot: parsed.options.artifactRoot }),
    ...(parsed.options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: parsed.options.sessionStoreRoot }),
  });

  const sharedOptions = {
    ...(parsed.options.workflowRoot === undefined
      ? {}
      : { workflowRoot: parsed.options.workflowRoot }),
    ...(parsed.options.workflowScope === undefined
      ? {}
      : { workflowScope: parsed.options.workflowScope }),
    ...(parsed.options.userRoot === undefined
      ? {}
      : { userRoot: parsed.options.userRoot }),
    ...(parsed.options.projectRoot === undefined
      ? {}
      : { projectRoot: parsed.options.projectRoot }),
    ...(parsed.options.addonRoot === undefined
      ? {}
      : { addonRoot: parsed.options.addonRoot }),
    ...(parsed.options.artifactRoot === undefined
      ? {}
      : { artifactRoot: parsed.options.artifactRoot }),
    ...(inferredRootDataDir === undefined
      ? {}
      : { rootDataDir: inferredRootDataDir }),
    ...(parsed.options.sessionStoreRoot === undefined
      ? {}
      : { sessionStoreRoot: parsed.options.sessionStoreRoot }),
    ...(deps.nodeAddons === undefined ? {} : { nodeAddons: deps.nodeAddons }),
    ...(deps.asyncNodeAddonResolvers === undefined
      ? {}
      : { asyncNodeAddonResolvers: deps.asyncNodeAddonResolvers }),
    ...(deps.nodeAddonResolvers === undefined
      ? {}
      : { nodeAddonResolvers: deps.nodeAddonResolvers }),
    env,
  };
  const graphqlCliTransport = resolveGraphqlCliTransport(
    parsed.options,
    env,
    deps,
  );

  const runCliContext: RunCliScopeContext = {
    parsed,
    positionals,
    scope,
    command,
    target,
    env,
    sharedOptions,
    graphqlCliTransport,
    deps,
    io,
  };

  if (scope === "gql" || scope === "graphql") {
    return runCliGraphqlScope(runCliContext);
  }

  if (scope === "hook") {
    return runCliHookScope(runCliContext);
  }

  if (scope === "events") {
    return runCliEventsScope(runCliContext);
  }

  if (scope === "serve") {
    return runCliServeScope(runCliContext);
  }

  if (scope === "call-step") {
    return runCliCallStepScope(runCliContext);
  }

  if (scope === undefined || command === undefined) {
    io.stderr("scope and command are required");
    printHelp(io);
    return 2;
  }
  if (
    target === undefined &&
    !(scope === "workflow" && (command === "list" || command === "usage"))
  ) {
    io.stderr("scope, command, and target are required");
    printHelp(io);
    return 2;
  }

  if (
    parsed.options.output === "table" &&
    !(scope === "workflow" && (command === "list" || command === "status"))
  ) {
    io.stderr(
      "`--output table` is only supported for workflow list and workflow status",
    );
    return 2;
  }

  if (scope === "workflow") {
    return runCliWorkflowScope(runCliContext);
  }

  if (scope === "session") {
    return runCliSessionScope(runCliContext);
  }

  io.stderr(`unknown scope: ${scope}`);
  printHelp(io);
  return 1;
}
