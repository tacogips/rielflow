import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NODE_TEMPLATE_FIELD_SPECS } from "./node-template-fields";
import {
  INLINE_NODE_FIELD,
  resolveAuthoredNodeFileReference,
  resolveWorkflowRelativeNodeFilePath,
} from "./authored-node";
import { resolveWorkflowRelativePath } from "./prompt-template-file";
import { err, ok, type Result } from "./result";
import {
  isSafeWorkflowName,
  resolveEffectiveRoots,
  resolveWorkflowScopedPath,
} from "./paths";
import { validateWorkflowBundleAsync } from "./validate";
import {
  resolveWorkflowSource,
  withResolvedWorkflowSourceOptions,
} from "./catalog";
import type {
  LoadOptions,
  NormalizedWorkflowBundle,
  ResolvedWorkflowSource,
  ValidationIssue,
} from "./types";

export interface LoadedWorkflow {
  readonly workflowName: string;
  readonly workflowDirectory: string;
  readonly artifactWorkflowRoot: string;
  readonly bundle: NormalizedWorkflowBundle;
  readonly source?: ResolvedWorkflowSource;
}

export interface LoadFailure {
  readonly code:
    | "INVALID_WORKFLOW_NAME"
    | "INVALID_SCOPE"
    | "NOT_FOUND"
    | "IO"
    | "VALIDATION";
  readonly message: string;
  readonly issues?: readonly ValidationIssue[];
}

async function readJsonFile(
  filePath: string,
): Promise<Result<unknown, LoadFailure>> {
  try {
    const raw = await readFile(filePath, "utf8");
    return ok(JSON.parse(raw) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return err({
        code: "NOT_FOUND",
        message: `required file was not found: ${filePath}`,
      });
    }
    return err({
      code: "IO",
      message: `failed reading JSON file '${filePath}': ${message}`,
    });
  }
}

async function readTextFile(
  filePath: string,
): Promise<Result<string, LoadFailure>> {
  try {
    return ok(await readFile(filePath, "utf8"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
      return err({
        code: "NOT_FOUND",
        message: `required file was not found: ${filePath}`,
      });
    }
    return err({
      code: "IO",
      message: `failed reading text file '${filePath}': ${message}`,
    });
  }
}

async function readWorkflowIdFromDirectory(
  workflowDirectory: string,
): Promise<Result<string | undefined, LoadFailure>> {
  const workflowPath = path.join(workflowDirectory, "workflow.json");
  const workflowRaw = await readJsonFile(workflowPath);
  if (!workflowRaw.ok) {
    return workflowRaw.error.code === "NOT_FOUND"
      ? ok(undefined)
      : err(workflowRaw.error);
  }

  if (
    typeof workflowRaw.value !== "object" ||
    workflowRaw.value === null ||
    Array.isArray(workflowRaw.value)
  ) {
    return ok(undefined);
  }

  const workflowId = (workflowRaw.value as { workflowId?: unknown }).workflowId;
  return typeof workflowId === "string" && workflowId.length > 0
    ? ok(workflowId)
    : ok(undefined);
}

async function resolvePromptTemplateFileForNode(input: {
  readonly workflowDirectory: string;
  readonly nodeFile: string;
  readonly rawPayload: unknown;
}): Promise<Result<unknown, LoadFailure>> {
  if (typeof input.rawPayload !== "object" || input.rawPayload === null) {
    return ok(input.rawPayload);
  }

  const payload = input.rawPayload as Record<string, unknown>;
  const resolvedPayload: Record<string, unknown> = { ...payload };
  for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
    const templateFile = payload[spec.fileField];
    if (typeof templateFile !== "string" || templateFile.length === 0) {
      continue;
    }

    const resolvedPath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      templateFile,
    );
    if (!resolvedPath.ok) {
      return err({
        code: "IO",
        message: resolvedPath.error.message,
      });
    }

    const promptText = await readTextFile(resolvedPath.value);
    if (!promptText.ok) {
      return err({
        code: promptText.error.code,
        message: `failed resolving ${spec.fileField} for '${input.nodeFile}': ${promptText.error.message}`,
      });
    }

    resolvedPayload[spec.textField] = promptText.value;
  }

  return ok(resolvedPayload);
}

