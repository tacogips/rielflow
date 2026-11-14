import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const rootDistDir = path.join(rootDir, "dist");

interface DeclarationExportContract {
  readonly source: string;
  readonly target: string;
  readonly rewriteRootSourceImports?: boolean;
  readonly rewritePackageSourceImports?: boolean;
}

interface DeclarationSupportContract {
  readonly source: string;
  readonly target: string;
  readonly rewriteRootSourceImports?: boolean;
  readonly rewritePackageSourceImports?: boolean;
}

interface PackageDeclarationContract {
  readonly packageName: string;
  readonly supportSourcePackageName?: string;
  readonly supportDirs: readonly string[];
  readonly supportDeclarations?: readonly DeclarationSupportContract[];
  readonly exports: readonly DeclarationExportContract[];
}

const packageDeclarationContracts: readonly PackageDeclarationContract[] = [
  {
    packageName: "rielflow",
    supportDirs: [
      "cli",
      "events",
      "graphql",
      "hook",
      "server",
      "shared",
      "workflow",
    ],
    supportDeclarations: [
      {
        source: "packages/rielflow/src/lib-continuation.d.ts",
        target: "lib-continuation.d.ts",
        rewriteRootSourceImports: true,
      },
      {
        source: "packages/rielflow/src/lib-sessions.d.ts",
        target: "lib-sessions.d.ts",
        rewriteRootSourceImports: true,
      },
      {
        source: "packages/rielflow/src/lib-step-runs.d.ts",
        target: "lib-step-runs.d.ts",
        rewriteRootSourceImports: true,
      },
      {
        source: "packages/rielflow/src/lib-workflow-run-options.d.ts",
        target: "lib-workflow-run-options.d.ts",
        rewriteRootSourceImports: true,
      },
    ],
    exports: [
      {
        source: "packages/rielflow/src/index.d.ts",
        target: "lib.d.ts",
        rewriteRootSourceImports: true,
      },
      {
        source: "packages/rielflow/src/cli.d.ts",
        target: "cli.d.ts",
        rewriteRootSourceImports: true,
      },
      {
        source: "packages/rielflow/src/bin.d.ts",
        target: "main.d.ts",
        rewriteRootSourceImports: true,
      },
    ],
  },
  {
    packageName: "rielflow-core",
    supportSourcePackageName: "rielflow",
    supportDirs: ["shared", "workflow"],
    supportDeclarations: [
      {
        source: "packages/rielflow-core/src/authored-node.d.ts",
        target: "authored-node.d.ts",
      },
      {
        source: "packages/rielflow-core/src/authored-workflow.d.ts",
        target: "authored-workflow.d.ts",
      },
      {
        source: "packages/rielflow-core/src/json-schema.d.ts",
        target: "json-schema.d.ts",
      },
      {
        source: "packages/rielflow-core/src/node-template-fields.d.ts",
        target: "node-template-fields.d.ts",
      },
      {
        source: "packages/rielflow-core/src/paths.d.ts",
        target: "paths.d.ts",
      },
      {
        source: "packages/rielflow-core/src/prompt-template-file.d.ts",
        target: "prompt-template-file.d.ts",
      },
      {
        source: "packages/rielflow-core/src/prompt-template-context.d.ts",
        target: "prompt-template-context.d.ts",
      },
      {
        source: "packages/rielflow-core/src/render.d.ts",
        target: "render.d.ts",
      },
      {
        source: "packages/rielflow-core/src/result.d.ts",
        target: "result.d.ts",
      },
      {
        source: "packages/rielflow-core/src/runtime-prompt-assets.d.ts",
        target: "runtime-prompt-assets.d.ts",
      },
      {
        source: "packages/rielflow-core/src/workflow-bundle-input.d.ts",
        target: "workflow-bundle-input.d.ts",
      },
      {
        source: "packages/rielflow-core/src/workflow-validation.d.ts",
        target: "workflow-validation.d.ts",
      },
      {
        source: "packages/rielflow-core/src/workflow-model.d.ts",
        target: "workflow-model.d.ts",
      },
    ],
    exports: [
      {
        source: "packages/rielflow-core/src/index.d.ts",
        target: "index.d.ts",
        rewriteRootSourceImports: true,
      },
    ],
  },
  {
    packageName: "rielflow-addons",
    supportDirs: ["shared", "workflow"],
    supportDeclarations: [
      {
        source: "packages/rielflow-addons/src/addon-source-summary.d.ts",
        target: "addon-source-summary.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/local-node-addons.d.ts",
        target: "local-node-addons.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/mailbox-prompt-guidance.d.ts",
        target: "mailbox-prompt-guidance.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/native-node-executor",
        target: "native-node-executor",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/node-addons.d.ts",
        target: "node-addons.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/node-addons",
        target: "node-addons",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-addons/src/runtime-readiness.d.ts",
        target: "runtime-readiness.d.ts",
        rewritePackageSourceImports: true,
      },
    ],
    exports: [
      {
        source: "packages/rielflow-addons/src/index.d.ts",
        target: "index.d.ts",
        rewriteRootSourceImports: true,
        rewritePackageSourceImports: true,
      },
    ],
  },
  {
    packageName: "rielflow-adapters",
    supportDirs: [],
    supportDeclarations: [
      {
        source: "packages/rielflow-adapters/src/anthropic-sdk.d.ts",
        target: "anthropic-sdk.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/claude.d.ts",
        target: "claude.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/codex.d.ts",
        target: "codex.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/cursor.d.ts",
        target: "cursor.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/dispatch.d.ts",
        target: "dispatch.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/llm-session-stall-watch.d.ts",
        target: "llm-session-stall-watch.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/local-agent.d.ts",
        target: "local-agent.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/openai-sdk.d.ts",
        target: "openai-sdk.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/readiness.d.ts",
        target: "readiness.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-adapters/src/shared.d.ts",
        target: "shared.d.ts",
        rewritePackageSourceImports: true,
      },
    ],
    exports: [
      {
        source: "packages/rielflow-adapters/src/index.d.ts",
        target: "index.d.ts",
        rewritePackageSourceImports: true,
      },
    ],
  },
  {
    packageName: "rielflow-events",
    supportDirs: [],
    supportDeclarations: [
      {
        source: "packages/rielflow-events/src/path-resolution.d.ts",
        target: "path-resolution.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-events/src/runtime-ports.d.ts",
        target: "runtime-ports.d.ts",
        rewritePackageSourceImports: true,
      },
      {
        source: "packages/rielflow-events/src/types.d.ts",
        target: "types.d.ts",
        rewritePackageSourceImports: true,
      },
    ],
    exports: [
      {
        source: "packages/rielflow-events/src/index.d.ts",
        target: "index.d.ts",
        rewritePackageSourceImports: true,
      },
    ],
  },
  {
    packageName: "rielflow-graphql",
    supportDirs: [],
    supportDeclarations: [
      {
        source: "packages/rielflow-graphql/src/control-plane-service.d.ts",
        target: "control-plane-service.d.ts",
      },
      {
        source: "packages/rielflow-graphql/src/dto.d.ts",
        target: "dto.d.ts",
      },
      {
        source: "packages/rielflow-graphql/src/schema-contract.d.ts",
        target: "schema-contract.d.ts",
      },
    ],
    exports: [
      {
        source: "packages/rielflow-graphql/src/index.d.ts",
        target: "index.d.ts",
      },
    ],
  },
  {
    packageName: "rielflow-hook",
    supportDirs: [],
    supportDeclarations: [
      {
        source: "packages/rielflow-hook/src/config.d.ts",
        target: "config.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/context.d.ts",
        target: "context.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/detect-vendor.d.ts",
        target: "detect-vendor.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/dispatch.d.ts",
        target: "dispatch.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/handler.d.ts",
        target: "handler.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/parse.d.ts",
        target: "parse.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/recorder-contracts.d.ts",
        target: "recorder-contracts.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/redaction.d.ts",
        target: "redaction.d.ts",
      },
      {
        source: "packages/rielflow-hook/src/types.d.ts",
        target: "types.d.ts",
      },
    ],
    exports: [
      {
        source: "packages/rielflow-hook/src/index.d.ts",
        target: "index.d.ts",
      },
    ],
  },
  {
    packageName: "rielflow-server",
    supportDirs: [],
    supportDeclarations: [
      {
        source: "packages/rielflow-server/src/browser-overview.d.ts",
        target: "browser-overview.d.ts",
      },
      {
        source: "packages/rielflow-server/src/contracts.d.ts",
        target: "contracts.d.ts",
      },
    ],
    exports: [
      {
        source: "packages/rielflow-server/src/index.d.ts",
        target: "index.d.ts",
      },
    ],
  },
];

