import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly workspaces?: readonly string[];
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
}

interface PackageRootImport {
  readonly filePath: string;
  readonly specifier: string;
}

interface DeclarationReference {
  readonly filePath: string;
  readonly specifier: string;
}

interface PackageDeclarationDependencyReference {
  readonly filePath: string;
  readonly dependencyName: string;
  readonly specifier: string;
}

type AdapterExecutionErrorConstructor = new (
  code: "provider_error" | "timeout" | "invalid_output" | "policy_blocked",
  message: string,
) => Error;

type NormalizeAdapterFailure = (
  error: unknown,
  fallbackMessage: string,
) => Error;

const TEMPORARY_COMPATIBILITY_ROOT_IMPORTS = {
  "packages/divedra-core/src/adapter-contracts.ts": [
    "../../../src/workflow/adapter",
    "../../../src/workflow/json-boundary",
    "../../../src/workflow/types",
  ],
  "packages/divedra/src/cli/argument-parser.ts": [
    "../../../../src/workflow/types",
  ],
  "packages/divedra/src/cli/input-output-helpers.ts": [
    "../../../../src/graphql/client",
    "../../../../src/workflow/auto-improve-policy",
    "../../../../src/workflow/communication-service",
    "../../../../src/workflow/engine",
    "../../../../src/workflow/node-patches",
    "../../../../src/workflow/runtime-db",
    "../../../../src/workflow/scenario-adapter",
    "../../../../src/workflow/session",
    "../../../../src/workflow/session-health",
    "../../../../src/workflow/session-store",
    "../../../../src/workflow/supervisor-progress-renderer",
    "../../../../src/workflow/working-directory",
  ],
  "packages/divedra/src/cli/run-cli.ts": ["../../../../src/workflow/paths"],
  "packages/divedra/src/cli/scoped-command-handlers.ts": [
    "../../../../src/events",
    "../../../../src/events/manual-emit",
    "../../../../src/events/receipt-ops",
    "../../../../src/graphql/client",
    "../../../../src/hook/config",
    "../../../../src/hook/detect-vendor",
    "../../../../src/hook/index",
    "../../../../src/workflow/call-step",
    "../../../../src/workflow/catalog",
    "../../../../src/workflow/runtime-db",
    "../../../../src/workflow/scenario-adapter",
    "../../../../src/workflow/types",
  ],
  "packages/divedra/src/cli/session-command-handler.ts": [
    "../../../../src/workflow/engine",
    "../../../../src/workflow/inspect",
    "../../../../src/workflow/runtime-db",
    "../../../../src/workflow/scenario-adapter",
    "../../../../src/workflow/session-health",
    "../../../../src/workflow/session-store",
  ],
  "packages/divedra/src/cli/storage-and-options.ts": [
    "../../../../src/events/listener-service",
    "../../../../src/hook/index",
    "../../../../src/hook/types",
    "../../../../src/server/serve",
    "../../../../src/workflow/auto-improve-policy",
    "../../../../src/workflow/communication-service",
    "../../../../src/workflow/inspect",
    "../../../../src/workflow/load",
    "../../../../src/workflow/paths",
    "../../../../src/workflow/runtime-db",
    "../../../../src/workflow/session",
    "../../../../src/workflow/types",
  ],
  "packages/divedra/src/cli/workflow-command-handler.ts": [
    "../../../../src/workflow/addon-source-summary",
    "../../../../src/workflow/checkout",
    "../../../../src/workflow/create",
    "../../../../src/workflow/engine",
    "../../../../src/workflow/inspect",
    "../../../../src/workflow/load",
    "../../../../src/workflow/overview",
    "../../../../src/workflow/scenario-adapter",
    "../../../../src/workflow/usage",
    "../../../../src/workflow/validate",
  ],
  "packages/divedra/src/cli/workflow-graphql-formatters.ts": [
    "../../../../src/shared/ui-contract",
    "../../../../src/workflow/auto-improve-policy",
    "../../../../src/workflow/call-step",
    "../../../../src/workflow/catalog",
    "../../../../src/workflow/engine",
    "../../../../src/workflow/load",
    "../../../../src/workflow/overview",
    "../../../../src/workflow/types",
    "../../../../src/workflow/usage",
    "../../../../src/workflow/working-directory",
  ],
  "packages/divedra/src/index.ts": [
    "../../../src/events/dispatch-supervisor-chat",
    "../../../src/graphql/client",
    "../../../src/graphql/schema",
    "../../../src/graphql/types",
    "../../../src/server/api",
    "../../../src/server/graphql",
    "../../../src/server/serve",
    "../../../src/workflow/scenario-adapter",
    "../../../src/workflow/session-health",
  ],
  "packages/divedra/src/lib-continuation.ts": [
    "../../../src/workflow/scenario-adapter",
  ],
  "packages/divedra/src/lib-sessions.ts": ["../../../src/shared/ui-contract"],
  "packages/divedra/src/lib-step-runs.ts": [
    "../../../src/workflow/history-continuation",
  ],
  "packages/divedra/src/lib-workflow-run-options.ts": [
    "../../../src/workflow/scenario-adapter",
  ],
  "packages/divedra-core/src/index.ts": [
    "../../../src/shared/fs",
    "../../../src/workflow/adapter",
    "../../../src/workflow/auto-improve-policy",
    "../../../src/workflow/call-step",
    "../../../src/workflow/catalog",
    "../../../src/workflow/communication-service",
    "../../../src/workflow/engine",
    "../../../src/workflow/inspect",
    "../../../src/workflow/json-boundary",
    "../../../src/workflow/load",
    "../../../src/workflow/manager-control",
    "../../../src/workflow/manager-message-service",
    "../../../src/workflow/manager-session-store",
    "../../../src/workflow/mutable-workspace",
    "../../../src/workflow/node-execution-mailbox",
    "../../../src/workflow/node-patches",
    "../../../src/workflow/runtime-db",
    "../../../src/workflow/session",
    "../../../src/workflow/session-store",
    "../../../src/workflow/superviser",
    "../../../src/workflow/superviser-control",
    "../../../src/workflow/supervisor-client",
    "../../../src/workflow/supervisor-dispatch-client",
    "../../../src/workflow/supervisor-graphql-client",
    "../../../src/workflow/supervisor-progress-renderer",
    "../../../src/workflow/supervisor-runner-pool",
    "../../../src/workflow/types",
    "../../../src/workflow/usage",
    "../../../src/workflow/validate/node-validation-result",
    "../../../src/workflow/visualization",
    "../../../src/workflow/working-directory",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;

async function readManifest(relativePath: string): Promise<PackageManifest> {
  const content = await readFile(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
  return JSON.parse(content) as PackageManifest;
}

async function collectTypeScriptFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(relativePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }

  return files;
}

async function collectPackageSourceFiles(): Promise<string[]> {
  const packageEntries = await readdir(path.join(process.cwd(), "packages"), {
    withFileTypes: true,
  });
  const packageSourceFiles = await Promise.all(
    packageEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        collectTypeScriptFiles(path.posix.join("packages", entry.name, "src")),
      ),
  );

  return packageSourceFiles.flat().sort((a, b) => a.localeCompare(b));
}

async function collectWorkspacePackageNames(): Promise<string[]> {
  const packageEntries = await readdir(path.join(process.cwd(), "packages"), {
    withFileTypes: true,
  });
  const manifests = await Promise.all(
    packageEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        return readManifest(
          path.posix.join("packages", entry.name, "package.json"),
        );
      }),
  );

  return manifests
    .map((manifest) => manifest.name)
    .sort((a, b) => a.localeCompare(b));
}

