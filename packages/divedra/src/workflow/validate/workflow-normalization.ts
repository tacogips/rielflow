import { synthesizeInlineNodeFile } from "../authored-node";
import { collectStepAddressedAuthoredWorkflowFieldIssues } from "../authored-workflow";
import { isSafeWorkflowId } from "../paths";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
} from "../prompt-template-file";
import {
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  type NodePromptVariant,
  type ValidationIssue,
  type WorkflowJson,
  type WorkflowSelfImproveMode,
  type WorkflowNodeRef,
  type WorkflowNodeRegistryRef,
  type WorkflowPrompts,
  type WorkflowStepRef,
} from "../types";
import type {
  UnknownRecord,
  WorkflowValidationOptions,
} from "./validation-types-and-runtime-options";
import {
  isRecord,
  makeIssue,
  normalizeContainerRuntimeDefaults,
  normalizeWorkflowSupervisionDefaults,
  readNumberField,
  readPositiveIntegerField,
  readStringField,
} from "./validation-types-and-runtime-options";
import { normalizeWorkflowTimeoutPolicy } from "./node-container-and-addon-validation";
import {
  normalizeWorkflowNodeRegistryRef,
  normalizeWorkflowStepRef,
} from "./workflow-step-validation";

function normalizeWorkflowSelfImproveDefaults(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowJson["defaults"]["selfImprove"] {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set(["enabled", "mode", "defaultLogLimit"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported self-improve defaults field",
        ),
      );
    }
  }

  const enabledRaw = value["enabled"];
  let enabled: boolean | undefined;
  if (enabledRaw !== undefined) {
    if (typeof enabledRaw === "boolean") {
      enabled = enabledRaw;
    } else {
      issues.push(makeIssue("error", `${path}.enabled`, "must be a boolean"));
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowSelfImproveMode | undefined;
  if (modeRaw !== undefined) {
    if (modeRaw === "report-only" || modeRaw === "report-and-auto-improve") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be report-only or report-and-auto-improve",
        ),
      );
    }
  }

  const defaultLogLimit =
    value["defaultLogLimit"] === undefined
      ? undefined
      : readPositiveIntegerField(value, "defaultLogLimit", path, issues);

  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(mode === undefined ? {} : { mode }),
    ...(defaultLogLimit === undefined || defaultLogLimit === null
      ? {}
      : { defaultLogLimit }),
  };
}

