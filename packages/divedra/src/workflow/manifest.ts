import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isSafeWorkflowName } from "./paths";
import { err, ok, type Result } from "./result";
import type { WorkflowManifestAutoImprove } from "./types";

export type WorkflowManifestVersion = 1;

export interface WorkflowManifestPathObject {
  readonly absolute?: string;
  readonly relative?: string;
}

export interface WorkflowManifestEntry {
  readonly id: string;
  readonly enabled?: boolean;
  readonly workflowDirectory: WorkflowManifestPathObject;
  readonly cwd?: WorkflowManifestPathObject;
  readonly autoImprove?: WorkflowManifestAutoImprove;
  readonly defaultVariables?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface WorkflowManifestDocument {
  readonly manifestVersion: WorkflowManifestVersion;
  readonly workflows: readonly WorkflowManifestEntry[];
}

export interface ResolvedWorkflowManifestEntry {
  readonly id: string;
  readonly enabled: boolean;
  readonly workflowDirectory: string;
  readonly cwd: string;
  readonly authoredWorkflowId: string;
  readonly autoImprove?: WorkflowManifestAutoImprove;
  readonly defaultVariables: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly allowDuplicateSource: boolean;
}

export interface ResolvedWorkflowManifest {
  readonly manifestPath: string;
  readonly entries: readonly ResolvedWorkflowManifestEntry[];
}

export interface WorkflowManifestLoadFailure {
  readonly code:
    | "IO"
    | "INVALID_JSON"
    | "UNSUPPORTED_VERSION"
    | "INVALID_ENTRY"
    | "INVALID_PATH"
    | "DUPLICATE_ID"
    | "DUPLICATE_SOURCE";
  readonly message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entryLabel(index: number, id: unknown): string {
  return typeof id === "string" && id.length > 0
    ? `workflow '${id}'`
    : `workflow entry ${String(index)}`;
}

function invalidEntry(
  manifestPath: string,
  index: number,
  id: unknown,
  message: string,
): WorkflowManifestLoadFailure {
  return {
    code: "INVALID_ENTRY",
    message: `${manifestPath}: ${entryLabel(index, id)}: ${message}`,
  };
}

function validateJsonObjectField(
  manifestPath: string,
  index: number,
  id: unknown,
  fieldName: string,
  value: unknown,
): Result<Record<string, unknown>, WorkflowManifestLoadFailure> {
  if (value === undefined) {
    return ok({});
  }
  return isRecord(value)
    ? ok(value)
    : err(
        invalidEntry(manifestPath, index, id, `${fieldName} must be an object`),
      );
}

function resolveManifestPathObject(input: {
  readonly manifestPath: string;
  readonly index: number;
  readonly id: unknown;
  readonly fieldName: string;
  readonly value: unknown;
  readonly required: boolean;
}): Result<string | undefined, WorkflowManifestLoadFailure> {
  if (input.value === undefined) {
    return input.required
      ? err(
          invalidEntry(
            input.manifestPath,
            input.index,
            input.id,
            `${input.fieldName} is required`,
          ),
        )
      : ok(undefined);
  }
  if (!isRecord(input.value)) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        input.id,
        `${input.fieldName} must be an object`,
      ),
    );
  }
  const absolute = input.value["absolute"];
  const relative = input.value["relative"];
  const hasAbsolute = absolute !== undefined;
  const hasRelative = relative !== undefined;
  if (hasAbsolute === hasRelative) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        input.id,
        `${input.fieldName} must contain exactly one of absolute or relative`,
      ),
    );
  }
  const manifestDir = path.dirname(input.manifestPath);
  if (hasAbsolute) {
    if (typeof absolute !== "string" || absolute.length === 0) {
      return err(
        invalidEntry(
          input.manifestPath,
          input.index,
          input.id,
          `${input.fieldName}.absolute must be a non-empty string`,
        ),
      );
    }
    if (!path.isAbsolute(absolute)) {
      return err(
        invalidEntry(
          input.manifestPath,
          input.index,
          input.id,
          `${input.fieldName}.absolute must be absolute`,
        ),
      );
    }
    return ok(path.resolve(absolute));
  }
  if (typeof relative !== "string" || relative.length === 0) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        input.id,
        `${input.fieldName}.relative must be a non-empty string`,
      ),
    );
  }
  if (path.isAbsolute(relative)) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        input.id,
        `${input.fieldName}.relative must be relative`,
      ),
    );
  }
  return ok(path.resolve(manifestDir, relative));
}