function getLockfileWorkspaceSection(lockfile: string): string {
  const workspacesStart = lockfile.indexOf('  "workspaces": {');
  const packagesStart = lockfile.indexOf('  "packages": {');
  if (workspacesStart === -1 || packagesStart === -1) {
    throw new Error(
      "bun.lock is missing the expected workspaces/packages sections",
    );
  }

  return lockfile.slice(workspacesStart, packagesStart);
}

function collectLockWorkspacePackageNames(lockfile: string): string[] {
  return Array.from(
    getLockfileWorkspaceSection(lockfile).matchAll(
      /"packages\/[^"]+":\s*\{[^}]*"name":\s*"(?<packageName>[^"]+)"/gsu,
    ),
    (match) => match.groups?.["packageName"],
  )
    .filter((packageName): packageName is string => packageName !== undefined)
    .sort((a, b) => a.localeCompare(b));
}

function collectLockPackageEntrypointNames(lockfile: string): string[] {
  const packagesStart = lockfile.indexOf('  "packages": {');
  if (packagesStart === -1) {
    throw new Error("bun.lock is missing the expected packages section");
  }

  return Array.from(
    lockfile
      .slice(packagesStart)
      .matchAll(
        /"(?<packageName>[^"]+)":\s*\["[^"]+@workspace:packages\/[^"]+"\]/gu,
      ),
    (match) => match.groups?.["packageName"],
  )
    .filter((packageName): packageName is string => packageName !== undefined)
    .sort((a, b) => a.localeCompare(b));
}

function collectPackageRootImports(
  filePath: string,
  source: string,
): PackageRootImport[] {
  const imports: PackageRootImport[] = [];
  const importLikePattern =
    /(?:from\s+|import\s*\(\s*|import\s+)["'](?<specifier>[^"']+)["']/gu;

  for (const match of source.matchAll(importLikePattern)) {
    const specifier = match.groups?.["specifier"];
    if (!specifier?.startsWith(".")) {
      continue;
    }
    const resolvedSpecifier = path.posix.normalize(
      path.posix.join(path.posix.dirname(filePath), specifier),
    );
    if (resolvedSpecifier === "src" || resolvedSpecifier.startsWith("src/")) {
      imports.push({ filePath, specifier });
    }
  }

  return imports;
}

function uniqueSortedRootImports(
  imports: readonly PackageRootImport[],
): PackageRootImport[] {
  return Array.from(
    new Map(
      imports.map((rootImport) => [
        `${rootImport.filePath}\0${rootImport.specifier}`,
        rootImport,
      ]),
    ).values(),
  ).sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.specifier.localeCompare(right.specifier),
  );
}

