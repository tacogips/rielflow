import { randomBytes } from "node:crypto";
import { cp, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import {
  isSafeSupervisionRunId,
  isSafeWorkflowId,
  resolveSupervisionMutableWorkflowDirectory,
  resolveSupervisionRunDirectory,
} from "./paths";
import { err, ok, type Result } from "./result";
import type {
  MutableWorkflowWorkspace,
  WorkflowPatchRevisionInput,
  WorkflowPatchRevisionRecord,
} from "./types";

export type MutableWorkspaceFailure =
  | { readonly code: "INVALID_PATH"; readonly message: string }
  | { readonly code: "IO"; readonly message: string };

/**
 * Resolves the workspace record without copying. For `execution-copy`, `mutableWorkflowDir` is
 * the target path (created by {@link createExecutionCopyMutableWorkspace}).
 */
export function buildMutableWorkflowWorkspace(input: {
  readonly workflowId: string;
  readonly sourceWorkflowDir: string;
  readonly artifactRoot: string;
  readonly supervisionRunId: string;
  readonly mutationMode: "execution-copy" | "in-place";
}): Result<MutableWorkflowWorkspace, MutableWorkspaceFailure> {
  if (!isSafeWorkflowId(input.workflowId)) {
    return err({
      code: "INVALID_PATH",
      message: "invalid workflowId for mutable workspace",
    });
  }
  if (!isSafeSupervisionRunId(input.supervisionRunId)) {
    return err({
      code: "INVALID_PATH",
      message: "invalid supervisionRunId for mutable workspace",
    });
  }
  if (input.mutationMode === "in-place") {
    return ok({
      workflowId: input.workflowId,
      sourceWorkflowDir: input.sourceWorkflowDir,
      mutableWorkflowDir: input.sourceWorkflowDir,
      mutationMode: "in-place",
    });
  }
  const mutable = resolveSupervisionMutableWorkflowDirectory(
    input.artifactRoot,
    input.supervisionRunId,
    input.workflowId,
  );
  if (mutable === undefined) {
    return err({
      code: "INVALID_PATH",
      message: "could not resolve execution-copy mutable directory",
    });
  }
  return ok({
    workflowId: input.workflowId,
    sourceWorkflowDir: input.sourceWorkflowDir,
    mutableWorkflowDir: mutable,
    mutationMode: "execution-copy",
  });
}

/**
 * Populates the execution-copy workspace by recursively copying the source bundle. No-op for
 * `in-place` (mutable dir already equals the source). Safe to re-call: replaces an existing copy.
 */
export async function createExecutionCopyMutableWorkspace(input: {
  readonly workflowId: string;
  readonly sourceWorkflowDir: string;
  readonly artifactRoot: string;
  readonly supervisionRunId: string;
  readonly mutationMode: "execution-copy" | "in-place";
}): Promise<Result<MutableWorkflowWorkspace, MutableWorkspaceFailure>> {
  const built = buildMutableWorkflowWorkspace(input);
  if (!built.ok) {
    return built;
  }
  const workspace = built.value;
  if (workspace.mutationMode === "in-place") {
    return ok(workspace);
  }
  try {
    await stat(input.sourceWorkflowDir);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `source workflow directory is not accessible: ${message}`,
    });
  }
  try {
    await rm(workspace.mutableWorkflowDir, { recursive: true, force: true });
    await cp(input.sourceWorkflowDir, workspace.mutableWorkflowDir, {
      recursive: true,
      errorOnExist: false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed to create execution-scoped workflow copy: ${message}`,
    });
  }
  return ok(workspace);
}

const PATCH_REVISIONS_FILE = "patch-revisions.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPatchRevisionRecord(
  value: unknown,
): value is WorkflowPatchRevisionRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value["patchRevisionId"] === "string" &&
    typeof value["recordedAt"] === "string" &&
    typeof value["reason"] === "string" &&
    typeof value["patchedByStepId"] === "string" &&
    typeof value["mutableWorkflowDir"] === "string"
  );
}

function isNodeErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function loadPatchRevisionRecords(
  filePath: string,
): Promise<
  Result<readonly WorkflowPatchRevisionRecord[], MutableWorkspaceFailure>
> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return err({
        code: "IO",
        message: `patch revision file '${filePath}' must contain a JSON array`,
      });
    }
    for (const [index, entry] of parsed.entries()) {
      if (!isPatchRevisionRecord(entry)) {
        return err({
          code: "IO",
          message: `patch revision file '${filePath}' contains an invalid record at index ${index}`,
        });
      }
    }
    return ok(parsed as readonly WorkflowPatchRevisionRecord[]);
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return ok([]);
    }
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed reading patch revisions: ${message}`,
    });
  }
}

/**
 * Appends a patch provenance record under the supervision run directory.
 */
export async function recordWorkflowPatchRevision(
  input: {
    readonly artifactRoot: string;
  } & WorkflowPatchRevisionInput,
): Promise<Result<WorkflowPatchRevisionRecord, MutableWorkspaceFailure>> {
  const runDir = resolveSupervisionRunDirectory(
    input.artifactRoot,
    input.supervisionRunId,
  );
  if (runDir === undefined) {
    return err({
      code: "INVALID_PATH",
      message: "invalid supervision run id for patch revision",
    });
  }
  const filePath = path.join(runDir, PATCH_REVISIONS_FILE);
  const patchRevisionId = `pr-${randomBytes(8).toString("hex")}`;
  const recordedAt = new Date().toISOString();
  const next: WorkflowPatchRevisionRecord = {
    patchRevisionId,
    recordedAt,
    reason: input.reason,
    patchedByStepId: input.patchedByStepId,
    mutableWorkflowDir: input.mutableWorkflowDir,
  };
  const prior = await loadPatchRevisionRecords(filePath);
  if (!prior.ok) {
    return prior;
  }
  try {
    await atomicWriteJsonFile(filePath, [...prior.value, next]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed recording patch revision: ${message}`,
    });
  }
  return ok(next);
}

/**
 * Returns persisted patch revision records (newest last), or an empty list.
 */
export async function readWorkflowPatchRevisionsFromArtifact(input: {
  readonly artifactRoot: string;
  readonly supervisionRunId: string;
}): Promise<
  Result<readonly WorkflowPatchRevisionRecord[], MutableWorkspaceFailure>
> {
  const runDir = resolveSupervisionRunDirectory(
    input.artifactRoot,
    input.supervisionRunId,
  );
  if (runDir === undefined) {
    return err({
      code: "INVALID_PATH",
      message: "invalid supervision run id for patch revision list",
    });
  }
  const filePath = path.join(runDir, PATCH_REVISIONS_FILE);
  return loadPatchRevisionRecords(filePath);
}
