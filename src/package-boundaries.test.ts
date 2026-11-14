import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

async function readManifest(relativePath: string): Promise<PackageManifest> {
  const content = await readFile(
    path.join(process.cwd(), relativePath),
    "utf8",
  );
  return JSON.parse(content) as PackageManifest;
}

async function importCopiedPackageEntrypoint(
  packageName: string,
  entrypoint: string,
): Promise<Readonly<Record<string, unknown>>> {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), `divedra-${packageName}-runtime-`),
  );
  try {
    const packageRoot = path.join(tempDir, packageName);
    await cp(path.join(process.cwd(), "packages", packageName), packageRoot, {
      recursive: true,
    });
    const entrypointUrl = pathToFileURL(
      path.join(packageRoot, entrypoint),
    ).href;
    return (await import(entrypointUrl)) as Readonly<Record<string, unknown>>;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
  });

  test("core and add-ons packages expose package-local entrypoints", async () => {
    const core = await readManifest("packages/divedra-core/package.json");
    const addons = await readManifest("packages/divedra-addons/package.json");

    expect(core.name).toBe("divedra-core");
    expect(core.main).toBe("dist/index.js");
    expect(core.types).toBe("dist/index.d.ts");
    expect(addons.name).toBe("divedra-addons");
    expect(addons.main).toBe("dist/index.js");
    expect(addons.types).toBe("dist/index.d.ts");
    expect(addons.dependencies?.["divedra-core"]).toBe("workspace:*");
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

    expect(typeof compat["continueWorkflowFromHistory"]).toBe("function");
    expect(typeof core["runWorkflow"]).toBe("function");
    expect(typeof addons["createNodeAddonRegistry"]).toBe("function");
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