async function readWorkflowId(input: {
  readonly manifestPath: string;
  readonly index: number;
  readonly id: string;
  readonly workflowDirectory: string;
}): Promise<Result<string, WorkflowManifestLoadFailure>> {
  const workflowJsonPath = path.join(input.workflowDirectory, "workflow.json");
  try {
    const fileStat = await stat(workflowJsonPath);
    if (!fileStat.isFile()) {
      return err(
        invalidEntry(
          input.manifestPath,
          input.index,
          input.id,
          `workflowDirectory must contain workflow.json: ${input.workflowDirectory}`,
        ),
      );
    }
    const raw = await readFile(workflowJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || typeof parsed["workflowId"] !== "string") {
      return err(
        invalidEntry(
          input.manifestPath,
          input.index,
          input.id,
          "workflow.json must contain workflowId",
        ),
      );
    }
    return ok(parsed["workflowId"]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        input.id,
        `failed reading workflowDirectory workflow.json: ${message}`,
      ),
    );
  }
}

function validateAutoImprove(
  manifestPath: string,
  index: number,
  id: unknown,
  value: unknown,
): Result<
  WorkflowManifestAutoImprove | undefined,
  WorkflowManifestLoadFailure
> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value)) {
    return err(
      invalidEntry(manifestPath, index, id, "autoImprove must be an object"),
    );
  }
  const mode = value["mode"];
  return mode === "active" || mode === "disabled"
    ? ok({ mode })
    : err(
        invalidEntry(
          manifestPath,
          index,
          id,
          "autoImprove.mode must be 'active' or 'disabled'",
        ),
      );
}

async function resolveEntry(input: {
  readonly manifestPath: string;
  readonly index: number;
  readonly value: unknown;
}): Promise<
  Result<ResolvedWorkflowManifestEntry, WorkflowManifestLoadFailure>
> {
  if (!isRecord(input.value)) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        undefined,
        "must be an object",
      ),
    );
  }
  const id = input.value["id"];
  if (typeof id !== "string" || id.length === 0) {
    return err(
      invalidEntry(input.manifestPath, input.index, id, "id is required"),
    );
  }
  if (!isSafeWorkflowName(id)) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        id,
        "id must be a safe workflow name",
      ),
    );
  }
  const enabledValue = input.value["enabled"];
  if (enabledValue !== undefined && typeof enabledValue !== "boolean") {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        id,
        "enabled must be a boolean",
      ),
    );
  }
  const workflowDirectory = resolveManifestPathObject({
    manifestPath: input.manifestPath,
    index: input.index,
    id,
    fieldName: "workflowDirectory",
    value: input.value["workflowDirectory"],
    required: true,
  });
  if (!workflowDirectory.ok) {
    return workflowDirectory;
  }
  if (workflowDirectory.value === undefined) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        id,
        "workflowDirectory is required",
      ),
    );
  }
  const cwd = resolveManifestPathObject({
    manifestPath: input.manifestPath,
    index: input.index,
    id,
    fieldName: "cwd",
    value: input.value["cwd"],
    required: false,
  });
  if (!cwd.ok) {
    return cwd;
  }
  const defaultVariables = validateJsonObjectField(
    input.manifestPath,
    input.index,
    id,
    "defaultVariables",
    input.value["defaultVariables"],
  );
  if (!defaultVariables.ok) {
    return defaultVariables;
  }
  const metadata = validateJsonObjectField(
    input.manifestPath,
    input.index,
    id,
    "metadata",
    input.value["metadata"],
  );
  if (!metadata.ok) {
    return metadata;
  }
  const allowDuplicateSourceValue = metadata.value["allowDuplicateSource"];
  if (
    allowDuplicateSourceValue !== undefined &&
    typeof allowDuplicateSourceValue !== "boolean"
  ) {
    return err(
      invalidEntry(
        input.manifestPath,
        input.index,
        id,
        "metadata.allowDuplicateSource must be a boolean when provided",
      ),
    );
  }
  const autoImprove = validateAutoImprove(
    input.manifestPath,
    input.index,
    id,
    input.value["autoImprove"],
  );
  if (!autoImprove.ok) {
    return autoImprove;
  }
  const authoredWorkflowId = await readWorkflowId({
    manifestPath: input.manifestPath,
    index: input.index,
    id,
    workflowDirectory: workflowDirectory.value,
  });
  if (!authoredWorkflowId.ok) {
    return authoredWorkflowId;
  }
  return ok({
    id,
    enabled: enabledValue ?? true,
    workflowDirectory: workflowDirectory.value,
    cwd: cwd.value ?? workflowDirectory.value,
    authoredWorkflowId: authoredWorkflowId.value,
    ...(autoImprove.value === undefined
      ? {}
      : { autoImprove: autoImprove.value }),
    defaultVariables: defaultVariables.value,
    metadata: metadata.value,
    allowDuplicateSource: allowDuplicateSourceValue === true,
  });
}

