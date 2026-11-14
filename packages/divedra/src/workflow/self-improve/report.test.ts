import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  listWorkflowSelfImproveReportSummaries,
  readWorkflowSelfImproveReport,
} from "./report";
import { resolveWorkflowSelfImproveDirectory } from "./pathing";
import { readWorkflowSelfImproveMarker } from "./marker-store";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "divedra-self-improve-report-"),
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

describe("workflow self-improve report JSON boundaries", () => {
  test("marker reads reject corrupt non-object JSON", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "workflow");
    const logRoot = path.join(root, "logs");
    const reportsRoot = resolveWorkflowSelfImproveDirectory({
      logRoot,
      workflowDirectory,
    });
    await mkdir(reportsRoot, { recursive: true });
    await writeFile(path.join(reportsRoot, "latest-marker.json"), "[]\n");

    await expect(
      readWorkflowSelfImproveMarker({ logRoot, workflowDirectory }),
    ).rejects.toThrow("must contain a JSON object");
  });

  test("report reads fail for non-object persisted JSON", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "workflow");
    const logRoot = path.join(root, "logs");
    const selfImproveId = "sim-invalid";
    const reportsRoot = resolveWorkflowSelfImproveDirectory({
      logRoot,
      workflowDirectory,
    });
    await mkdir(path.join(reportsRoot, selfImproveId), {
      recursive: true,
    });
    await writeFile(
      path.join(reportsRoot, selfImproveId, "report.json"),
      "[]\n",
      "utf8",
    );

    await expect(
      readWorkflowSelfImproveReport({
        logRoot,
        workflowDirectory,
        selfImproveId,
      }),
    ).rejects.toThrow("must contain a JSON object");
  });

  test("report listing skips invalid report entries", async () => {
    const root = await makeTempDir();
    const workflowDirectory = path.join(root, "workflow");
    const logRoot = path.join(root, "logs");
    const reportsRoot = resolveWorkflowSelfImproveDirectory({
      logRoot,
      workflowDirectory,
    });
    await mkdir(path.join(reportsRoot, "bad"), {
      recursive: true,
    });
    await writeFile(
      path.join(reportsRoot, "bad", "report.json"),
      "[]\n",
      "utf8",
    );

    await expect(
      listWorkflowSelfImproveReportSummaries({
        logRoot,
        workflowName: "demo",
        workflowDirectory,
      }),
    ).resolves.toEqual([]);
  });
});
