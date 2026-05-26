import { readFileSync, readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateJsonSchemaDefinition } from "../json-schema";
import type {
  JsonObject,
  NodeInputContract,
  NodeOutputContract,
  NormalizedWorkflowBundle,
  ValidationIssue,
} from "../types";
import type { UnknownRecord } from "./validation-types-and-runtime-options";
import { isRecord, makeIssue } from "./validation-types-and-runtime-options";

export function normalizeOptionalBooleanField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a boolean when provided"),
    );
    return undefined;
  }
  return value;
}
export function normalizeNodeOutputContract(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeOutputContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set([
    "description",
    "jsonSchema",
    "maxValidationAttempts",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported output contract field",
        ),
      );
    }
  }
  const hasDescriptionKey = Object.hasOwn(value, "description");
  const hasJsonSchemaKey = Object.hasOwn(value, "jsonSchema");

  const descriptionRaw = value["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a string when provided",
      ),
    );
  } else if (typeof descriptionRaw === "string" && description === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  }

  const jsonSchemaRaw = value["jsonSchema"];
  let jsonSchema: JsonObject | undefined;
  if (jsonSchemaRaw !== undefined) {
    if (!isRecord(jsonSchemaRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.jsonSchema`,
          "must be an object when provided",
        ),
      );
    } else {
      const schemaIssues = validateJsonSchemaDefinition(
        jsonSchemaRaw as JsonObject,
      );
      schemaIssues.forEach((entry) => {
        issues.push(
          makeIssue(
            "error",
            `${path}.jsonSchema${entry.path === "$schema" ? "" : entry.path.slice("$schema".length)}`,
            entry.message,
          ),
        );
      });
      if (schemaIssues.length === 0) {
        jsonSchema = jsonSchemaRaw as JsonObject;
      }
    }
  }

  const maxValidationAttemptsRaw = value["maxValidationAttempts"];
  let maxValidationAttempts: number | undefined;
  if (maxValidationAttemptsRaw !== undefined) {
    if (
      typeof maxValidationAttemptsRaw === "number" &&
      Number.isInteger(maxValidationAttemptsRaw) &&
      maxValidationAttemptsRaw > 0
    ) {
      maxValidationAttempts = maxValidationAttemptsRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxValidationAttempts`,
          "must be an integer > 0 when provided",
        ),
      );
    }
  }

  if (!hasDescriptionKey && !hasJsonSchemaKey) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define output.description and/or output.jsonSchema when provided",
      ),
    );
  }

  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
    ...(maxValidationAttempts === undefined ? {} : { maxValidationAttempts }),
  };
}
export function normalizeNodeInputContract(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeInputContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set(["description", "jsonSchema"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported input contract field",
        ),
      );
    }
  }

  const hasDescriptionKey = Object.hasOwn(value, "description");
  const hasJsonSchemaKey = Object.hasOwn(value, "jsonSchema");

  const descriptionRaw = value["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a string when provided",
      ),
    );
  } else if (typeof descriptionRaw === "string" && description === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
      ),
    );
  }

  const jsonSchemaRaw = value["jsonSchema"];
  let jsonSchema: JsonObject | undefined;
  if (jsonSchemaRaw !== undefined) {
    if (!isRecord(jsonSchemaRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.jsonSchema`,
          "must be an object when provided",
        ),
      );
    } else {
      const schemaIssues = validateJsonSchemaDefinition(
        jsonSchemaRaw as JsonObject,
      );
      schemaIssues.forEach((entry) => {
        issues.push(
          makeIssue(
            "error",
            `${path}.jsonSchema${entry.path === "$schema" ? "" : entry.path.slice("$schema".length)}`,
            entry.message,
          ),
        );
      });
      if (schemaIssues.length === 0) {
        jsonSchema = jsonSchemaRaw as JsonObject;
      }
    }
  }

  if (!hasDescriptionKey && !hasJsonSchemaKey) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define input.description and/or input.jsonSchema when provided",
      ),
    );
  }

  return {
    ...(description === undefined ? {} : { description }),
    ...(jsonSchema === undefined ? {} : { jsonSchema }),
  };
}
export function intervalsPartiallyOverlap(
  left: Readonly<{ startOrder: number; endOrder: number }>,
  right: Readonly<{ startOrder: number; endOrder: number }>,
): boolean {
  const leftStartsInsideRight =
    right.startOrder < left.startOrder &&
    left.startOrder <= right.endOrder &&
    right.endOrder < left.endOrder;
  const rightStartsInsideLeft =
    left.startOrder < right.startOrder &&
    right.startOrder <= left.endOrder &&
    left.endOrder < right.endOrder;
  return leftStartsInsideRight || rightStartsInsideLeft;
}
export function findNodeIdByOrder(
  bundle: NormalizedWorkflowBundle,
  order: number,
): string {
  return bundle.workflow.nodes[order]?.id ?? "unknown";
}
export function pushCrossingIntervalIssue(
  issues: ValidationIssue[],
  bundle: NormalizedWorkflowBundle,
  args: {
    readonly path: string;
    readonly leftId: string;
    readonly leftStartOrder: number;
    readonly rightId: string;
    readonly rightStartOrder: number;
    readonly messagePrefix: string;
  },
): void {
  const earlierId =
    args.leftStartOrder <= args.rightStartOrder ? args.leftId : args.rightId;
  const laterId = earlierId === args.leftId ? args.rightId : args.leftId;
  const crossingNodeId = findNodeIdByOrder(
    bundle,
    args.leftStartOrder <= args.rightStartOrder
      ? args.rightStartOrder
      : args.leftStartOrder,
  );
  issues.push(
    makeIssue(
      "error",
      args.path,
      `${args.messagePrefix} '${earlierId}' and '${laterId}' cross; reorder or nest them cleanly around node '${crossingNodeId}'`,
    ),
  );
}
export function resolveCalleeStepFilePath(
  workflowDirectory: string,
  relativeStepFile: string,
): string | undefined {
  if (
    relativeStepFile.length === 0 ||
    path.posix.isAbsolute(relativeStepFile) ||
    path.win32.isAbsolute(relativeStepFile)
  ) {
    return undefined;
  }
  const segments = relativeStepFile
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }
  const resolved = path.resolve(workflowDirectory, relativeStepFile);
  const relative = path.relative(workflowDirectory, resolved);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? undefined
    : resolved;
}
export function inferSingleManagerStepIdFromRawSync(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly workflowDirectory: string;
}): { ok: true; managerStepId?: string } | { ok: false; message: string } {
  const stepsRaw = input.raw["steps"];
  if (!Array.isArray(stepsRaw)) {
    return { ok: true };
  }

  const managerIds = new Set<string>();
  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }
    const authoredId =
      typeof step["id"] === "string" && step["id"].length > 0
        ? step["id"]
        : undefined;
    if (step["role"] === "manager" && authoredId !== undefined) {
      managerIds.add(authoredId);
      continue;
    }

    const stepFile = step["stepFile"];
    if (typeof stepFile !== "string" || stepFile.length === 0) {
      continue;
    }
    const resolvedStepFile = resolveCalleeStepFilePath(
      input.workflowDirectory,
      stepFile,
    );
    if (resolvedStepFile === undefined) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must stay within workflow directory '${input.workflowDirectory}'`,
      };
    }
    let rawStep: unknown;
    try {
      rawStep = JSON.parse(readFileSync(resolvedStepFile, "utf8")) as unknown;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `failed to read callee stepFile '${stepFile}': ${error.message}`
            : `failed to read callee stepFile '${stepFile}'`,
      };
    }
    if (!isRecord(rawStep)) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must contain a JSON object`,
      };
    }
    if (rawStep["role"] !== "manager") {
      continue;
    }
    const resolvedId =
      authoredId ??
      (typeof rawStep["id"] === "string" && rawStep["id"].length > 0
        ? rawStep["id"]
        : undefined);
    if (resolvedId !== undefined) {
      managerIds.add(resolvedId);
    }
  }

  const explicitManagerStepId = input.raw["managerStepId"];
  if (
    managerIds.size > 1 &&
    !(
      typeof explicitManagerStepId === "string" &&
      explicitManagerStepId.length > 0
    )
  ) {
    return {
      ok: false,
      message:
        "callee workflow declares more than one manager-role step; set managerStepId explicitly or fix the callee workflow authorship",
    };
  }
  const managerStepId = [...managerIds][0];
  return managerStepId === undefined
    ? { ok: true }
    : { ok: true, managerStepId };
}
export async function inferSingleManagerStepIdFromRawAsync(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly workflowDirectory: string;
}): Promise<
  { ok: true; managerStepId?: string } | { ok: false; message: string }
> {
  const stepsRaw = input.raw["steps"];
  if (!Array.isArray(stepsRaw)) {
    return { ok: true };
  }

  const managerIds = new Set<string>();
  for (const step of stepsRaw) {
    if (!isRecord(step)) {
      continue;
    }
    const authoredId =
      typeof step["id"] === "string" && step["id"].length > 0
        ? step["id"]
        : undefined;
    if (step["role"] === "manager" && authoredId !== undefined) {
      managerIds.add(authoredId);
      continue;
    }

    const stepFile = step["stepFile"];
    if (typeof stepFile !== "string" || stepFile.length === 0) {
      continue;
    }
    const resolvedStepFile = resolveCalleeStepFilePath(
      input.workflowDirectory,
      stepFile,
    );
    if (resolvedStepFile === undefined) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must stay within workflow directory '${input.workflowDirectory}'`,
      };
    }
    let rawStep: unknown;
    try {
      rawStep = JSON.parse(await readFile(resolvedStepFile, "utf8")) as unknown;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? `failed to read callee stepFile '${stepFile}': ${error.message}`
            : `failed to read callee stepFile '${stepFile}'`,
      };
    }
    if (!isRecord(rawStep)) {
      return {
        ok: false,
        message: `callee stepFile '${stepFile}' must contain a JSON object`,
      };
    }
    if (rawStep["role"] !== "manager") {
      continue;
    }
    const resolvedId =
      authoredId ??
      (typeof rawStep["id"] === "string" && rawStep["id"].length > 0
        ? rawStep["id"]
        : undefined);
    if (resolvedId !== undefined) {
      managerIds.add(resolvedId);
    }
  }

  const explicitManagerStepId = input.raw["managerStepId"];
  if (
    managerIds.size > 1 &&
    !(
      typeof explicitManagerStepId === "string" &&
      explicitManagerStepId.length > 0
    )
  ) {
    return {
      ok: false,
      message:
        "callee workflow declares more than one manager-role step; set managerStepId explicitly or fix the callee workflow authorship",
    };
  }
  const managerStepId = [...managerIds][0];
  return managerStepId === undefined
    ? { ok: true }
    : { ok: true, managerStepId };
}
export function parseCalleeWorkflowJsonText(
  text: string,
):
  | { ok: true; raw: Readonly<Record<string, unknown>> }
  | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "callee workflow.json is not valid JSON" };
  }
  if (!isRecord(raw)) {
    return { ok: false, message: "callee workflow.json must be a JSON object" };
  }
  return { ok: true, raw };
}
export function resolveCalleeWorkflowJsonByIdSync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}):
  | {
      ok: true;
      raw: Readonly<Record<string, unknown>>;
      workflowDirectory: string;
    }
  | { ok: false; message: string } {
  let directoryEntries: ReturnType<typeof readdirSync>;
  try {
    directoryEntries = readdirSync(input.workflowRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `failed listing workflow root '${input.workflowRoot}': ${error.message}`
          : `failed listing workflow root '${input.workflowRoot}'`,
    };
  }

  const candidateDirectories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      if (left.name === input.workflowId) {
        return -1;
      }
      if (right.name === input.workflowId) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

  let preferredDirectoryError: string | undefined;
  for (const entry of candidateDirectories) {
    const workflowDirectory = path.join(input.workflowRoot, entry.name);
    const workflowJsonPath = path.join(workflowDirectory, "workflow.json");
    let text: string;
    try {
      text = readFileSync(workflowJsonPath, "utf8");
    } catch (error) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError =
          error instanceof Error
            ? error.message
            : "failed to read callee workflow.json";
      }
      continue;
    }
    const parsed = parseCalleeWorkflowJsonText(text);
    if (!parsed.ok) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError = parsed.message;
      }
      continue;
    }
    if (parsed.raw["workflowId"] !== input.workflowId) {
      continue;
    }
    return {
      ok: true,
      raw: parsed.raw,
      workflowDirectory,
    };
  }

  if (preferredDirectoryError !== undefined) {
    return { ok: false, message: preferredDirectoryError };
  }
  return {
    ok: false,
    message: `workflow id '${input.workflowId}' was not found under workflow root '${input.workflowRoot}'`,
  };
}
export async function resolveCalleeWorkflowJsonByIdAsync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}): Promise<
  | {
      ok: true;
      raw: Readonly<Record<string, unknown>>;
      workflowDirectory: string;
    }
  | { ok: false; message: string }
