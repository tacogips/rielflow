import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildMutableWorkflowWorkspace,
  createExecutionCopyMutableWorkspace,
  readWorkflowPatchRevisionsFromArtifact,
  recordWorkflowPatchRevision,
} from "./mutable-workspace";
import {
  isSafeSupervisionRunId,
  resolveSupervisionMutableWorkflowDirectory,
} from "./paths";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-mutable-workspace-test-"),
  );
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0, tempDirs.length)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("isSafeSupervisionRunId", () => {
  test("accepts engine-style ids", () => {
    expect(isSafeSupervisionRunId("sup-abcdef0123456789abcd")).toBe(true);
  });

  test("rejects non-hex or wrong shape", () => {
    expect(isSafeSupervisionRunId("sup-z")).toBe(false);
    expect(isSafeSupervisionRunId("other-abcdef0123456789abcd")).toBe(false);
  });
});

describe("resolveSupervisionMutableWorkflowDirectory", () => {
  test("resolves a nested path under the artifact root", () => {
    const root = path.join("/tmp", "art");
    const r = resolveSupervisionMutableWorkflowDirectory(
      root,
      "sup-abcdef0123456789abcd",
      "my-workflow",
    );
    expect(r).toBe(
      path.join(
        root,
        "supervision",
        "sup-abcdef0123456789abcd",
        "mutable",
        "my-workflow",
      ),
    );
  });
});

describe("buildMutableWorkflowWorkspace", () => {
  test("in-place mode uses the source directory as the mutable target", () => {
    const source = path.join("/tmp", "w", "src");
    const r = buildMutableWorkflowWorkspace({
      workflowId: "demo-wf",
      sourceWorkflowDir: source,
      artifactRoot: path.join("/tmp", "a"),
      supervisionRunId: "sup-abcdef0123456789abcd",
      mutationMode: "in-place",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.mutableWorkflowDir).toBe(source);
      expect(r.value.mutationMode).toBe("in-place");
    }
  });

  test("rejects an invalid supervision id", () => {
    const r = buildMutableWorkflowWorkspace({
      workflowId: "demo-wf",
      sourceWorkflowDir: "/x",
      artifactRoot: "/a",
      supervisionRunId: "bad",
      mutationMode: "execution-copy",
    });
    expect(r.ok).toBe(false);
  });
});

describe("createExecutionCopyMutableWorkspace", () => {
  test("copies a minimal workflow tree into the resolved mutable directory", async () => {
    const base = await makeTempDir();
    const source = path.join(base, "source-wf");
    await mkdir(source, { recursive: true });
    await writeFile(
      path.join(source, "workflow.json"),
      JSON.stringify(
        { workflowId: "fixture-wf", version: 1, description: "t" },
        null,
        2,
      ),
      "utf8",
    );
    const artifactRoot = path.join(base, "artifacts");
    const copy = await createExecutionCopyMutableWorkspace({
      workflowId: "fixture-wf",
      sourceWorkflowDir: source,
      artifactRoot,
      supervisionRunId: "sup-11111111111111111111",
      mutationMode: "execution-copy",
    });
    expect(copy.ok).toBe(true);
    if (!copy.ok) {
      return;
    }
    const out = path.join(
      artifactRoot,
      "supervision",
      "sup-11111111111111111111",
      "mutable",
      "fixture-wf",
    );
    expect(copy.value.mutableWorkflowDir).toBe(out);
    const body = await readFile(path.join(out, "workflow.json"), "utf8");
    expect(body).toContain("fixture-wf");
  });

  test("in-place does not read the filesystem for copy", async () => {
    const r = await createExecutionCopyMutableWorkspace({
      workflowId: "nofs",
      sourceWorkflowDir: path.join("/no", "such", "path"),
      artifactRoot: "/a",
      supervisionRunId: "sup-22222222222222222222",
      mutationMode: "in-place",
    });
    expect(r.ok).toBe(true);
  });
});

describe("recordWorkflowPatchRevision", () => {
  test("persists and reads patch revision records", async () => {
    const base = await makeTempDir();
    const artifactRoot = path.join(base, "artifacts");
    const supervisionRunId = "sup-33333333333333333333";
    const r1 = await recordWorkflowPatchRevision({
      artifactRoot,
      supervisionRunId,
      mutableWorkflowDir: path.join(base, "m1"),
      reason: "fix transition",
      patchedByStepId: "step-a",
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) {
      return;
    }
    expect(r1.value.patchRevisionId).toMatch(/^pr-[0-9a-f]+$/);
    const r2 = await recordWorkflowPatchRevision({
      artifactRoot,
      supervisionRunId,
      mutableWorkflowDir: path.join(base, "m1"),
      reason: "second",
      patchedByStepId: "step-b",
    });
    expect(r2.ok).toBe(true);
    const list = await readWorkflowPatchRevisionsFromArtifact({
      artifactRoot,
      supervisionRunId,
    });
    expect(list.ok).toBe(true);
    if (!list.ok) {
      return;
    }
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.patchedByStepId).toBe("step-a");
    expect(list.value[1]?.reason).toBe("second");
  });

  test("returns an error for malformed persisted patch revision data", async () => {
    const base = await makeTempDir();
    const artifactRoot = path.join(base, "artifacts");
    const supervisionRunId = "sup-44444444444444444444";
    const runDir = path.join(artifactRoot, "supervision", supervisionRunId);
    await mkdir(runDir, { recursive: true });
    const revisionsPath = path.join(runDir, "patch-revisions.json");
    await writeFile(revisionsPath, "{not-json", "utf8");

    const readResult = await readWorkflowPatchRevisionsFromArtifact({
      artifactRoot,
      supervisionRunId,
    });
    expect(readResult.ok).toBe(false);
    if (readResult.ok) {
      return;
    }
    expect(readResult.error.message).toContain(
      "failed reading patch revisions",
    );

    const recordResult = await recordWorkflowPatchRevision({
      artifactRoot,
      supervisionRunId,
      mutableWorkflowDir: path.join(base, "m1"),
      reason: "should not overwrite corrupt audit data",
      patchedByStepId: "step-a",
    });
    expect(recordResult.ok).toBe(false);
    if (recordResult.ok) {
      return;
    }
    expect(recordResult.error.message).toContain(
      "failed reading patch revisions",
    );
    expect(await readFile(revisionsPath, "utf8")).toBe("{not-json");
  });
});