async function copyIfPresent(source: string, target: string): Promise<void> {
  try {
    await cp(source, target, { recursive: true });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return (await stat(filePath).catch(() => undefined)) !== undefined;
}

async function resolveEmittedDeclarationPath(source: string): Promise<string> {
  const exactPath = path.join(rootDistDir, source);
  if (await pathExists(exactPath)) {
    return exactPath;
  }
  const packageSourceMatch = /^packages\/([^/]+)\/(.+)$/u.exec(source);
  if (packageSourceMatch === null) {
    return exactPath;
  }
  const packageName = packageSourceMatch[1];
  const packageRelativePath = packageSourceMatch[2];
  if (packageName === undefined || packageRelativePath === undefined) {
    return exactPath;
  }
  const packageRootPath = path.join(
    rootDistDir,
    packageName,
    packageRelativePath,
  );
  return (await pathExists(packageRootPath)) ? packageRootPath : exactPath;
}

async function resolvePackageDeclarationSourceDir(
  packageName: string,
): Promise<string> {
  const exactPath = path.join(rootDistDir, "packages", packageName, "src");
  if (await pathExists(exactPath)) {
    return exactPath;
  }
  const packageRootPath = path.join(rootDistDir, packageName, "src");
  return (await pathExists(packageRootPath)) ? packageRootPath : exactPath;
}

async function copyDeclarationSupport(
  packageName: string,
  packageDistDir: string,
  supportDirs: readonly string[],
  supportDeclarations: readonly DeclarationSupportContract[],
  supportSourcePackageName?: string,
): Promise<void> {
  await mkdir(packageDistDir, { recursive: true });
  const packageDistEntries = await readdir(packageDistDir, {
    withFileTypes: true,
  });
  for (const entry of packageDistEntries) {
    if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      await rm(path.join(packageDistDir, entry.name), { force: true });
    }
  }
  for (const dirName of supportDirs) {
    await rm(path.join(packageDistDir, dirName), {
      recursive: true,
      force: true,
    });
  }
  for (const supportDeclaration of supportDeclarations) {
    if (supportDeclaration.target === ".") {
      continue;
    }
    await rm(path.join(packageDistDir, supportDeclaration.target), {
      recursive: true,
      force: true,
    });
  }
  const sourcePackageName = supportSourcePackageName ?? packageName;
  const sourcePackageDir =
    await resolvePackageDeclarationSourceDir(sourcePackageName);
  for (const dirName of supportDirs) {
    await copyIfPresent(
      path.join(sourcePackageDir, dirName),
      path.join(packageDistDir, dirName),
    );
  }
}

