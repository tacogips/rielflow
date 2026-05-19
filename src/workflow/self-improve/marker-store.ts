import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isJsonObject } from "../../shared/json";
import { resolveWorkflowSelfImproveDirectory } from "./pathing";

export interface WorkflowSelfImproveMarker {
  readonly selfImproveId: string;
  readonly workflowName: string;
  readonly workflowId: string;
  readonly workflowDirectory: string;
  readonly completedAt: string;
  readonly sourceSessionIds: readonly string[];
}

export async function readWorkflowSelfImproveMarker(input: {
  readonly logRoot: string;
  readonly workflowDirectory: string;
}): Promise<WorkflowSelfImproveMarker | undefined> {
  const markerPath = path.join(
    resolveWorkflowSelfImproveDirectory(input),
    "latest-marker.json",
  );
  try {
    const raw = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(
        `self-improve marker '${markerPath}' must contain a JSON object`,
      );
    }
    return parsed as unknown as WorkflowSelfImproveMarker;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeWorkflowSelfImproveMarker(input: {
  readonly logRoot: string;
  readonly executionDirectory: string;
  readonly marker: WorkflowSelfImproveMarker;
}): Promise<void> {
  const workflowDirectory = resolveWorkflowSelfImproveDirectory({
    logRoot: input.logRoot,
    workflowDirectory: input.marker.workflowDirectory,
  });
  await mkdir(workflowDirectory, { recursive: true });
  await mkdir(input.executionDirectory, { recursive: true });
  const content = `${JSON.stringify(input.marker, null, 2)}\n`;
  await writeFile(
    path.join(workflowDirectory, "latest-marker.json"),
    content,
    "utf8",
  );
  await writeFile(
    path.join(input.executionDirectory, "marker.json"),
    content,
    "utf8",
  );
}
