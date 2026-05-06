import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  computeProjectScopedRootDataDir,
  computeProjectScopedRootDataDirForScopeRoot,
  encodeProjectRootForRuntimeData,
  isSafeSupervisionRunId,
  resolveEffectiveRoots,
  resolveProjectRootForScopeRoot,
  resolveRootDataDir,
  resolveSupervisionMutableWorkflowDirectory,
  resolveSupervisionRunDirectory,
} from "./paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-paths-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runtime storage paths", () => {
  test("defaults non-scoped runtime data to the user artifacts root", async () => {
    const cwd = await makeTempDir();
    const roots = resolveEffectiveRoots({ cwd, env: {} });
    const rootDataDir = path.join(os.homedir(), ".divedra", "artifacts");

    expect(roots.rootDataDir).toBe(rootDataDir);
    expect(roots.artifactRoot).toBe(path.join(rootDataDir, "workflow"));
    expect(roots.attachmentRoot).toBe(path.join(rootDataDir, "files"));
  });

  test("uses DIVEDRA_USER_ROOT for non-scoped runtime data defaults", async () => {
    const cwd = await makeTempDir();
    const rootDataDir = resolveRootDataDir({
      cwd,
      env: { DIVEDRA_USER_ROOT: "operator-home" },
    });

    expect(rootDataDir).toBe(path.join(cwd, "operator-home", "artifacts"));
  });

  test("builds project-scoped runtime data below the user root namespace", async () => {
    const cwd = await makeTempDir();
    const projectRoot = path.join(cwd, "workspace", "repo");
    const userRoot = path.join(cwd, "user-home", ".divedra");
    const encodedProjectRoot = encodeProjectRootForRuntimeData(projectRoot);

    expect(encodedProjectRoot).toMatch(/^repo-[a-f0-9]{16}$/);
    expect(
      computeProjectScopedRootDataDir({ projectRoot, userRoot, cwd }),
    ).toBe(path.join(userRoot, "projects", encodedProjectRoot, "artifacts"));
  });

  test("uses a collision-resistant compact project runtime namespace", async () => {
    const cwd = await makeTempDir();
    const nestedProjectRoot = path.join(cwd, "workspace", "repo");
    const underscoreProjectRoot = path.join(cwd, "workspace__repo");
    const longProjectRoot = path.join(cwd, "workspace", "a".repeat(300));

    expect(encodeProjectRootForRuntimeData(nestedProjectRoot)).not.toBe(
      encodeProjectRootForRuntimeData(underscoreProjectRoot),
    );
    expect(
      encodeProjectRootForRuntimeData(longProjectRoot).length,
    ).toBeLessThan(80);
  });

  test("resolves project identity from both .divedra and direct scope roots", () => {
    const projectRoot = path.join(os.tmpdir(), "workspace", "repo");

    expect(
      resolveProjectRootForScopeRoot(path.join(projectRoot, ".divedra")),
    ).toBe(projectRoot);
    expect(resolveProjectRootForScopeRoot(projectRoot)).toBe(projectRoot);
  });

  test("builds project-scoped runtime data from project scope roots", async () => {
    const cwd = await makeTempDir();
    const projectRoot = path.join(cwd, "workspace", "repo");
    const scopeRoot = path.join(projectRoot, ".divedra");
    const userRoot = "operator-home";

    expect(
      computeProjectScopedRootDataDirForScopeRoot({
        scopeRoot,
        userRoot,
        cwd,
      }),
    ).toBe(
      computeProjectScopedRootDataDir({
        projectRoot,
        userRoot,
        cwd,
      }),
    );
  });

  test("keeps DIVEDRA_ARTIFACT_DIR as the root data override", async () => {
    const cwd = await makeTempDir();
    const roots = resolveEffectiveRoots({
      cwd,
      env: {
        DIVEDRA_ARTIFACT_DIR: "runtime-data",
        DIVEDRA_USER_ROOT: "operator-home",
      },
    });
    const rootDataDir = path.join(cwd, "runtime-data");

    expect(roots.rootDataDir).toBe(rootDataDir);
    expect(roots.artifactRoot).toBe(path.join(rootDataDir, "workflow"));
    expect(roots.attachmentRoot).toBe(path.join(rootDataDir, "files"));
  });

  test("uses DIVEDRA_WORKFLOW_DEFINITION_DIR as the direct workflow definition directory", async () => {
    const cwd = await makeTempDir();
    const roots = resolveEffectiveRoots({
      cwd,
      env: {
        DIVEDRA_WORKFLOW_DEFINITION_DIR: "definitions",
      },
    });

    expect(roots.workflowRoot).toBe(path.join(cwd, "definitions"));
  });

  test("ignores the removed DIVEDRA_WORKFLOW_ROOT environment variable", async () => {
    const cwd = await makeTempDir();
    const roots = resolveEffectiveRoots({
      cwd,
      env: {
        DIVEDRA_WORKFLOW_ROOT: "legacy-root",
      },
    });

    expect(roots.workflowRoot).toBe(path.join(cwd, ".divedra"));
  });
});

describe("supervision path helpers", () => {
  test("isSafeSupervisionRunId accepts engine-shaped ids and rejects traversal or bad shape", () => {
    expect(isSafeSupervisionRunId("sup-0123456789abcdef")).toBe(true);
    expect(isSafeSupervisionRunId("sup-01234567")).toBe(true);
    expect(isSafeSupervisionRunId("sup-")).toBe(false);
    expect(isSafeSupervisionRunId("sup-0123456")).toBe(false);
    expect(isSafeSupervisionRunId("other-0123456789abcdef")).toBe(false);
    expect(isSafeSupervisionRunId("sup-01234567../x")).toBe(false);
    expect(isSafeSupervisionRunId("sup-GGGGGGGGGGGGGGGG")).toBe(false);
  });

  test("resolveSupervisionRunDirectory returns a path under the artifact root or undefined", () => {
    const root = path.join(path.sep, "tmp", "artifact");
    const id = "sup-0123456789abcdef";
    const resolved = resolveSupervisionRunDirectory(root, id);
    expect(resolved).toBe(path.join(root, "supervision", id));

    expect(resolveSupervisionRunDirectory(root, "evil/../x")).toBeUndefined();
  });

  test("resolveSupervisionMutableWorkflowDirectory requires safe supervision id and workflow id", () => {
    const root = path.join(path.sep, "tmp", "artifact");
    const sup = "sup-0123456789abcdef";
    const wf = "my-workflow";
    const resolved = resolveSupervisionMutableWorkflowDirectory(root, sup, wf);
    expect(resolved).toBe(path.join(root, "supervision", sup, "mutable", wf));

    expect(
      resolveSupervisionMutableWorkflowDirectory(root, "bad", wf),
    ).toBeUndefined();
    expect(
      resolveSupervisionMutableWorkflowDirectory(root, sup, "../escape"),
    ).toBeUndefined();
  });
});
