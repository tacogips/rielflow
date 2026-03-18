import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertUiFrameworkPackages,
  assertWorkspacePackage,
  collectUiFrameworkStatus,
  detectUiFramework,
  formatUiFrameworkStatus,
  frontendModeFromUiFramework,
  missingUiFrameworkPackageDeclarations,
  missingUiFrameworkPackages,
  resolvePackageOptionsFromModuleUrl,
  resolvePackageBinary,
  uiFrameworkPackages,
} from "../../scripts/ui-framework.mjs";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-ui-framework-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

async function writePackageStub(
  root: string,
  packageName: string,
): Promise<void> {
  const packageDirectory = path.join(
    root,
    "node_modules",
    ...packageName.split("/"),
  );
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({ name: packageName, version: "0.0.0-test" }),
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ui-framework tooling guards", () => {
  test("lists required framework packages per target", () => {
    expect(uiFrameworkPackages("solid", "typecheck")).toEqual(["solid-js"]);
    expect(uiFrameworkPackages("solid", "build")).toEqual([
      "solid-js",
      "vite-plugin-solid",
    ]);
  });

  test("maps detected frameworks to shared frontend modes", () => {
    expect(frontendModeFromUiFramework("solid")).toBe("solid-dist");
  });

  test("resolves package options from the script module location instead of cwd", () => {
    const options = resolvePackageOptionsFromModuleUrl(
      "file:///tmp/divedra/scripts/run-ui-typecheck.mjs",
    );

    expect(options).toEqual({
      baseDir: "/tmp/divedra",
      packageRoot: "/tmp/divedra",
      uiRoot: "/tmp/divedra/ui",
    });
  });

  test("reports missing packages relative to the package root", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );
    await writePackageStub(root, "solid-js");

    expect(
      missingUiFrameworkPackages("solid", "build", { packageRoot: root }),
    ).toEqual(["vite-plugin-solid"]);
  });

  test("does not accept packages resolved only from a parent node_modules directory", async () => {
    const workspaceRoot = await makeTempDir();
    const parentRoot = path.join(workspaceRoot, "parent");
    const repoRoot = path.join(parentRoot, "repo");
    await mkdir(repoRoot, { recursive: true });
    await writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          "solid-js": "1.0.0-test",
          "vite-plugin-solid": "1.0.0-test",
        },
      }),
      "utf8",
    );
    await writePackageStub(parentRoot, "solid-js");
    await writePackageStub(parentRoot, "vite-plugin-solid");

    expect(
      missingUiFrameworkPackages("solid", "build", { packageRoot: repoRoot }),
    ).toEqual(["solid-js", "vite-plugin-solid"]);
    expect(() =>
      assertUiFrameworkPackages("solid", "build", { packageRoot: repoRoot }),
    ).toThrow(
      /missing solid frontend package\(s\) required to build the UI: 'solid-js', 'vite-plugin-solid'/,
    );
  });

  test("reports missing direct package declarations from package.json", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          "solid-js": "1.0.0-test",
        },
      }),
      "utf8",
    );

    expect(
      missingUiFrameworkPackageDeclarations("solid", "build", {
        packageRoot: root,
      }),
    ).toEqual(["vite-plugin-solid"]);
  });

  test("detects the checked-in framework from a single active entrypoint", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });
    await writeFile(
      path.join(uiRoot, "src", "main.tsx"),
      "export {};\n",
      "utf8",
    );

    expect(detectUiFramework({ uiRoot })).toBe("solid");
  });

  test("rejects a missing checked-in frontend entrypoint", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });

    expect(() => detectUiFramework({ uiRoot })).toThrow(
      /unable to detect Solid frontend/i,
    );
    expect(() => detectUiFramework({ uiRoot })).toThrow(/main\.tsx/);
  });

  test("rejects a legacy frontend entrypoint in the repository", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });
    await writeFile(
      path.join(uiRoot, "src", "main.ts"),
      "export {};\n",
      "utf8",
    );

    expect(() => detectUiFramework({ uiRoot })).toThrow(
      /legacy frontend entrypoint/i,
    );
    expect(() => detectUiFramework({ uiRoot })).toThrow(/main\.ts/);
  });

  test("throws a clear error when required packages are absent", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );

    expect(() =>
      assertUiFrameworkPackages("solid", "typecheck", { packageRoot: root }),
    ).toThrow(
      /missing solid frontend package declaration\(s\) in package\.json required to typecheck: 'solid-js'/,
    );
  });

  test("rejects locally installed packages that are not declared in package.json", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );
    await writePackageStub(root, "solid-js");
    await writePackageStub(root, "vite-plugin-solid");

    expect(() =>
      assertUiFrameworkPackages("solid", "build", { packageRoot: root }),
    ).toThrow(
      /missing solid frontend package declaration\(s\) in package\.json required to build: 'solid-js', 'vite-plugin-solid'/,
    );
  });

  test("accepts installed packages without throwing", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          "solid-js": "1.0.0-test",
          "vite-plugin-solid": "1.0.0-test",
        },
      }),
      "utf8",
    );
    await writePackageStub(root, "solid-js");
    await writePackageStub(root, "vite-plugin-solid");

    expect(() =>
      assertUiFrameworkPackages("solid", "build", { packageRoot: root }),
    ).not.toThrow();
  });

  test("rejects undeclared workspace packages even when locally installed", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );
    await writePackageStub(root, "vite");

    expect(() =>
      assertWorkspacePackage("vite", "build the UI", { packageRoot: root }),
    ).toThrow(
      /missing package declaration in package\.json required to build the UI: 'vite'/,
    );
  });

  test("rejects declared workspace packages that are not installed", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          vite: "1.0.0-test",
        },
      }),
      "utf8",
    );

    expect(() =>
      assertWorkspacePackage("vite", "build the UI", { packageRoot: root }),
    ).toThrow(/missing installed package required to build the UI: 'vite'/);
  });

  test("resolves package-declared binaries without relying on PATH", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          typescript: "0.0.0-test",
        },
      }),
      "utf8",
    );
    const packageDirectory = path.join(root, "node_modules", "typescript");
    await mkdir(path.join(packageDirectory, "bin"), { recursive: true });
    await writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "typescript",
        version: "0.0.0-test",
        bin: {
          tsc: "./bin/tsc",
        },
      }),
      "utf8",
    );

    expect(
      resolvePackageBinary("typescript", "tsc", { packageRoot: root }),
    ).toBe(path.join(packageDirectory, "bin", "tsc"));
  });

  test("rejects binaries when only a parent node_modules installation exists", async () => {
    const workspaceRoot = await makeTempDir();
    const parentRoot = path.join(workspaceRoot, "parent");
    const repoRoot = path.join(parentRoot, "repo");
    await mkdir(repoRoot, { recursive: true });
    await writeFile(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          typescript: "0.0.0-test",
        },
      }),
      "utf8",
    );

    const packageDirectory = path.join(
      parentRoot,
      "node_modules",
      "typescript",
    );
    await mkdir(path.join(packageDirectory, "bin"), { recursive: true });
    await writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "typescript",
        version: "0.0.0-test",
        bin: {
          tsc: "./bin/tsc",
        },
      }),
      "utf8",
    );

    expect(() =>
      resolvePackageBinary("typescript", "tsc", { packageRoot: repoRoot }),
    ).toThrow(/missing installed package required to run 'tsc': 'typescript'/);
  });

  test("rejects binary resolution when the package is locally installed but undeclared", async () => {
    const root = await makeTempDir();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );
    const packageDirectory = path.join(root, "node_modules", "typescript");
    await mkdir(path.join(packageDirectory, "bin"), { recursive: true });
    await writeFile(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        name: "typescript",
        version: "0.0.0-test",
        bin: {
          tsc: "./bin/tsc",
        },
      }),
      "utf8",
    );

    expect(() =>
      resolvePackageBinary("typescript", "tsc", { packageRoot: root }),
    ).toThrow(
      /missing package declaration in package\.json required to run 'tsc': 'typescript'/,
    );
  });

  test("summarizes missing Solid entrypoint and package blockers", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );

    const status = collectUiFrameworkStatus({ packageRoot: root, uiRoot });

    expect(status.currentFramework.framework).toBeNull();
    expect(status.currentFramework.frontendMode).toBeNull();
    expect(status.currentFramework.entrypoint).toBeNull();
    expect(status.currentFramework.readyForTypecheck).toBe(false);
    expect(status.currentFramework.readyForBuild).toBe(false);
    expect(status.solidCutover.ready).toBe(false);
    expect(status.solidCutover.entrypointExists).toBe(false);
    expect(status.solidCutover.conflictingLegacyEntrypoint).toBe(false);
    expect(status.solidCutover.missingBuildDeclarations).toEqual([
      "solid-js",
      "vite-plugin-solid",
    ]);
    expect(formatUiFrameworkStatus(status)).toContain(
      "missing checked-in Solid entrypoint ui/src/main.tsx",
    );
  });

  test("reports a legacy frontend entrypoint as a blocker", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "ui-framework-test" }),
      "utf8",
    );
    await writeFile(
      path.join(uiRoot, "src", "main.ts"),
      "export {};\n",
      "utf8",
    );

    const status = collectUiFrameworkStatus({ packageRoot: root, uiRoot });

    expect(status.detectionError).toMatch(/legacy frontend entrypoint/i);
    expect(status.solidCutover.conflictingLegacyEntrypoint).toBe(true);
    expect(formatUiFrameworkStatus(status)).toContain(
      "remove the legacy checked-in frontend entrypoint ui/src/main.ts",
    );
  });

  test("reports Solid cutover readiness when the Solid entrypoint and packages are present", async () => {
    const root = await makeTempDir();
    const uiRoot = path.join(root, "ui");
    await mkdir(path.join(uiRoot, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "ui-framework-test",
        devDependencies: {
          "solid-js": "1.0.0-test",
          "vite-plugin-solid": "1.0.0-test",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(uiRoot, "src", "main.tsx"),
      "export {};\n",
      "utf8",
    );
    await writePackageStub(root, "solid-js");
    await writePackageStub(root, "vite-plugin-solid");

    const status = collectUiFrameworkStatus({ packageRoot: root, uiRoot });

    expect(status.currentFramework.framework).toBe("solid");
    expect(status.currentFramework.frontendMode).toBe("solid-dist");
    expect(status.currentFramework.entrypoint).toBe("ui/src/main.tsx");
    expect(status.currentFramework.readyForTypecheck).toBe(true);
    expect(status.currentFramework.readyForBuild).toBe(true);
    expect(status.solidCutover.ready).toBe(true);
    expect(formatUiFrameworkStatus(status)).toContain(
      "Solid cutover ready: yes",
    );
    expect(formatUiFrameworkStatus(status)).toContain("  - none");
  });
});