> {
  let directoryEntries: Awaited<ReturnType<typeof readdir>>;
  try {
    directoryEntries = await readdir(input.workflowRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `failed listing workflow root '${input.workflowRoot}': ${error.message}`
          : `failed listing workflow root '${input.workflowRoot}'`,
    };
  }

  const candidateDirectories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => {
      if (left.name === input.workflowId) {
        return -1;
      }
      if (right.name === input.workflowId) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

  let preferredDirectoryError: string | undefined;
  for (const entry of candidateDirectories) {
    const workflowDirectory = path.join(input.workflowRoot, entry.name);
    const workflowJsonPath = path.join(workflowDirectory, "workflow.json");
    let text: string;
    try {
      text = await readFile(workflowJsonPath, "utf8");
    } catch (error) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError =
          error instanceof Error
            ? error.message
            : "failed to read callee workflow.json";
      }
      continue;
    }
    const parsed = parseCalleeWorkflowJsonText(text);
    if (!parsed.ok) {
      if (entry.name === input.workflowId) {
        preferredDirectoryError = parsed.message;
      }
      continue;
    }
    if (parsed.raw["workflowId"] !== input.workflowId) {
      continue;
    }
    return {
      ok: true,
      raw: parsed.raw,
      workflowDirectory,
    };
  }

  if (preferredDirectoryError !== undefined) {
    return { ok: false, message: preferredDirectoryError };
  }
  return {
    ok: false,
    message: `workflow id '${input.workflowId}' was not found under workflow root '${input.workflowRoot}'`,
  };
}
export function resolveCalleeWorkflowEntry(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly inferredManagerStepId?: string;
}): { ok: true; entry: string } | { ok: false; message: string } {
  const managerStepId = input.raw["managerStepId"];
  const entryStepId = input.raw["entryStepId"];
  let entry: string | undefined;
  if (typeof managerStepId === "string" && managerStepId.length > 0) {
    entry = managerStepId;
  } else if (input.inferredManagerStepId !== undefined) {
    entry = input.inferredManagerStepId;
  } else if (typeof entryStepId === "string" && entryStepId.length > 0) {
    entry = entryStepId;
  }
  if (entry === undefined) {
    return {
      ok: false,
      message:
        "callee workflow must declare managerStepId or entryStepId (or exactly one manager-role step)",
    };
  }
  return { ok: true, entry };
}

