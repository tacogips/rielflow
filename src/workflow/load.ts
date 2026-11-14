import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  cloneNodeTemplateAwarePayload,
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "./node-template-fields";
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

function resolveWorkflowBundleDirectory(
  options: LoadOptions,
  rootsWorkflowRoot: string,
  workflowName: string,
): string {
  if (options.workflowBundleDirectoryOverride !== undefined) {
    return path.resolve(
      options.cwd ?? process.cwd(),
      options.workflowBundleDirectoryOverride,
    );
  }
  return path.join(rootsWorkflowRoot, workflowName);
}

/**
 * When a session is tied to a supervision execution copy (or in-place) bundle path,
 * load that directory instead of the workflow catalog path.
 */
export function mergeLoadOptionsForSessionMutableBundle(
  options: LoadOptions,
  session: { readonly supervision?: { readonly mutableWorkflowDir?: string } },
): LoadOptions {
  const dir = session.supervision?.mutableWorkflowDir;
  if (dir === undefined) {
    return options;
  }
  if (options.workflowBundleDirectoryOverride !== undefined) {
    return options;
  }
  return { ...options, workflowBundleDirectoryOverride: dir };
}

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
  const resolvedPayload = cloneNodeTemplateAwarePayload(payload);
  for (const { record } of listNodeTemplateFieldContainers(resolvedPayload)) {
    for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
      const templateFile = record[spec.fileField];
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

      record[spec.textField] = promptText.value;
    }
  }

  return ok(resolvedPayload);
}

async function resolveWorkflowStepFiles(input: {
  readonly workflowDirectory: string;
  readonly workflow: unknown;
}): Promise<Result<unknown, LoadFailure>> {
  if (
    typeof input.workflow !== "object" ||
    input.workflow === null ||
    Array.isArray(input.workflow)
  ) {
    return ok(input.workflow);
  }

  const workflowRecord = input.workflow as Record<string, unknown>;
  const stepsRaw = workflowRecord["steps"];
  if (!Array.isArray(stepsRaw)) {
    return ok(input.workflow);
  }

  const resolvedSteps: unknown[] = [];
  for (const [index, step] of stepsRaw.entries()) {
    if (typeof step !== "object" || step === null || Array.isArray(step)) {
      resolvedSteps.push(step);
      continue;
    }

    const stepRecord = step as Record<string, unknown>;
    const stepFileRaw = stepRecord["stepFile"];
    if (typeof stepFileRaw !== "string" || stepFileRaw.length === 0) {
      resolvedSteps.push(step);
      continue;
    }

    const unsupportedInlineFields = Object.keys(stepRecord).filter(
      (key) => key !== "id" && key !== "stepFile",
    );
    if (unsupportedInlineFields.length > 0) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: unsupportedInlineFields.map((fieldName) => ({
          severity: "error" as const,
          path: `workflow.steps[${index}].${fieldName}`,
          message:
            "must not be authored inline when workflow.steps[].stepFile is used",
        })),
      });
    }

    const resolvedPath = resolveWorkflowRelativePath(
      input.workflowDirectory,
      stepFileRaw,
    );
    if (!resolvedPath.ok) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: [
          {
            severity: "error",
            path: `workflow.steps[${index}].stepFile`,
            message: resolvedPath.error.message,
          },
        ],
      });
    }

    const stepRaw = await readJsonFile(resolvedPath.value);
    if (!stepRaw.ok) {
      return err(stepRaw.error);
    }
    if (
      typeof stepRaw.value !== "object" ||
      stepRaw.value === null ||
      Array.isArray(stepRaw.value)
    ) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: [
          {
            severity: "error",
            path: `workflow.steps[${index}]`,
            message: "step file must contain an object",
          },
        ],
      });
    }

    const resolvedStepRecord = stepRaw.value as Record<string, unknown>;
    const stepIdRaw = stepRecord["id"];
    const resolvedStepIdRaw = resolvedStepRecord["id"];
    if (
      typeof stepIdRaw === "string" &&
      stepIdRaw.length > 0 &&
      typeof resolvedStepIdRaw === "string" &&
      resolvedStepIdRaw.length > 0 &&
      stepIdRaw !== resolvedStepIdRaw
    ) {
      return err({
        code: "VALIDATION",
        message: "workflow validation failed",
        issues: [
          {
            severity: "error",
            path: `workflow.steps[${index}].stepFile`,
            message: `step file id '${resolvedStepIdRaw}' must match workflow step id '${stepIdRaw}'`,
          },
        ],
      });
    }

    resolvedSteps.push({
      ...resolvedStepRecord,
      ...stepRecord,
      ...(stepRecord["id"] === undefined ? {} : { id: stepRecord["id"] }),
      stepFile: stepFileRaw,
    });
  }

  return ok({
    ...workflowRecord,
    steps: resolvedSteps,
  });
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
  const workflowDirectory = resolveWorkflowBundleDirectory(
    options,
    roots.workflowRoot,
    workflowName,
  );

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

  const resolvedWorkflow = await resolveWorkflowStepFiles({
    workflowDirectory,
    workflow: workflowRaw.value,
  });
  if (!resolvedWorkflow.ok) {
    return err(resolvedWorkflow.error);
  }

  const workflowNodes = (
    resolvedWorkflow.value as { nodes: Array<Record<string, unknown>> }
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
      workflow: resolvedWorkflow.value,
      nodePayloads,
    },
    {
      ...options,
      allowResolvedStepFileFields: true,
    },
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
  // Callee resolution always walks the workflow root; never inherit a root run's
  // execution-copy bundle directory.
  const { workflowBundleDirectoryOverride: _bdo, ...discoveryOptions } =
    options;
  const direct = await loadWorkflowFromDisk(workflowId, discoveryOptions);
  if (direct.ok && direct.value.bundle.workflow.workflowId === workflowId) {
    return direct;
  }

  const roots = resolveEffectiveRoots(discoveryOptions);
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

    return await loadWorkflowFromDisk(entry.name, discoveryOptions);
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