function collectRelativeDeclarationReferences(
  filePath: string,
  source: string,
): DeclarationReference[] {
  const references: DeclarationReference[] = [];
  const declarationReferencePattern =
    /(?:from\s+|import\s*\(\s*)["'](?<specifier>\.[^"']+)["']/gu;

  for (const match of source.matchAll(declarationReferencePattern)) {
    const specifier = match.groups?.["specifier"];
    if (specifier !== undefined) {
      references.push({ filePath, specifier });
    }
  }

  return references;
}

function collectWorkspaceDeclarationDependencyReferences(
  filePath: string,
  source: string,
  workspacePackageNames: readonly string[],
): PackageDeclarationDependencyReference[] {
  const references: PackageDeclarationDependencyReference[] = [];
  const declarationReferencePattern =
    /(?:from\s+|import\s*\(\s*)["'](?<specifier>[^."'][^"']*)["']/gu;

  for (const match of source.matchAll(declarationReferencePattern)) {
    const specifier = match.groups?.["specifier"];
    const dependencyName = workspacePackageNames.find(
      (packageName) =>
        specifier === packageName || specifier?.startsWith(`${packageName}/`),
    );
    if (specifier !== undefined && dependencyName !== undefined) {
      references.push({ filePath, dependencyName, specifier });
    }
  }

  return references;
}

async function resolveDeclarationReference(
  filePath: string,
  specifier: string,
): Promise<string | undefined> {
  const declarationBase = path.join(
    process.cwd(),
    path.dirname(filePath),
    specifier,
  );
  const candidates = specifier.endsWith(".d.ts")
    ? [declarationBase]
    : [`${declarationBase}.d.ts`, path.join(declarationBase, "index.d.ts")];

  for (const candidate of candidates) {
    if ((await stat(candidate).catch(() => undefined))?.isFile() === true) {
      return path.relative(process.cwd(), candidate);
    }
  }

  return undefined;
}

async function collectReachableDeclarationFiles(entrypoint: string): Promise<{
  readonly files: readonly string[];
  readonly missingReferences: readonly DeclarationReference[];
}> {
  const files = new Set<string>();
  const queue = [entrypoint];
  const missingReferences: DeclarationReference[] = [];

  for (const filePath of queue) {
    if (files.has(filePath)) {
      continue;
    }
    files.add(filePath);
    const references = collectRelativeDeclarationReferences(
      filePath,
      await readFile(path.join(process.cwd(), filePath), "utf8"),
    );
    for (const reference of references) {
      const resolved = await resolveDeclarationReference(
        reference.filePath,
        reference.specifier,
      );
      if (resolved === undefined) {
        missingReferences.push(reference);
        continue;
      }
      queue.push(resolved);
    }
  }

  return {
    files: Array.from(files).sort((a, b) => a.localeCompare(b)),
    missingReferences,
  };
}

async function importCopiedPackageEntrypoint(
  packageName: string,
  entrypoint: string,
): Promise<Readonly<Record<string, unknown>>> {
  const modules = await importCopiedPackageEntrypoints([
    { packageName, entrypoint },
  ]);
  const module = modules[packageName];
  if (module === undefined) {
    throw new Error(`failed to import copied package '${packageName}'`);
  }
  return module;
}

async function importCopiedPackageEntrypoints(
  packages: readonly {
    readonly packageName: string;
    readonly entrypoint: string;
  }[],
): Promise<Readonly<Record<string, Readonly<Record<string, unknown>>>>> {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "divedra-package-runtime-"),
  );
  try {
    const nodeModulesDir = path.join(tempDir, "node_modules");
    await mkdir(nodeModulesDir, { recursive: true });
    const copiedPackageNames = new Set(
      packages.map(({ packageName }) => packageName),
    );
    for (const copiedPackageName of copiedPackageNames) {
      await cp(
        path.join(process.cwd(), "packages", copiedPackageName),
        path.join(nodeModulesDir, copiedPackageName),
        { recursive: true },
      );
    }

    const modules: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const packageInput of packages) {
      const entrypointUrl = pathToFileURL(
        path.join(
          nodeModulesDir,
          packageInput.packageName,
          packageInput.entrypoint,
        ),
      ).href;
      modules[packageInput.packageName] = (await import(
        entrypointUrl
      )) as Readonly<Record<string, unknown>>;
    }
    return modules;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function importRepositoryModule(
  relativePath: string,
): Promise<Readonly<Record<string, unknown>>> {
  return (await import(
    pathToFileURL(path.join(process.cwd(), relativePath)).href
  )) as Readonly<Record<string, unknown>>;
}

function sortedExportKeys(module: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(module).sort();
}

describe("package boundaries", () => {
  test("root package is a private Bun workspace orchestrator", async () => {
    const manifest = await readManifest("package.json");

    expect(manifest.name).toBe("divedra-workspace");
    expect(manifest.private).toBe(true);
    expect(manifest.workspaces).toEqual(["packages/*"]);
  });

  test("compatibility package preserves the divedra library and cli exports", async () => {
    const manifest = await readManifest("packages/divedra/package.json");

    expect(manifest.name).toBe("divedra");
    expect(manifest.main).toBe("dist/lib.js");
    expect(manifest.module).toBe("dist/lib.js");
    expect(manifest.types).toBe("dist/lib.d.ts");
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([".", "./cli"]);
    expect(manifest.exports?.["./cli"]).toEqual({
      types: "./dist/cli.d.ts",
      import: "./dist/cli.js",
      default: "./dist/cli.js",
    });
    expect(manifest.dependencies?.["divedra-core"]).toBe("workspace:*");
    expect(manifest.dependencies?.["divedra-addons"]).toBe("workspace:*");
    expect(manifest.dependencies?.["divedra-events"]).toBe("workspace:*");
    expect(manifest.dependencies?.["divedra-graphql"]).toBe("workspace:*");
    expect(manifest.dependencies?.["divedra-hook"]).toBe("workspace:*");
    expect(manifest.dependencies?.["divedra-server"]).toBe("workspace:*");
  });

  test("bun lockfile tracks every workspace package manifest", async () => {
    const lockfile = await readFile(
      path.join(process.cwd(), "bun.lock"),
      "utf8",
    );
    const workspacePackageNames = await collectWorkspacePackageNames();

    expect(collectLockWorkspacePackageNames(lockfile)).toEqual(
      workspacePackageNames,
    );
    expect(collectLockPackageEntrypointNames(lockfile)).toEqual(
      workspacePackageNames,
    );
  });

  test("core, add-ons, adapters, events, GraphQL, hook, and server packages expose package-local entrypoints", async () => {
    const core = await readManifest("packages/divedra-core/package.json");
    const addons = await readManifest("packages/divedra-addons/package.json");
    const adapters = await readManifest(
      "packages/divedra-adapters/package.json",
    );
    const events = await readManifest("packages/divedra-events/package.json");
    const graphql = await readManifest("packages/divedra-graphql/package.json");
    const hook = await readManifest("packages/divedra-hook/package.json");
    const server = await readManifest("packages/divedra-server/package.json");

    expect(core.name).toBe("divedra-core");
    expect(core.main).toBe("dist/index.js");
    expect(core.types).toBe("dist/index.d.ts");
    expect(addons.name).toBe("divedra-addons");
    expect(addons.main).toBe("dist/index.js");
    expect(addons.types).toBe("dist/index.d.ts");
    expect(addons.dependencies?.["divedra-core"]).toBe("workspace:*");
    expect(adapters.name).toBe("divedra-adapters");
    expect(adapters.main).toBe("dist/index.js");
    expect(adapters.types).toBe("dist/index.d.ts");
    expect(adapters.dependencies?.["divedra-core"]).toBe("workspace:*");
    expect(events.name).toBe("divedra-events");
    expect(events.main).toBe("dist/index.js");
    expect(events.types).toBe("dist/index.d.ts");
    expect(events.dependencies?.["divedra-core"]).toBe("workspace:*");
    expect(Object.keys(events.exports ?? {}).sort()).toEqual([
      ".",
      "./runtime-ports",
      "./types",
    ]);
    expect(graphql.name).toBe("divedra-graphql");
    expect(graphql.main).toBe("dist/index.js");
    expect(graphql.types).toBe("dist/index.d.ts");
    expect(Object.keys(graphql.exports ?? {}).sort()).toEqual([
      ".",
      "./control-plane-service",
      "./dto",
      "./schema-contract",
    ]);
    expect(hook.name).toBe("divedra-hook");
    expect(hook.main).toBe("dist/index.js");
    expect(hook.types).toBe("dist/index.d.ts");
    expect(hook.dependencies?.["divedra-core"]).toBe("workspace:*");
    expect(Object.keys(hook.exports ?? {}).sort()).toEqual([
      ".",
      "./config",
      "./context",
      "./detect-vendor",
      "./dispatch",
      "./handler",
      "./parse",
      "./recorder-contracts",
      "./redaction",
      "./types",
    ]);
    expect(server.name).toBe("divedra-server");
    expect(server.main).toBe("dist/index.js");
    expect(server.types).toBe("dist/index.d.ts");
    expect(Object.keys(server.exports ?? {}).sort()).toEqual([
      ".",
      "./browser-overview",
      "./contracts",
    ]);
  });

  test("built package declarations preserve current compatibility exports", async () => {
    const declarations = await readFile(
      path.join(process.cwd(), "packages/divedra/dist/lib.d.ts"),
      "utf8",
    );

    expect(declarations).toContain("ContinueWorkflowFromHistoryInput");
    expect(declarations).toContain("continueWorkflowFromHistory");
    expect(declarations).toContain("listWorkflowUsage");
    expect(declarations).toContain("WorkflowUsageCatalog");
  });

  test("default test tooling discovers package-local source tests", async () => {
    const testRunner = await readFile(
      path.join(process.cwd(), "scripts/run-bun-tests.sh"),
      "utf8",
    );

    expect(testRunner).toContain("rg --files src scripts packages");
  });

  test("package root imports are limited to temporary compatibility facades", async () => {
    const packageSourceFiles = await collectPackageSourceFiles();
    const rootImports = uniqueSortedRootImports(
      (
        await Promise.all(
          packageSourceFiles.map(async (filePath) =>
            collectPackageRootImports(
              filePath,
              await readFile(path.join(process.cwd(), filePath), "utf8"),
            ),
          ),
        )
      ).flat(),
    );

    const allowedRootImports = uniqueSortedRootImports(
      Object.entries(TEMPORARY_COMPATIBILITY_ROOT_IMPORTS).flatMap(
        ([filePath, specifiers]) =>
          specifiers.map((specifier) => ({ filePath, specifier })),
      ),
    );

    expect(rootImports).toEqual(allowedRootImports);
  });

  test("package root import detection resolves nested relative source paths", () => {
    expect(
      collectPackageRootImports(
        "packages/divedra/src/nested/facade.ts",
        'import { runWorkflow } from "../../../../src/workflow/engine";',
      ),
    ).toEqual([
      {
        filePath: "packages/divedra/src/nested/facade.ts",
        specifier: "../../../../src/workflow/engine",
      },
    ]);
  });

  test("core workflow model ownership does not import runtime side effects", async () => {
    const modelFiles = [
      "packages/divedra-core/src/authored-node.ts",
      "packages/divedra-core/src/authored-workflow.ts",
      "packages/divedra-core/src/json-schema.ts",
      "packages/divedra-core/src/node-template-fields.ts",
      "packages/divedra-core/src/paths.ts",
      "packages/divedra-core/src/prompt-template-context.ts",
      "packages/divedra-core/src/prompt-template-file.ts",
      "packages/divedra-core/src/render.ts",
      "packages/divedra-core/src/runtime-prompt-assets.ts",
      "packages/divedra-core/src/workflow-bundle-input.ts",
      "packages/divedra-core/src/workflow-model.ts",
      "packages/divedra-core/src/workflow-validation.ts",
    ];
    const forbiddenImportFragments = [
      "/engine",
      "/node-addons",
      "/native-node-executor",
      "/node-execution-mailbox",
      "/superviser",
      "/supervisor",
      "/runtime-db",
      "/manager-session",
      "/communication-service",
      "/events",
      "/hook",
      "/server",
      "/graphql",
      "/mailbox",
    ];

    const imports = (
      await Promise.all(
        modelFiles.map(async (filePath) =>
          collectRelativeDeclarationReferences(
            filePath,
            await readFile(path.join(process.cwd(), filePath), "utf8"),
          ),
        ),
      )
    ).flat();

    expect(
      imports.filter((entry) =>
        forbiddenImportFragments.some((fragment) =>
          entry.specifier.includes(fragment),
        ),
      ),
    ).toEqual([]);
  });

  test("package declaration roots are constrained to entrypoint contracts", async () => {
    const packageDeclarationRoots = await Promise.all(
      [
        "divedra",
        "divedra-core",
        "divedra-addons",
        "divedra-adapters",
        "divedra-events",
        "divedra-graphql",
        "divedra-hook",
        "divedra-server",
      ].map(async (packageName) => {
        const distEntries = await readdir(
          path.join(process.cwd(), "packages", packageName, "dist"),
          { withFileTypes: true },
        );
        return {
          packageName,
          declarations: distEntries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b)),
        };
      }),
    );

    expect(packageDeclarationRoots).toEqual([
      {
        packageName: "divedra",
        declarations: [
          "cli.d.ts",
          "lib-continuation.d.ts",
          "lib-sessions.d.ts",
          "lib-step-runs.d.ts",
          "lib-workflow-run-options.d.ts",
          "lib.d.ts",
          "main.d.ts",
        ],
      },
      {
        packageName: "divedra-core",
        declarations: [
          "authored-node.d.ts",
          "authored-workflow.d.ts",
          "index.d.ts",
          "json-schema.d.ts",
          "node-template-fields.d.ts",
          "paths.d.ts",
          "prompt-template-context.d.ts",
          "prompt-template-file.d.ts",
          "render.d.ts",
          "result.d.ts",
          "runtime-prompt-assets.d.ts",
          "workflow-bundle-input.d.ts",
          "workflow-model.d.ts",
          "workflow-validation.d.ts",
        ],
      },
      {
        packageName: "divedra-addons",
        declarations: [
          "addon-source-summary.d.ts",
          "index.d.ts",
          "local-node-addons.d.ts",
          "mailbox-prompt-guidance.d.ts",
          "node-addons.d.ts",
          "runtime-readiness.d.ts",
        ],
      },
      {
        packageName: "divedra-adapters",
        declarations: [
          "anthropic-sdk.d.ts",
          "claude.d.ts",
          "codex.d.ts",
          "cursor.d.ts",
          "dispatch.d.ts",
          "index.d.ts",
          "llm-session-stall-watch.d.ts",
          "local-agent.d.ts",
          "openai-sdk.d.ts",
          "shared.d.ts",
        ],
      },
      {
        packageName: "divedra-events",
        declarations: ["index.d.ts", "runtime-ports.d.ts", "types.d.ts"],
      },
      {
        packageName: "divedra-graphql",
        declarations: [
          "control-plane-service.d.ts",
          "dto.d.ts",
          "index.d.ts",
          "schema-contract.d.ts",
        ],
      },
      {
        packageName: "divedra-hook",
        declarations: [
          "config.d.ts",
          "context.d.ts",
          "detect-vendor.d.ts",
          "dispatch.d.ts",
          "handler.d.ts",
          "index.d.ts",
          "parse.d.ts",
          "recorder-contracts.d.ts",
          "redaction.d.ts",
          "types.d.ts",
        ],
      },
      {
        packageName: "divedra-server",
        declarations: ["browser-overview.d.ts", "contracts.d.ts", "index.d.ts"],
      },
    ]);
  });

  test("built package declaration dependencies are declared in package manifests", async () => {
    const workspacePackageNames = await collectWorkspacePackageNames();
    const dependencyReferences = await Promise.all(
      workspacePackageNames.map(async (packageName) => {
        const packageDir = path.posix.join("packages", packageName);
        const manifest = await readManifest(
          path.posix.join(packageDir, "package.json"),
        );
        const declarationFiles = await collectTypeScriptFiles(
          path.posix.join(packageDir, "dist"),
        );
        const references = (
          await Promise.all(
            declarationFiles.map(async (filePath) =>
              collectWorkspaceDeclarationDependencyReferences(
                filePath,
                await readFile(path.join(process.cwd(), filePath), "utf8"),
                workspacePackageNames,
              ),
            ),
          )
        )
          .flat()
          .filter((reference) => reference.dependencyName !== packageName);

        return {
          packageName,
          referencedDependencies: Array.from(
            new Set(references.map((reference) => reference.dependencyName)),
          ).sort((a, b) => a.localeCompare(b)),
          declaredDependencies: Object.keys(manifest.dependencies ?? {}).sort(
            (a, b) => a.localeCompare(b),
          ),
        };
      }),
    );

    expect(
      dependencyReferences.map(
        ({ packageName, referencedDependencies, declaredDependencies }) => ({
          packageName,
          missingDependencies: referencedDependencies.filter(
            (dependencyName) => !declaredDependencies.includes(dependencyName),
          ),
        }),
      ),
    ).toEqual(
      workspacePackageNames.map((packageName) => ({
        packageName,
        missingDependencies: [],
      })),
    );
  });

  test("events and hook packages own contracts without root source imports", async () => {
    const contractFiles = [
      "packages/divedra-events/src/runtime-ports.ts",
      "packages/divedra-events/src/types.ts",
      "packages/divedra-hook/src/config.ts",
      "packages/divedra-hook/src/context.ts",
      "packages/divedra-hook/src/detect-vendor.ts",
      "packages/divedra-hook/src/dispatch.ts",
      "packages/divedra-hook/src/handler.ts",
      "packages/divedra-hook/src/parse.ts",
      "packages/divedra-hook/src/recorder-contracts.ts",
      "packages/divedra-hook/src/redaction.ts",
      "packages/divedra-hook/src/types.ts",
    ];
    const rootImports = uniqueSortedRootImports(
      (
        await Promise.all(
          contractFiles.map(async (filePath) =>
            collectPackageRootImports(
              filePath,
              await readFile(path.join(process.cwd(), filePath), "utf8"),
            ),
          ),
        )
      ).flat(),
    );

    expect(rootImports).toEqual([]);
  });

  test("add-ons package dist declarations resolve package-owned references", async () => {
    const { files: declarationFiles, missingReferences } =
      await collectReachableDeclarationFiles(
        "packages/divedra-addons/dist/index.d.ts",
      );

    expect(declarationFiles).toEqual(
      [
        "packages/divedra-addons/dist/addon-source-summary.d.ts",
        "packages/divedra-addons/dist/index.d.ts",
        "packages/divedra-addons/dist/local-node-addons.d.ts",
        "packages/divedra-addons/dist/mailbox-prompt-guidance.d.ts",
        "packages/divedra-addons/dist/native-node-executor/git-and-addon-execution.d.ts",
        "packages/divedra-addons/dist/native-node-executor/template-env-and-containers.d.ts",
        "packages/divedra-addons/dist/node-addons.d.ts",
        "packages/divedra-addons/dist/node-addons/addon-constants-and-agent-config.d.ts",
        "packages/divedra-addons/dist/node-addons/addon-payload-resolution.d.ts",
        "packages/divedra-addons/dist/node-addons/gateway-and-git-config.d.ts",
        "packages/divedra-addons/dist/runtime-readiness.d.ts",
      ].sort((a, b) => a.localeCompare(b)),
    );
    expect(missingReferences).toEqual([]);

    const leakedSourceImports = (
      await Promise.all(
        declarationFiles.map(async (filePath) => ({
          filePath,
          source: await readFile(path.join(process.cwd(), filePath), "utf8"),
        })),
      )
    ).filter(({ source }) => source.includes("divedra-core/src"));

    expect(leakedSourceImports).toEqual([]);
  });

  test("core async add-on boundary delegates third-party resolver normalization to add-ons package", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/workflow/addon-package-boundary.ts"),
      "utf8",
    );
    const asyncBoundaryStart = source.indexOf(
      "export async function resolveBoundaryNodeAddonPayloadAsync",
    );
    const syncBoundaryStart = source.indexOf(
      "export function resolveBoundaryNodeAddonPayloadSync",
    );

    expect(asyncBoundaryStart).toBeGreaterThanOrEqual(0);
    expect(syncBoundaryStart).toBeGreaterThan(asyncBoundaryStart);

    const asyncBoundarySource = source.slice(
      asyncBoundaryStart,
      syncBoundaryStart,
    );
    expect(asyncBoundarySource).toContain("loadBoundaryAddonPackage");
    expect(asyncBoundarySource).toContain("resolveNodeAddonPayloadAsync");
    expect(asyncBoundarySource).not.toContain(
      "for (const resolver of input.thirdPartyResolvers",
    );
  });

  test("adapters package dist declarations resolve package-owned references", async () => {
    const { files: declarationFiles, missingReferences } =
      await collectReachableDeclarationFiles(
        "packages/divedra-adapters/dist/index.d.ts",
      );

    expect(declarationFiles).toEqual(
      [
        "packages/divedra-adapters/dist/anthropic-sdk.d.ts",
        "packages/divedra-adapters/dist/claude.d.ts",
        "packages/divedra-adapters/dist/codex.d.ts",
        "packages/divedra-adapters/dist/cursor.d.ts",
        "packages/divedra-adapters/dist/dispatch.d.ts",
        "packages/divedra-adapters/dist/index.d.ts",
        "packages/divedra-adapters/dist/llm-session-stall-watch.d.ts",
        "packages/divedra-adapters/dist/openai-sdk.d.ts",
        "packages/divedra-adapters/dist/shared.d.ts",
      ].sort((a, b) => a.localeCompare(b)),
    );
    expect(missingReferences).toEqual([]);

    const leakedSourceImports = (
      await Promise.all(
        declarationFiles.map(async (filePath) => ({
          filePath,
          source: await readFile(path.join(process.cwd(), filePath), "utf8"),
        })),
      )
    ).filter(({ source }) => source.includes("divedra-core/src"));

    expect(leakedSourceImports).toEqual([]);
  });

  test("workspace does not create an unverified provisioning package", async () => {
    const packageEntries = await readdir(path.join(process.cwd(), "packages"), {
      withFileTypes: true,
    });

    expect(
      packageEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => name.includes("provision"))
        .sort(),
    ).toEqual([]);
  });

  test("source package facades preserve their documented public contracts", async () => {
    const compatibility = await importRepositoryModule(
      "packages/divedra/src/index.ts",
    );
    const rootLibrary = await importRepositoryModule("src/lib.ts");
    expect(sortedExportKeys(compatibility)).toEqual(
      sortedExportKeys(rootLibrary),
    );

    const addons = await importRepositoryModule(
      "packages/divedra-addons/src/index.ts",
    );
    const sourceNodeAddons = await importRepositoryModule(
      "src/workflow/node-addons.ts",
    );
    const sourceLocalNodeAddons = await importRepositoryModule(
      "src/workflow/local-node-addons.ts",
    );
    const sourceAddonSummaries = await importRepositoryModule(
      "src/workflow/addon-source-summary.ts",
    );
    const sourceMailboxGuidance = await importRepositoryModule(
      "src/workflow/mailbox-prompt-guidance.ts",
    );
    expect(sortedExportKeys(addons)).toEqual(
      [
        ...sortedExportKeys(sourceNodeAddons),
        ...sortedExportKeys(sourceLocalNodeAddons),
        ...sortedExportKeys(sourceAddonSummaries),
        ...sortedExportKeys(sourceMailboxGuidance),
        "executeAddonNode",
        "executeNativeNode",
        "isGatewayReadinessAddon",
      ].sort(),
    );

    const adapters = await importRepositoryModule(
      "packages/divedra-adapters/src/index.ts",
    );
    const sourceDispatch = await importRepositoryModule(
      "src/workflow/adapters/dispatch.ts",
    );
    expect(typeof adapters["DispatchingNodeAdapter"]).toBe("function");
    expect(adapters["DispatchingNodeAdapter"]).toBe(
      sourceDispatch["DispatchingNodeAdapter"],
    );
  });

  test("core source facade stays within the core runtime contract", async () => {
    const core = await importRepositoryModule(
      "packages/divedra-core/src/index.ts",
    );

    expect(sortedExportKeys(core)).toEqual([
      "AdapterExecutionError",
      "NODE_TEMPLATE_FIELD_SPECS",
      "NodeValidationResult",
      "SUPERVISION_STALL_ERROR_PREFIX",
      "applyWorkflowNodePatch",
      "applyWorkflowNodePatchToRawPayloads",
      "atomicWriteJsonFile",
      "atomicWriteTextFile",
      "buildFanoutGroupSummaries",
      "buildInspectionSummary",
      "buildMutableWorkflowWorkspace",
      "buildPromptTemplateVariables",
      "buildSupervisionStallWatch",
      "buildWorkflowUsageCatalog",
      "buildWorkflowUsageSummary",
      "callStep",
      "createCommunicationService",
      "createExecutionCopyMutableWorkspace",
      "createLifecycleSupervisionPolicyInput",
      "createManagerMessageService",
      "createManagerSessionStore",
      "createSupervisorProgressEventSink",
      "createSupervisorProgressRenderer",
      "createSupervisorRunnerPool",
      "createWorkflowSupervisorClient",
      "createWorkflowSupervisorDispatchClient",
      "createWorkflowSupervisorGraphqlClient",
      "deriveWorkflowVisualization",
      "describeSuperviserControlAddon",
      "err",
      "executeSuperviserControlNativeOperation",
      "getEngineSupervisionPatcherId",
      "getSuperviserControlAddonProviderOperationId",
      "getSupervisionSummary",
      "hasInvalidNodeValidationResult",
      "hashManagerAuthToken",
      "isSuperviserControlAddonName",
      "isSupervisionStallLastError",
      "listEventReplyDispatchesFromRuntimeDb",
      "listNodeTemplateFieldContainers",
      "listRuntimeHookEvents",
      "listRuntimeLlmSessionMessages",
      "listRuntimeNodeExecutions",
      "listRuntimeNodeLogs",
      "listRuntimeSessions",
      "listSessions",
      "listWorkflowCatalogSources",
      "loadSession",
      "loadWorkflowFromCatalog",
      "loadWorkflowFromDisk",
      "mergeLoadOptionsForSessionMutableBundle",
      "noopWorkflowRunEventSink",
      "normalizeOutputContractEnvelope",
      "normalizeSessionState",
      "normalizeTextBusinessPayload",
      "normalizeWorkflowNodePatchMap",
      "normalizeWorkflowWorkingDirectoryOverride",
      "ok",
      "parseJsonObjectCandidate",
      "parseManagerControlActions",
      "parseManagerControlPayload",
      "planSupervisionRemediation",
      "postDispatchSupervisorConversationThroughGraphql",
      "readWorkflowNodePatch",
      "readWorkflowPatchRevisionsFromArtifact",
      "recordWorkflowPatchRevision",
      "renderPromptTemplate",
      "resolveAddonSource",
      "resolveAmbientManagerExecutionContext",
      "resolveCurrentStepId",
      "resolveCurrentStepIdFromWorkflow",
      "resolveNodeExecutionWorkingDirectory",
      "resolveRuntimeDbPath",
      "resolveSupervisionRerunAnchor",
      "resolveSupervisionRerunTarget",
      "resolveWorkflowCreateSource",
      "resolveWorkflowScopeSelector",
      "resolveWorkflowSource",
      "runWorkflow",
      "saveSession",
      "validateJsonSchemaDefinition",
      "validateJsonValueAgainstSchema",
      "verifyManagerAuthToken",
      "withResolvedWorkflowSourceOptions",
    ]);
    expect(core["runCli"]).toBeUndefined();
    expect(core["startServe"]).toBeUndefined();
    expect(core["handleApiRequest"]).toBeUndefined();
    expect(core["createGraphqlSchema"]).toBeUndefined();
    expect(core["createNodeAddonRegistry"]).toBeUndefined();
    expect(core["executeNativeNode"]).toBeUndefined();
  });

  test("core package build does not inline add-on implementation ownership", async () => {
    const coreEntrypoint = [
      await readFile(
        path.join(process.cwd(), "packages/divedra-core/dist/index.js"),
        "utf8",
      ),
      await readFile(
        path.join(process.cwd(), "packages/divedra-core/dist/core-runtime.js"),
        "utf8",
      ),
    ].join("\n");

    expect(coreEntrypoint).not.toContain("GIT_COMMIT_ADDON");
    expect(coreEntrypoint).not.toContain("executeNativeNode");
    expect(coreEntrypoint).not.toContain("createNodeAddonRegistry");
    expect(coreEntrypoint).not.toContain("native-node");
    expect(coreEntrypoint).not.toContain("node-addons");
    expect(coreEntrypoint).not.toContain("divedra/git-commit");
    expect(coreEntrypoint).not.toContain("divedra/git-push");
    expect(coreEntrypoint).not.toContain("divedra/x-gateway");
    expect(coreEntrypoint).not.toContain("divedra/mail-gateway");
    expect(coreEntrypoint).not.toContain("chat-reply-worker");
  });

  test("built package entrypoints import from isolated package copies", async () => {
    const compat = await importCopiedPackageEntrypoint(
      "divedra",
      "dist/lib.js",
    );
    const core = await importCopiedPackageEntrypoint(
      "divedra-core",
      "dist/index.js",
    );
    const addons = await importCopiedPackageEntrypoint(
      "divedra-addons",
      "dist/index.js",
    );
    const copiedAdapterInstall = await importCopiedPackageEntrypoints([
      { packageName: "divedra-core", entrypoint: "dist/index.js" },
      { packageName: "divedra-adapters", entrypoint: "dist/index.js" },
    ]);
    const adapters = copiedAdapterInstall["divedra-adapters"];

    expect(typeof compat["continueWorkflowFromHistory"]).toBe("function");
    expect(typeof core["runWorkflow"]).toBe("function");
    expect(typeof addons["createNodeAddonRegistry"]).toBe("function");
    expect(typeof adapters?.["DispatchingNodeAdapter"]).toBe("function");
  });

  test("built adapter package shares core adapter error identity", async () => {
    const copiedAdapterInstall = await importCopiedPackageEntrypoints([
      { packageName: "divedra-core", entrypoint: "dist/index.js" },
      { packageName: "divedra-adapters", entrypoint: "dist/index.js" },
    ]);
    const core = copiedAdapterInstall["divedra-core"];
    const adapters = copiedAdapterInstall["divedra-adapters"];
    const AdapterExecutionError = core?.[
      "AdapterExecutionError"
    ] as AdapterExecutionErrorConstructor;
    const normalizeAdapterFailure = adapters?.[
      "normalizeAdapterFailure"
    ] as NormalizeAdapterFailure;

    expect(typeof AdapterExecutionError).toBe("function");
    expect(typeof normalizeAdapterFailure).toBe("function");

    const existingError = new AdapterExecutionError(
      "provider_error",
      "provider failed",
    );
    expect(normalizeAdapterFailure(existingError, "fallback")).toBe(
      existingError,
    );
    expect(
      normalizeAdapterFailure(new Error("failed"), "fallback"),
    ).toBeInstanceOf(AdapterExecutionError);
  });

  test("built cli subpath is import-safe", async () => {
    const beforeExitCode = process.exitCode;
    const stdoutWrite = process.stdout.write;
    const stderrWrite = process.stderr.write;
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const cli = (await import(
        pathToFileURL(path.join(process.cwd(), "packages/divedra/dist/cli.js"))
          .href
      )) as Readonly<Record<string, unknown>>;
      expect(typeof cli["runCli"]).toBe("function");
      expect(process.exitCode).toBe(beforeExitCode);
      expect(writes.join("")).toBe("");
    } finally {
      process.stdout.write = stdoutWrite;
      process.stderr.write = stderrWrite;
    }
  });
});