export function resolveCalleeWorkflowEntryByIdSync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}): { ok: true; entry: string } | { ok: false; message: string } {
  const resolvedWorkflow = resolveCalleeWorkflowJsonByIdSync(input);
  if (!resolvedWorkflow.ok) {
    return { ok: false, message: resolvedWorkflow.message };
  }

  const inferred = inferSingleManagerStepIdFromRawSync({
    raw: resolvedWorkflow.raw,
    workflowDirectory: resolvedWorkflow.workflowDirectory,
  });
  if (!inferred.ok) {
    return { ok: false, message: inferred.message };
  }

  return resolveCalleeWorkflowEntry({
    raw: resolvedWorkflow.raw,
    ...(inferred.managerStepId === undefined
      ? {}
      : { inferredManagerStepId: inferred.managerStepId }),
  });
}

export async function resolveCalleeWorkflowEntryByIdAsync(input: {
  readonly workflowRoot: string;
  readonly workflowId: string;
}): Promise<{ ok: true; entry: string } | { ok: false; message: string }> {
  const resolvedWorkflow = await resolveCalleeWorkflowJsonByIdAsync(input);
  if (!resolvedWorkflow.ok) {
    return { ok: false, message: resolvedWorkflow.message };
  }

  const inferred = await inferSingleManagerStepIdFromRawAsync({
    raw: resolvedWorkflow.raw,
    workflowDirectory: resolvedWorkflow.workflowDirectory,
  });
  if (!inferred.ok) {
    return { ok: false, message: inferred.message };
  }

  return resolveCalleeWorkflowEntry({
    raw: resolvedWorkflow.raw,
    ...(inferred.managerStepId === undefined
      ? {}
      : { inferredManagerStepId: inferred.managerStepId }),
  });
}