function validateResolvedEntries(
  manifestPath: string,
  entries: readonly ResolvedWorkflowManifestEntry[],
): Result<
  readonly ResolvedWorkflowManifestEntry[],
  WorkflowManifestLoadFailure
> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      return err({
        code: "DUPLICATE_ID",
        message: `${manifestPath}: duplicate workflow manifest id '${entry.id}'`,
      });
    }
    ids.add(entry.id);
  }
  for (const entry of entries) {
    if (
      entry.authoredWorkflowId !== entry.id &&
      ids.has(entry.authoredWorkflowId)
    ) {
      return err({
        code: "DUPLICATE_ID",
        message: `${manifestPath}: authored workflow id '${entry.authoredWorkflowId}' conflicts with manifest id '${entry.id}'`,
      });
    }
  }
  const sourceKeys = new Map<string, ResolvedWorkflowManifestEntry>();
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    const key = `${entry.workflowDirectory}\0${entry.cwd}`;
    const existing = sourceKeys.get(key);
    if (
      existing !== undefined &&
      (!existing.allowDuplicateSource || !entry.allowDuplicateSource)
    ) {
      return err({
        code: "DUPLICATE_SOURCE",
        message: `${manifestPath}: enabled workflows '${existing.id}' and '${entry.id}' use the same workflowDirectory/cwd; set metadata.allowDuplicateSource=true on each duplicate entry intentionally to allow this`,
      });
    }
    sourceKeys.set(key, entry);
  }
  return ok(entries);
}

export async function loadWorkflowManifest(
  manifestPath: string,
): Promise<Result<ResolvedWorkflowManifest, WorkflowManifestLoadFailure>> {
  const resolvedManifestPath = path.resolve(manifestPath);
  let raw: string;
  try {
    raw = await readFile(resolvedManifestPath, "utf8");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed reading workflow manifest '${resolvedManifestPath}': ${message}`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "INVALID_JSON",
      message: `workflow manifest '${resolvedManifestPath}' is not valid JSON: ${message}`,
    });
  }
  if (!isRecord(parsed)) {
    return err({
      code: "INVALID_ENTRY",
      message: `${resolvedManifestPath}: manifest must be an object`,
    });
  }
  if (parsed["manifestVersion"] !== 1) {
    return err({
      code: "UNSUPPORTED_VERSION",
      message: `${resolvedManifestPath}: unsupported manifestVersion '${String(parsed["manifestVersion"])}'; expected 1`,
    });
  }
  const workflows = parsed["workflows"];
  if (!Array.isArray(workflows) || workflows.length === 0) {
    return err({
      code: "INVALID_ENTRY",
      message: `${resolvedManifestPath}: workflows must be a non-empty array`,
    });
  }
  const entries: ResolvedWorkflowManifestEntry[] = [];
  for (const [index, entry] of workflows.entries()) {
    const resolved = await resolveEntry({
      manifestPath: resolvedManifestPath,
      index,
      value: entry,
    });
    if (!resolved.ok) {
      return resolved;
    }
    entries.push(resolved.value);
  }
  const validated = validateResolvedEntries(resolvedManifestPath, entries);
  if (!validated.ok) {
    return validated;
  }
  return ok({ manifestPath: resolvedManifestPath, entries: validated.value });
}