function rewritePackageSourceImports(source: string): string {
  return source.replaceAll(
    /(["'])(?:\.\.\/)+rielflow-core\/src\/(?:index|adapter-contracts)\1/gu,
    '"rielflow-core"',
  );
}

async function writeRewrittenDeclaration(
  sourcePath: string,
  targetPath: string,
  rewriteRootSourceImports: boolean,
  rewritePackageImports: boolean,
): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  const withoutSourceMap = source.replace(/^\/\/# sourceMappingURL=.*$/gm, "");
  const rootRewritten = rewriteRootSourceImports
    ? withoutSourceMap.replaceAll("../../../src/", "./")
    : withoutSourceMap;
  const rewritten = (
    rewritePackageImports
      ? rewritePackageSourceImports(rootRewritten)
      : rootRewritten
  ).trimEnd();
  await writeFile(targetPath, `${rewritten}\n`, "utf8");
}

async function copyRewrittenDeclarationSupport(
  packageDistDir: string,
  supportDeclarations: readonly DeclarationSupportContract[],
): Promise<void> {
  for (const supportDeclaration of supportDeclarations) {
    const sourcePath = await resolveEmittedDeclarationPath(
      supportDeclaration.source,
    );
    const targetPath = path.join(packageDistDir, supportDeclaration.target);
    const sourceStats = await stat(sourcePath).catch(() => undefined);
    if (sourceStats === undefined) {
      continue;
    }
    if (sourceStats.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeRewrittenDeclaration(
        sourcePath,
        targetPath,
        supportDeclaration.rewriteRootSourceImports ?? false,
        supportDeclaration.rewritePackageSourceImports ?? false,
      );
      continue;
    }

    const copyDirectory = async (
      sourceDir: string,
      targetDir: string,
    ): Promise<void> => {
      const entries = await readdir(sourceDir, { withFileTypes: true });
      for (const entry of entries) {
        const childSourcePath = path.join(sourceDir, entry.name);
        const childTargetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
          await copyDirectory(childSourcePath, childTargetPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".d.ts")) {
          continue;
        }
        await mkdir(path.dirname(childTargetPath), { recursive: true });
        await writeRewrittenDeclaration(
          childSourcePath,
          childTargetPath,
          supportDeclaration.rewriteRootSourceImports ?? false,
          supportDeclaration.rewritePackageSourceImports ?? false,
        );
      }
    };

    await copyDirectory(sourcePath, targetPath);
  }
}

for (const contract of packageDeclarationContracts) {
  const packageDistDir = path.join(
    rootDir,
    "packages",
    contract.packageName,
    "dist",
  );
  const supportDeclarations = contract.supportDeclarations ?? [];
  await copyDeclarationSupport(
    contract.packageName,
    packageDistDir,
    contract.supportDirs,
    supportDeclarations,
    contract.supportSourcePackageName,
  );
  await copyRewrittenDeclarationSupport(packageDistDir, supportDeclarations);

  for (const exportedDeclaration of contract.exports) {
    await writeRewrittenDeclaration(
      await resolveEmittedDeclarationPath(exportedDeclaration.source),
      path.join(packageDistDir, exportedDeclaration.target),
      exportedDeclaration.rewriteRootSourceImports ?? false,
      exportedDeclaration.rewritePackageSourceImports ?? false,
    );
  }
}

await writeFile(
  path.join(rootDir, "packages", "rielflow-core", "dist", "index.js"),
  'export * from "./core-runtime.js";\n',
  "utf8",
);

const adapterRuntimeEntrypoint = path.join(
  rootDir,
  "packages",
  "rielflow-adapters",
  "dist",
  "index.js",
);
const adapterRuntimeSource = await readFile(adapterRuntimeEntrypoint, "utf8");
await writeFile(
  adapterRuntimeEntrypoint,
  adapterRuntimeSource.replaceAll(
    '"rielflow-core"',
    '"../../rielflow-core/dist/index.js"',
  ),
  "utf8",
);