export async function loadWorkflowFromDisk(
  workflowName: string,
  options: LoadOptions = {},
): Promise<Result<LoadedWorkflow, LoadFailure>> {
  if (!isSafeWorkflowName(workflowName)) {
    return err({
      code: "INVALID_WORKFLOW_NAME",
      message: `invalid workflow name '${workflowName}'`,
    });
  }

  const roots = resolveEffectiveRoots(options);
  const workflowDirectory = path.join(roots.workflowRoot, workflowName);

  const workflowPath = path.join(workflowDirectory, "workflow.json");

  const workflowRaw = await readJsonFile(workflowPath);
  if (!workflowRaw.ok) {
    return err(workflowRaw.error);
  }

  if (
    typeof workflowRaw.value !== "object" ||
    workflowRaw.value === null ||
    !Array.isArray((workflowRaw.value as { nodes?: unknown }).nodes)
  ) {
    return err({
      code: "VALIDATION",
      message: "workflow.json is missing nodes[]",
      issues: [
        {
          severity: "error",
          path: "workflow.nodes",
          message: "must be an array",
        },
      ],
    });
  }

  const workflowNodes = (
    workflowRaw.value as { nodes: Array<Record<string, unknown>> }
  ).nodes;
  const nodePayloads: Record<string, unknown> = {};

  for (const [index, node] of workflowNodes.entries()) {
    const nodeFile = resolveAuthoredNodeFileReference(node);
    if (nodeFile === undefined) {
      continue;
    }

    const inlineNodePayload = node[INLINE_NODE_FIELD];
    let rawPayload: unknown;
    if (typeof node["nodeFile"] === "string") {
      const nodeFilePath = resolveWorkflowRelativeNodeFilePath(
        workflowDirectory,
        nodeFile,
      );
      if (!nodeFilePath.ok) {
        return err({
          code: "VALIDATION",
          message: "workflow validation failed",
          issues: [
            {
              severity: "error",
              path: `workflow.nodes[${index}].nodeFile`,
              message: nodeFilePath.error.message,
            },
          ],
        });
      }
      const nodeRaw = await readJsonFile(nodeFilePath.value);
      if (!nodeRaw.ok) {
        return err(nodeRaw.error);
      }
      rawPayload = nodeRaw.value;
    } else {
      rawPayload = inlineNodePayload;
    }

    const resolvedNodeRaw = await resolvePromptTemplateFileForNode({
      workflowDirectory,
      nodeFile,
      rawPayload,
    });
    if (!resolvedNodeRaw.ok) {
      return err(resolvedNodeRaw.error);
    }
    nodePayloads[nodeFile] = resolvedNodeRaw.value;
  }

  const validation = await validateWorkflowBundleAsync(
    {
      workflow: workflowRaw.value,
      nodePayloads,
    },
    options,
  );

  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: validation.error,
    });
  }

  const artifactWorkflowRoot = resolveWorkflowScopedPath(
    roots.artifactRoot,
    validation.value.workflow.workflowId,
  );
  if (artifactWorkflowRoot === undefined) {
    return err({
      code: "VALIDATION",
      message: "workflow validation failed",
      issues: [
        {
          severity: "error",
          path: "workflow.workflowId",
          message:
            "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
        },
      ],
    });
  }

  return ok({
    workflowName,
    workflowDirectory,
    artifactWorkflowRoot,
    bundle: validation.value,
  });
}

export async function loadWorkflowFromCatalog(
  workflowName: string,
  options: LoadOptions = {},
): Promise<Result<LoadedWorkflow, LoadFailure>> {
  const source = await resolveWorkflowSource(workflowName, options);
  if (!source.ok) {
    return err({
      code:
        source.error.code === "INVALID_WORKFLOW_NAME"
          ? "INVALID_WORKFLOW_NAME"
          : source.error.code === "INVALID_SCOPE"
            ? "INVALID_SCOPE"
            : source.error.code === "IO"
              ? "IO"
              : "NOT_FOUND",
      message: source.error.message,
    });
  }

  const loaded = await loadWorkflowFromDisk(
    workflowName,
    withResolvedWorkflowSourceOptions(source.value, options),
  );
  if (!loaded.ok) {
    return loaded;
  }

  return ok({
    ...loaded.value,
    source: source.value,
  });
}

export async function loadWorkflowByIdFromDisk(
  workflowId: string,
  options: LoadOptions = {},
): Promise<Result<LoadedWorkflow, LoadFailure>> {
  const direct = await loadWorkflowFromDisk(workflowId, options);
  if (direct.ok && direct.value.bundle.workflow.workflowId === workflowId) {
    return direct;
  }

  const roots = resolveEffectiveRoots(options);
  let directoryEntries: Awaited<ReturnType<typeof readdir>>;
  try {
    directoryEntries = await readdir(roots.workflowRoot, {
      withFileTypes: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "IO",
      message: `failed listing workflow root '${roots.workflowRoot}': ${message}`,
    });
  }

  const candidateDirectories = directoryEntries
    .filter((entry) => entry.isDirectory() && entry.name !== workflowId)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of candidateDirectories) {
    const candidateWorkflowDirectory = path.join(
      roots.workflowRoot,
      entry.name,
    );
    const candidateWorkflowId = await readWorkflowIdFromDirectory(
      candidateWorkflowDirectory,
    );
    if (!candidateWorkflowId.ok) {
      continue;
    }
    if (candidateWorkflowId.value !== workflowId) {
      continue;
    }

    return await loadWorkflowFromDisk(entry.name, options);
  }

  if (direct.ok) {
    return err({
      code: "NOT_FOUND",
      message: `workflow id '${workflowId}' was not found under workflow root '${roots.workflowRoot}'`,
    });
  }

  return direct.error.code === "NOT_FOUND"
    ? err({
        code: "NOT_FOUND",
        message: `workflow id '${workflowId}' was not found under workflow root '${roots.workflowRoot}'`,
      })
    : direct;
}
