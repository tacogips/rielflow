import { createHash } from "node:crypto";
import path from "node:path";
import { parseWorkflowBundleInput } from "rielflow-core/workflow-bundle-input";
import {
  listNodeTemplateFieldContainers,
  NODE_TEMPLATE_FIELD_SPECS,
} from "./node-template-fields";
import { err, ok, type Result } from "./result";
import { resolveEffectiveRoots, resolveWorkflowScopedPath } from "./paths";
import { validateWorkflowBundleDetailedAsync } from "./validate";
import type { LoadedWorkflow, LoadFailure } from "./load";
import type {
  LoadOptions,
  NormalizedWorkflowBundle,
  TemporaryWorkflowSourceMetadata,
  ValidationIssue,
} from "./types";

export type TemporaryWorkflowInputKind = "inline-json" | "json-file";

export interface TemporaryWorkflowPayloadInput {
  readonly kind: TemporaryWorkflowInputKind;
  readonly value: unknown;
  readonly displayPath?: string;
}

export interface LoadedTemporaryWorkflow {
  readonly loadedWorkflow: LoadedWorkflow;
  readonly inputPayload: unknown;
  readonly normalizedPayload: NormalizedWorkflowBundle;
  readonly metadata: TemporaryWorkflowSourceMetadata;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeTemporaryWorkflowIssue(
  pathLabel: string,
  message: string,
): ValidationIssue {
  return {
    severity: "error",
    path: pathLabel,
    message: `${message}; temporary workflows must embed prompt and related prompt content directly in JSON`,
  };
}

function parseInlineJsonPayload(value: unknown): Result<unknown, LoadFailure> {
  if (typeof value !== "string") {
    return ok(value);
  }
  try {
    return ok(JSON.parse(value) as unknown);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err({
      code: "VALIDATION",
      message: `failed parsing --workflow-json: ${message}`,
    });
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (!isRecord(value)) {
    return JSON.stringify(value) ?? "undefined";
  }
  return `{${Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function temporaryWorkflowContentDigest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function collectTemporaryExternalFileIssues(
  workflow: Readonly<Record<string, unknown>>,
  nodePayloads: Readonly<Record<string, unknown>>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const steps = workflow["steps"];
  if (Array.isArray(steps)) {
    steps.forEach((step, index) => {
      if (!isRecord(step)) {
        return;
      }
      if (step["stepFile"] !== undefined) {
        issues.push(
          makeTemporaryWorkflowIssue(
            `workflow.steps[${index}].stepFile`,
            "stepFile is not supported",
          ),
        );
      }
    });
  }

  const nodes = workflow["nodes"];
  if (Array.isArray(nodes)) {
    nodes.forEach((node, index) => {
      if (!isRecord(node)) {
        return;
      }
      const nodeId = node["id"];
      const nodeFile = node["nodeFile"];
      if (
        typeof nodeFile === "string" &&
        nodeFile.length > 0 &&
        nodePayloads[nodeFile] === undefined &&
        (typeof nodeId !== "string" || nodePayloads[nodeId] === undefined)
      ) {
        issues.push(
          makeTemporaryWorkflowIssue(
            `workflow.nodes[${index}].nodeFile`,
            `nodeFile '${nodeFile}' has no embedded payload in nodePayloads`,
          ),
        );
      }
    });
  }

  for (const [nodeKey, payload] of Object.entries(nodePayloads)) {
    if (!isRecord(payload)) {
      continue;
    }
    for (const {
      path: containerPath,
      record,
    } of listNodeTemplateFieldContainers({ ...payload })) {
      for (const spec of NODE_TEMPLATE_FIELD_SPECS) {
        if (record[spec.fileField] === undefined) {
          continue;
        }
        const nestedPath =
          containerPath.length === 0 ? "" : `.${containerPath}`;
        issues.push(
          makeTemporaryWorkflowIssue(
            `nodePayloads.${nodeKey}${nestedPath}.${spec.fileField}`,
            `${spec.fileField} is not supported`,
          ),
        );
      }
    }
  }

  return issues;
}

function temporarySourceForLoadedWorkflow(input: {
  readonly workflowName: string;
  readonly metadata: TemporaryWorkflowSourceMetadata;
  readonly displayPath?: string;
}): NonNullable<LoadedWorkflow["source"]> {
  const displayPath = input.displayPath ?? "<temporary-workflow>";
  return {
    scope: "temporary",
    workflowRoot: "",
    workflowName: input.workflowName,
    workflowDirectory: displayPath,
    temporaryWorkflow: input.metadata,
  };
}

export async function loadedTemporaryWorkflowFromNormalizedPayload(input: {
  readonly inputPayload: unknown;
  readonly normalizedPayload: NormalizedWorkflowBundle;
  readonly metadata: TemporaryWorkflowSourceMetadata;
  readonly options: LoadOptions;
}): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>> {
  const roots = resolveEffectiveRoots(input.options);
  const workflow = input.normalizedPayload.workflow;
  const artifactWorkflowRoot = resolveWorkflowScopedPath(
    roots.artifactRoot,
    workflow.workflowId,
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

  const workflowName = workflow.workflowId;
  const displayPath =
    input.metadata.displayPath === undefined
      ? undefined
      : path.resolve(
          input.options.cwd ?? process.cwd(),
          input.metadata.displayPath,
        );
  const source = temporarySourceForLoadedWorkflow({
    workflowName,
    metadata: input.metadata,
    ...(displayPath === undefined ? {} : { displayPath }),
  });
  const loadedWorkflow: LoadedWorkflow = {
    workflowName,
    workflowDirectory: displayPath ?? "<temporary-workflow>",
    artifactWorkflowRoot,
    workflowDefinitionJsonBody: `${JSON.stringify(input.normalizedPayload.workflow, null, 2)}\n`,
    bundle: input.normalizedPayload,
    validationIssues: [],
    nodeValidationResults: [],
    source,
  };
  return ok({
    loadedWorkflow,
    inputPayload: input.inputPayload,
    normalizedPayload: input.normalizedPayload,
    metadata: input.metadata,
  });
}

export async function normalizeTemporaryWorkflowPayload(
  input: TemporaryWorkflowPayloadInput,
  options: LoadOptions,
): Promise<Result<LoadedTemporaryWorkflow, LoadFailure>> {
  const parsedPayload =
    input.kind === "inline-json"
      ? parseInlineJsonPayload(input.value)
      : ok(input.value);
  if (!parsedPayload.ok) {
    return parsedPayload;
  }

  const bundleInput = parseWorkflowBundleInput(
    parsedPayload.value,
    "workflowJson",
  );
  if (!bundleInput.ok) {
    return err({
      code: "VALIDATION",
      message:
        "temporary workflow payload must use the supported format { workflow, nodePayloads }",
      issues: [
        {
          severity: "error",
          path: "workflowJson",
          message: bundleInput.error,
        },
      ],
    });
  }

  const externalIssues = collectTemporaryExternalFileIssues(
    bundleInput.value.workflow,
    bundleInput.value.nodePayloads,
  );
  if (externalIssues.length > 0) {
    return err({
      code: "VALIDATION",
      message: "temporary workflow validation failed",
      issues: externalIssues,
    });
  }

  const validation = await validateWorkflowBundleDetailedAsync(
    {
      workflow: bundleInput.value.workflow,
      nodePayloads: bundleInput.value.nodePayloads,
    },
    options,
  );
  if (!validation.ok) {
    return err({
      code: "VALIDATION",
      message: "temporary workflow validation failed",
      issues: validation.error,
    });
  }

  const metadata: TemporaryWorkflowSourceMetadata = {
    input: input.kind,
    ...(input.displayPath === undefined
      ? {}
      : { displayPath: input.displayPath }),
    contentDigest: temporaryWorkflowContentDigest(parsedPayload.value),
  };
  return loadedTemporaryWorkflowFromNormalizedPayload({
    inputPayload: parsedPayload.value,
    normalizedPayload: validation.value.bundle,
    metadata,
    options,
  });
}
