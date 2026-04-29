import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  isSafeSupervisionRunId,
  resolveEffectiveRoots,
  resolveRootDataDir,
  resolveSupervisionMutableWorkflowDirectory,
  resolveSupervisionRunDirectory,
} from "./paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "divedra-paths-test-"));
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
    expect(resolved).toBe(
      path.join(root, "supervision", sup, "mutable", wf),
    );

    expect(
      resolveSupervisionMutableWorkflowDirectory(root, "bad", wf),
    ).toBeUndefined();
    expect(
      resolveSupervisionMutableWorkflowDirectory(root, sup, "../escape"),
    ).toBeUndefined();
  });
});