export function normalizeStepAddressedWorkflow(
  workflow: UnknownRecord,
  issues: ValidationIssue[],
  options: WorkflowValidationOptions,
): WorkflowJson | null {
  const workflowId = readStringField(
    workflow,
    "workflowId",
    "workflow",
    issues,
  );
  if (workflowId !== null && !isSafeWorkflowId(workflowId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowId",
        "must start with an alphanumeric character and contain only letters, digits, hyphens, or underscores",
      ),
    );
  }

  const descriptionRaw = workflow["description"];
  let description = "";
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
      description = descriptionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.description",
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const defaultsValue = workflow["defaults"];
  if (!isRecord(defaultsValue)) {
    issues.push(makeIssue("error", "workflow.defaults", "must be an object"));
  }
  const nodeTimeoutMs =
    isRecord(defaultsValue) && defaultsValue["nodeTimeoutMs"] !== undefined
      ? readNumberField(
          defaultsValue,
          "nodeTimeoutMs",
          "workflow.defaults",
          issues,
        )
      : DEFAULT_NODE_TIMEOUT_MS;
  const maxLoopIterationsRaw =
    isRecord(defaultsValue) && defaultsValue["maxLoopIterations"] !== undefined
      ? readNumberField(
          defaultsValue,
          "maxLoopIterations",
          "workflow.defaults",
          issues,
        )
      : DEFAULT_MAX_LOOP_ITERATIONS;
  const fanoutConcurrency =
    isRecord(defaultsValue) && defaultsValue["fanoutConcurrency"] !== undefined
      ? readPositiveIntegerField(
          defaultsValue,
          "fanoutConcurrency",
          "workflow.defaults",
          issues,
        )
      : 20;
  const supervision = normalizeWorkflowSupervisionDefaults(
    isRecord(defaultsValue) ? defaultsValue["supervision"] : undefined,
    "workflow.defaults.supervision",
    issues,
  );
  const containerRuntime = normalizeContainerRuntimeDefaults(
    isRecord(defaultsValue) ? defaultsValue["containerRuntime"] : undefined,
    "workflow.defaults.containerRuntime",
    issues,
  );
  const timeoutPolicy = normalizeWorkflowTimeoutPolicy(
    isRecord(defaultsValue) ? defaultsValue["timeoutPolicy"] : undefined,
    "workflow.defaults.timeoutPolicy",
    issues,
  );
  const selfImprove = normalizeWorkflowSelfImproveDefaults(
    isRecord(defaultsValue) ? defaultsValue["selfImprove"] : undefined,
    "workflow.defaults.selfImprove",
    issues,
  );

  let prompts: WorkflowPrompts | undefined;
  const promptsRaw = workflow["prompts"];
  if (promptsRaw !== undefined) {
    if (!isRecord(promptsRaw)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.prompts",
          "must be an object when provided",
        ),
      );
    } else {
      const divedraPromptTemplateRaw = promptsRaw["divedraPromptTemplate"];
      const workerSystemPromptTemplateRaw =
        promptsRaw["workerSystemPromptTemplate"];

      if (
        divedraPromptTemplateRaw !== undefined &&
        typeof divedraPromptTemplateRaw !== "string"
      ) {
        issues.push(
          makeIssue(
            "error",
            "workflow.prompts.divedraPromptTemplate",
            "must be a string when provided",
          ),
        );
      }
      if (
        workerSystemPromptTemplateRaw !== undefined &&
        typeof workerSystemPromptTemplateRaw !== "string"
      ) {
        issues.push(
          makeIssue(
            "error",
            "workflow.prompts.workerSystemPromptTemplate",
            "must be a string when provided",
          ),
        );
      }

      prompts = {
        ...(typeof divedraPromptTemplateRaw === "string"
          ? { divedraPromptTemplate: divedraPromptTemplateRaw }
          : {}),
        ...(typeof workerSystemPromptTemplateRaw === "string"
          ? { workerSystemPromptTemplate: workerSystemPromptTemplateRaw }
          : {}),
      };
    }
  }

  const entryStepId = readStringField(
    workflow,
    "entryStepId",
    "workflow",
    issues,
  );
  const managerStepIdRaw = workflow["managerStepId"];
  let managerStepId: string | undefined | null;
  if (managerStepIdRaw !== undefined) {
    if (typeof managerStepIdRaw === "string" && managerStepIdRaw.length > 0) {
      managerStepId = managerStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          "must be a non-empty string when provided",
        ),
      );
      managerStepId = null;
    }
  }

  issues.push(...collectStepAddressedAuthoredWorkflowFieldIssues(workflow));

  const nodeRegistryRaw = workflow["nodes"];
  if (!Array.isArray(nodeRegistryRaw)) {
    issues.push(makeIssue("error", "workflow.nodes", "must be an array"));
  }
  const nodeRegistry = Array.isArray(nodeRegistryRaw)
    ? nodeRegistryRaw
        .map((entry, index) =>
          normalizeWorkflowNodeRegistryRef(entry, index, issues),
        )
        .filter((entry): entry is WorkflowNodeRegistryRef => entry !== null)
    : [];
  if (Array.isArray(nodeRegistryRaw) && nodeRegistry.length === 0) {
    issues.push(
      makeIssue(
        "error",
        "workflow.nodes",
        "must contain at least one workflow node registry entry",
      ),
    );
  }

  const stepsRaw = workflow["steps"];
  if (!Array.isArray(stepsRaw)) {
    issues.push(makeIssue("error", "workflow.steps", "must be an array"));
  }
  const steps = Array.isArray(stepsRaw)
    ? stepsRaw
        .map((entry, index) =>
          normalizeWorkflowStepRef(entry, index, issues, options),
        )
        .filter((entry): entry is WorkflowStepRef => entry !== null)
    : [];
  if (Array.isArray(stepsRaw) && steps.length === 0) {
    issues.push(
      makeIssue("error", "workflow.steps", "must contain at least one step"),
    );
  }

  const seenNodeRegistryIds = new Set<string>();
  nodeRegistry.forEach((node, index) => {
    if (seenNodeRegistryIds.has(node.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].id`,
          `duplicate node registry id '${node.id}'`,
        ),
      );
      return;
    }
    seenNodeRegistryIds.add(node.id);
  });

  const seenStepIds = new Set<string>();
  steps.forEach((step, index) => {
    if (seenStepIds.has(step.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].id`,
          `duplicate step id '${step.id}'`,
        ),
      );
      return;
    }
    seenStepIds.add(step.id);
  });

  const stepIdSet = new Set(steps.map((step) => step.id));
  const explicitManagerSteps = steps.filter((step) => step.role === "manager");
  if (explicitManagerSteps.length > 1) {
    issues.push(
      makeIssue(
        "error",
        "workflow.steps",
        "must not declare more than one manager-role step",
      ),
    );
  }
  if (managerStepId === undefined && explicitManagerSteps.length === 1) {
    managerStepId = explicitManagerSteps[0]?.id;
  }
  if (managerStepId !== undefined && managerStepId !== null) {
    if (!stepIdSet.has(managerStepId)) {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          `must reference an existing step id (${managerStepId})`,
        ),
      );
    }
    const explicitManagerStep = explicitManagerSteps[0];
    if (
      explicitManagerStep !== undefined &&
      explicitManagerStep.id !== managerStepId
    ) {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerStepId",
          `must match the authored manager-role step '${explicitManagerStep.id}'`,
        ),
      );
    }
  }
  if (entryStepId !== null && !stepIdSet.has(entryStepId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryStepId",
        `must reference an existing step id (${entryStepId})`,
      ),
    );
  }

  steps.forEach((step, index) => {
    const registryNode = nodeRegistry.find((node) => node.id === step.nodeId);
    if (registryNode === undefined) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].nodeId`,
          `must reference an existing workflow node registry entry (${step.nodeId})`,
        ),
      );
    } else {
      const stepRole =
        step.role ?? (step.id === managerStepId ? "manager" : "worker");
      if (stepRole === "manager" && registryNode.addon !== undefined) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${index}].nodeId`,
            `manager step '${step.id}' must reference a file-backed node; add-on-backed node registry entry '${step.nodeId}' is worker-only`,
          ),
        );
      }
    }
    const crossWorkflowTransitions = (step.transitions ?? []).filter(
      (t) => t.toWorkflowId !== undefined,
    );
    if (crossWorkflowTransitions.length > 1) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}]`,
          "must have at most one cross-workflow transition (toWorkflowId)",
        ),
      );
    }
    const seenFanoutGroupIds = new Set<string>();
    step.transitions?.forEach((transition, transitionIndex) => {
      if (transition.fanout !== undefined) {
        if (seenFanoutGroupIds.has(transition.fanout.groupId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.groupId`,
              `duplicate fanout groupId '${transition.fanout.groupId}' on step '${step.id}'`,
            ),
          );
        }
        seenFanoutGroupIds.add(transition.fanout.groupId);
        if (!stepIdSet.has(transition.fanout.joinStepId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.joinStepId`,
              `must reference an existing step id (${transition.fanout.joinStepId})`,
            ),
          );
        }
        if (
          transition.toWorkflowId !== undefined &&
          transition.resumeStepId !== transition.fanout.joinStepId
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              "must equal fanout.joinStepId when cross-workflow fanout is set",
            ),
          );
        }
        if (
          transition.fanout.concurrency !== undefined &&
          fanoutConcurrency !== null &&
          transition.fanout.concurrency > fanoutConcurrency
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.concurrency`,
              `must not exceed workflow.defaults.fanoutConcurrency (${fanoutConcurrency})`,
            ),
          );
        }
        const effectiveFanoutConcurrency =
          transition.fanout.concurrency ?? fanoutConcurrency ?? 20;
        if (
          effectiveFanoutConcurrency > 1 &&
          transition.fanout.writeOwnership === undefined
        ) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].fanout.writeOwnership`,
              "is required for concurrent fanout; declare read-only, disjoint-paths, or isolated-workspace ownership",
            ),
          );
        }
      }
      if (transition.toWorkflowId !== undefined) {
        if (transition.resumeStepId === undefined) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              "is required when toWorkflowId is set (parent step to resume after the callee workflow completes)",
            ),
          );
        } else if (!stepIdSet.has(transition.resumeStepId)) {
          issues.push(
            makeIssue(
              "error",
              `workflow.steps[${index}].transitions[${transitionIndex}].resumeStepId`,
              `must reference an existing step id (${transition.resumeStepId})`,
            ),
          );
        }
      }
      if (
        transition.toWorkflowId === undefined &&
        !stepIdSet.has(transition.toStepId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `workflow.steps[${index}].transitions[${transitionIndex}].toStepId`,
            `must reference an existing step id (${transition.toStepId})`,
          ),
        );
      }
    });
    if (
      step.sessionPolicy?.inheritFromStepId !== undefined &&
      !stepIdSet.has(step.sessionPolicy.inheritFromStepId)
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.steps[${index}].sessionPolicy.inheritFromStepId`,
          `must reference an existing step id (${step.sessionPolicy.inheritFromStepId})`,
        ),
      );
    }
  });

  if (
    workflowId === null ||
    entryStepId === null ||
    managerStepId === null ||
    typeof nodeTimeoutMs !== "number" ||
    typeof maxLoopIterationsRaw !== "number" ||
    typeof fanoutConcurrency !== "number"
  ) {
    return null;
  }

  const nodesMaterializedFromSteps: WorkflowNodeRef[] = steps.map((step) => {
    const registryNode = nodeRegistry.find((node) => node.id === step.nodeId);
    const role =
      step.role ?? (step.id === managerStepId ? "manager" : "worker");
    return {
      id: step.id,
      nodeFile: registryNode?.nodeFile ?? synthesizeInlineNodeFile(step.id),
      ...(registryNode?.addon === undefined
        ? {}
        : { addon: registryNode.addon }),
      ...(registryNode?.execution === undefined
        ? {}
        : { execution: registryNode.execution }),
      ...(registryNode?.kind === undefined ? {} : { kind: registryNode.kind }),
      ...(registryNode?.repeat === undefined
        ? {}
        : { repeat: registryNode.repeat }),
      role,
    };
  });
  return {
    workflowId,
    description,
    defaults: {
      nodeTimeoutMs,
      maxLoopIterations: maxLoopIterationsRaw,
      fanoutConcurrency,
      ...(supervision === undefined ? {} : { supervision }),
      ...(timeoutPolicy === undefined ? {} : { timeoutPolicy }),
      ...(containerRuntime === undefined ? {} : { containerRuntime }),
      ...(selfImprove === undefined ? {} : { selfImprove }),
    },
    ...(prompts === undefined ? {} : { prompts }),
    hasManagerNode: managerStepId !== undefined,
    ...(managerStepId === undefined ? {} : { managerStepId }),
    entryStepId,
    nodeRegistry,
    steps,
    nodes: nodesMaterializedFromSteps,
  };
}
export function normalizeWorkflow(
  workflow: unknown,
  issues: ValidationIssue[],
  options: WorkflowValidationOptions,
): WorkflowJson | null {
  if (!isRecord(workflow)) {
    issues.push(makeIssue("error", "workflow", "must be an object"));
    return null;
  }
  return normalizeStepAddressedWorkflow(workflow, issues, options);
}
export function normalizeNodeTemplateFields(args: {
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly templateField: string;
  readonly templateFileField: string;
}): {
  readonly template?: string;
  readonly templateFile?: string;
} {
  const templateRaw = args.payload[args.templateField];
  const templateFileRaw = args.payload[args.templateFileField];

  let template: string | undefined;
  let templateFile: string | undefined;

  if (templateFileRaw !== undefined) {
    if (typeof templateFileRaw === "string" && templateFileRaw.length > 0) {
      if (isSafeWorkflowRelativePath(templateFileRaw)) {
        if (isReservedWorkflowDefinitionPath(templateFileRaw)) {
          args.issues.push(
            makeIssue(
              "error",
              `${args.path}.${args.templateFileField}`,
              "must not target canonical workflow definition files such as workflow.json or node-*.json",
            ),
          );
        } else {
          templateFile = templateFileRaw;
        }
      } else {
        args.issues.push(
          makeIssue(
            "error",
            `${args.path}.${args.templateFileField}`,
            "must be a workflow-relative path without '.' or '..' segments",
          ),
        );
      }
    } else {
      args.issues.push(
        makeIssue(
          "error",
          `${args.path}.${args.templateFileField}`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (typeof templateRaw === "string" && templateRaw.length > 0) {
    template = templateRaw;
  } else if (templateRaw !== undefined && typeof templateRaw !== "string") {
    args.issues.push(
      makeIssue(
        "error",
        `${args.path}.${args.templateField}`,
        "must be a non-empty string when provided",
      ),
    );
  } else if (typeof templateRaw === "string" && templateRaw.length === 0) {
    args.issues.push(
      makeIssue(
        "error",
        `${args.path}.${args.templateField}`,
        "must be a non-empty string when provided",
      ),
    );
  }

  return {
    ...(template === undefined ? {} : { template }),
    ...(templateFile === undefined ? {} : { templateFile }),
  };
}
export function normalizeNodePromptVariants(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, NodePromptVariant>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const variants: Record<string, NodePromptVariant> = {};
  for (const [variantName, variantValue] of Object.entries(value)) {
    if (variantName.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${variantName}`,
          "variant names must be non-empty strings",
        ),
      );
      continue;
    }
    if (!isRecord(variantValue)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${variantName}`,
          "must be an object when provided",
        ),
      );
      continue;
    }
    const normalizedSystemPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "systemPromptTemplate",
      templateFileField: "systemPromptTemplateFile",
    });
    const normalizedPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "promptTemplate",
      templateFileField: "promptTemplateFile",
    });
    const normalizedSessionStartPromptTemplate = normalizeNodeTemplateFields({
      path: `${path}.${variantName}`,
      payload: variantValue,
      issues,
      templateField: "sessionStartPromptTemplate",
      templateFileField: "sessionStartPromptTemplateFile",
    });

    variants[variantName] = {
      ...(normalizedSystemPromptTemplate.template === undefined
        ? {}
        : {
            systemPromptTemplate: normalizedSystemPromptTemplate.template,
          }),
      ...(normalizedSystemPromptTemplate.templateFile === undefined
        ? {}
        : {
            systemPromptTemplateFile:
              normalizedSystemPromptTemplate.templateFile,
          }),
      ...(normalizedPromptTemplate.template === undefined
        ? {}
        : { promptTemplate: normalizedPromptTemplate.template }),
      ...(normalizedPromptTemplate.templateFile === undefined
        ? {}
        : { promptTemplateFile: normalizedPromptTemplate.templateFile }),
      ...(normalizedSessionStartPromptTemplate.template === undefined
        ? {}
        : {
            sessionStartPromptTemplate:
              normalizedSessionStartPromptTemplate.template,
          }),
      ...(normalizedSessionStartPromptTemplate.templateFile === undefined
        ? {}
        : {
            sessionStartPromptTemplateFile:
              normalizedSessionStartPromptTemplate.templateFile,
          }),
    };
  }

  return variants;
}
