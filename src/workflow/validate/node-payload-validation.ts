import {
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "../backend";
import type {
  ArgumentBinding,
  NodeExecutionBackend,
  NodePayload,
  NodePromptVariant,
  NodeRole,
  NodeSessionPolicy,
  NodeType,
  UserActionNodeConfig,
  ValidationIssue,
  WorkflowJson,
  WorkflowStepRef,
} from "../types";
import type {
  NodeStepRoleUsage,
  UnknownRecord,
} from "./validation-types-and-runtime-options";
import {
  isLegacyCliModelIdentifier,
  isNodeSessionMode,
  isNodeType,
  isRecord,
  makeIssue,
  normalizeCommandExecution,
  normalizePositiveIntegerValue,
  normalizePositiveNumberField,
  normalizeWorkingDirectoryField,
  readStringField,
  requiresSeparatedModel,
} from "./validation-types-and-runtime-options";
import {
  normalizeContainerExecution,
  normalizeNodeDurability,
} from "./node-container-and-addon-validation";
import {
  normalizeNodePromptVariants,
  normalizeNodeTemplateFields,
} from "./workflow-normalization";
import {
  normalizeNodeInputContract,
  normalizeNodeOutputContract,
  normalizeOptionalBooleanField,
} from "./output-contracts-and-callees";

export function normalizeNodePayload(input: {
  readonly nodeId: string;
  readonly nodeFile: string;
  readonly payload: unknown;
  readonly issues: ValidationIssue[];
  readonly path?: string;
  readonly allowManagerCodePathDefaults?: boolean;
}): NodePayload | null {
  const path = input.path ?? `nodePayloads.${input.nodeFile}`;
  const payload = input.payload;
  const issues = input.issues;
  if (!isRecord(payload)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(payload, "id", path, issues);
  if (id !== null && id !== input.nodeId) {
    issues.push(makeIssue("error", `${path}.id`, `must equal ${input.nodeId}`));
  }

  let nodeType: NodeType = "agent";
  const nodeTypeRaw = payload["nodeType"];
  if (nodeTypeRaw !== undefined) {
    if (nodeTypeRaw === "addon") {
      nodeType = "addon";
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeType`,
          "nodeType 'addon' is runtime-owned; author add-ons with workflow.nodes[].addon",
        ),
      );
    } else if (isNodeType(nodeTypeRaw)) {
      nodeType = nodeTypeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeType`,
          "must be 'agent', 'command', 'container', or 'user-action'",
        ),
      );
    }
  }

  const command = normalizeCommandExecution(
    payload["command"],
    `${path}.command`,
    issues,
  );
  const container = normalizeContainerExecution(
    payload["container"],
    `${path}.container`,
    issues,
  );
  if (payload["runtimeIsolation"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.runtimeIsolation`,
        "legacy field 'runtimeIsolation' is not supported; use 'container'",
      ),
    );
  }
  if (container !== undefined && nodeTypeRaw === undefined) {
    nodeType = "container";
  }

  const managerTypeRaw = payload["managerType"];
  let managerType: NodePayload["managerType"];
  if (managerTypeRaw !== undefined) {
    if (managerTypeRaw === "code" || managerTypeRaw === "llm") {
      managerType = managerTypeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.managerType`,
          "must be 'code' or 'llm' when provided",
        ),
      );
    }
  }
  const allowsManagerCodePathDefaults =
    input.allowManagerCodePathDefaults === true &&
    (managerType === undefined || managerType === "code");

  const modelRaw = payload["model"];
  let model: string | undefined;
  if (typeof modelRaw === "string" && modelRaw.length > 0) {
    model = modelRaw;
  } else if (
    modelRaw !== undefined &&
    nodeType === "agent" &&
    !allowsManagerCodePathDefaults
  ) {
    issues.push(
      makeIssue("error", `${path}.model`, "must be a non-empty string"),
    );
  } else if (modelRaw !== undefined && typeof modelRaw !== "string") {
    issues.push(
      makeIssue("error", `${path}.model`, "must be a non-empty string"),
    );
  }

  const executionBackendRaw = payload["executionBackend"];
  let executionBackend: NodeExecutionBackend | undefined;
  if (executionBackendRaw !== undefined) {
    const normalizedExecutionBackend =
      normalizeNodeExecutionBackend(executionBackendRaw);
    if (normalizedExecutionBackend !== null) {
      executionBackend = normalizedExecutionBackend;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.executionBackend`,
          "must be codex-agent, claude-code-agent, cursor-cli-agent, official/openai-sdk, or official/anthropic-sdk",
        ),
      );
    }
  } else if (nodeType === "agent" && !allowsManagerCodePathDefaults) {
    issues.push(
      makeIssue(
        "error",
        `${path}.executionBackend`,
        "is required for agent nodes",
      ),
    );
  }
  if (
    nodeType === "agent" &&
    model !== undefined &&
    requiresSeparatedModel(executionBackend) &&
    (normalizeCliAgentBackend(model) !== null ||
      isLegacyCliModelIdentifier(model))
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.model`,
        `must be a provider or backend-specific model name when executionBackend is '${executionBackend}', not a tacogips CLI-wrapper identifier`,
      ),
    );
  }

  const normalizedSystemPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "systemPromptTemplate",
    templateFileField: "systemPromptTemplateFile",
  });
  const normalizedPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "promptTemplate",
    templateFileField: "promptTemplateFile",
  });
  const normalizedSessionStartPromptTemplate = normalizeNodeTemplateFields({
    path,
    payload,
    issues,
    templateField: "sessionStartPromptTemplate",
    templateFileField: "sessionStartPromptTemplateFile",
  });

  const promptTemplate = normalizedPromptTemplate.template;
  const promptTemplateFile = normalizedPromptTemplate.templateFile;
  const systemPromptTemplate = normalizedSystemPromptTemplate.template;
  const systemPromptTemplateFile = normalizedSystemPromptTemplate.templateFile;
  const sessionStartPromptTemplate =
    normalizedSessionStartPromptTemplate.template;
  const sessionStartPromptTemplateFile =
    normalizedSessionStartPromptTemplate.templateFile;
  const promptVariants = normalizeNodePromptVariants(
    payload["promptVariants"],
    `${path}.promptVariants`,
    issues,
  );
  if (
    promptTemplate === undefined &&
    nodeType === "agent" &&
    !allowsManagerCodePathDefaults
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.promptTemplate`,
        "must be a non-empty string",
      ),
    );
  }

  const variablesRaw = payload["variables"];
  let variables: UnknownRecord | null = null;
  if (isRecord(variablesRaw)) {
    variables = variablesRaw;
  } else {
    issues.push(makeIssue("error", `${path}.variables`, "must be an object"));
  }
  if (payload["prompt"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.prompt`,
        "legacy field 'prompt' is not supported; use 'promptTemplate'",
      ),
    );
  }
  if (payload["variable"] !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.variable`,
        "legacy field 'variable' is not supported; use 'variables'",
      ),
    );
  }

  const descriptionRaw = payload["description"];
  const description =
    typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
      ? descriptionRaw
      : undefined;
  if (descriptionRaw !== undefined && typeof descriptionRaw !== "string") {
    issues.push(
      makeIssue(
        "error",
        `${path}.description`,
        "must be a non-empty string when provided",
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

  const timeoutRaw = payload["timeoutMs"];
  const timeoutMs = normalizePositiveNumberField(
    timeoutRaw,
    `${path}.timeoutMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveIntegerValue(
    payload["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );

  const durability = normalizeNodeDurability(
    payload["durability"],
    `${path}.durability`,
    issues,
  );
  const userAction = normalizeUserActionNodeConfig(
    payload["userAction"],
    `${path}.userAction`,
    issues,
  );

  const sessionPolicyRaw = payload["sessionPolicy"];
  let sessionPolicy: NodeSessionPolicy | undefined;
  if (sessionPolicyRaw !== undefined) {
    if (!isRecord(sessionPolicyRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.sessionPolicy`,
          "must be an object when provided",
        ),
      );
    } else if (!isNodeSessionMode(sessionPolicyRaw["mode"])) {
      issues.push(
        makeIssue(
          "error",
          `${path}.sessionPolicy.mode`,
          "must be 'new' or 'reuse'",
        ),
      );
    } else {
      sessionPolicy = { mode: sessionPolicyRaw["mode"] };
    }
  }

  const argumentsTemplateRaw = payload["argumentsTemplate"];
  let argumentsTemplate: UnknownRecord | undefined;
  if (argumentsTemplateRaw !== undefined) {
    if (isRecord(argumentsTemplateRaw)) {
      argumentsTemplate = argumentsTemplateRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.argumentsTemplate`,
          "must be an object when provided",
        ),
      );
    }
  }

  const argumentBindingsRaw = payload["argumentBindings"];
  let argumentBindings: readonly ArgumentBinding[] | undefined;
  if (argumentBindingsRaw !== undefined) {
    if (!Array.isArray(argumentBindingsRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.argumentBindings`,
          "must be an array when provided",
        ),
      );
    } else {
      const parsed: ArgumentBinding[] = [];
      argumentBindingsRaw.forEach((entry, index) => {
        const entryPath = `${path}.argumentBindings[${index}]`;
        if (!isRecord(entry)) {
          issues.push(makeIssue("error", entryPath, "must be an object"));
          return;
        }

        const targetPath = readStringField(
          entry,
          "targetPath",
          entryPath,
          issues,
        );
        const sourceRaw = entry["source"];
        if (
          sourceRaw !== "variables" &&
          sourceRaw !== "node-output" &&
          sourceRaw !== "workflow-output" &&
          sourceRaw !== "human-input" &&
          sourceRaw !== "conversation-transcript"
        ) {
          issues.push(
            makeIssue(
              "error",
              `${entryPath}.source`,
              "must be a valid binding source",
            ),
          );
          return;
        }

        if (targetPath === null) {
          return;
        }

        const sourceRef = entry["sourceRef"];
        const sourcePath = entry["sourcePath"];
        const required = entry["required"];

        parsed.push({
          targetPath,
          source: sourceRaw,
          ...(typeof sourceRef === "string" || isRecord(sourceRef)
            ? { sourceRef }
            : {}),
          ...(typeof sourcePath === "string" ? { sourcePath } : {}),
          ...(typeof required === "boolean" ? { required } : {}),
        });
      });
      argumentBindings = parsed;
    }
  }

  const templateEngineRaw = payload["templateEngine"];
  const templateEngine =
    typeof templateEngineRaw === "string" ? templateEngineRaw : undefined;
  const workingDirectory = normalizeWorkingDirectoryField(
    payload["workingDirectory"],
    `${path}.workingDirectory`,
    issues,
  );

  const outputContract = normalizeNodeOutputContract(
    payload["output"],
    `${path}.output`,
    issues,
  );
  const inputContract = normalizeNodeInputContract(
    payload["input"],
    `${path}.input`,
    issues,
  );

  if (nodeType === "command" && command === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.command`,
        "is required when nodeType is 'command'",
      ),
    );
  }
  if (nodeType === "container" && container === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.container`,
        "is required when nodeType is 'container'",
      ),
    );
  }
  if (durability !== undefined && nodeType !== "container") {
    issues.push(
      makeIssue(
        "error",
        `${path}.durability`,
        "is currently valid only for container nodes",
      ),
    );
  }
  if (userAction !== undefined && nodeType !== "user-action") {
    issues.push(
      makeIssue(
        "error",
        `${path}.userAction`,
        "is valid only when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && userAction === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.userAction`,
        "is required when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && model !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.model`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && executionBackend !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.executionBackend`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && sessionPolicy !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.sessionPolicy`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && command !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.command`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && container !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.container`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (nodeType === "user-action" && durability !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.durability`,
        "must be omitted when nodeType is 'user-action'",
      ),
    );
  }
  if (
    nodeType === "user-action" &&
    promptTemplate === undefined &&
    promptTemplateFile === undefined
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.promptTemplate`,
        "must be provided inline or by promptTemplateFile when nodeType is 'user-action'",
      ),
    );
  }

  if (
    id === null ||
    variables === null ||
    nodeType === "addon" ||
    (nodeType === "agent" &&
      (model === undefined || promptTemplate === undefined) &&
      !allowsManagerCodePathDefaults)
  ) {
    return null;
  }

  return {
    id,
    ...(description === undefined ? {} : { description }),
    ...(nodeType === "agent" ? {} : { nodeType }),
    ...(managerType === undefined ? {} : { managerType }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(model === undefined ? {} : { model }),
    ...(executionBackend === undefined ? {} : { executionBackend }),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(systemPromptTemplate === undefined ? {} : { systemPromptTemplate }),
    ...(systemPromptTemplateFile === undefined
      ? {}
      : { systemPromptTemplateFile }),
    ...(promptTemplate === undefined ? {} : { promptTemplate }),
    ...(promptTemplateFile === undefined ? {} : { promptTemplateFile }),
    ...(sessionStartPromptTemplate === undefined
      ? {}
      : { sessionStartPromptTemplate }),
    ...(sessionStartPromptTemplateFile === undefined
      ? {}
      : { sessionStartPromptTemplateFile }),
    ...(promptVariants === undefined ? {} : { promptVariants }),
    variables,
    ...(command === undefined ? {} : { command }),
    ...(container === undefined ? {} : { container }),
    ...(durability === undefined ? {} : { durability }),
    ...(userAction === undefined ? {} : { userAction }),
    ...(argumentsTemplate === undefined ? {} : { argumentsTemplate }),
    ...(argumentBindings === undefined ? {} : { argumentBindings }),
    ...(templateEngine === undefined ? {} : { templateEngine }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
    ...(inputContract === undefined ? {} : { input: inputContract }),
    ...(outputContract === undefined ? {} : { output: outputContract }),
  };
}
export function resolveWorkflowStepExecutionRole(
  workflow: Pick<WorkflowJson, "managerStepId">,
  step: Pick<WorkflowStepRef, "id" | "role">,
): NodeRole {
  return (
    step.role ?? (workflow.managerStepId === step.id ? "manager" : "worker")
  );
}
export function applyPromptVariantTemplateOverride(input: {
  readonly payload: NodePayload;
  readonly variant: NodePromptVariant;
  readonly templateField:
    | "systemPromptTemplate"
    | "promptTemplate"
    | "sessionStartPromptTemplate";
  readonly templateFileField:
    | "systemPromptTemplateFile"
    | "promptTemplateFile"
    | "sessionStartPromptTemplateFile";
}): NodePayload {
  const variantTemplate = input.variant[input.templateField];
  const variantTemplateFile = input.variant[input.templateFileField];
  if (variantTemplate === undefined && variantTemplateFile === undefined) {
    return input.payload;
  }

  const {
    [input.templateField]: _removedTemplate,
    [input.templateFileField]: _removedTemplateFile,
    ...payloadWithoutTemplatePair
  } = input.payload;

  return {
    ...payloadWithoutTemplatePair,
    ...(variantTemplate === undefined
      ? {}
      : { [input.templateField]: variantTemplate }),
    ...(variantTemplateFile === undefined
      ? {}
      : { [input.templateFileField]: variantTemplateFile }),
  };
}
export function collectStepNodeRoleUsage(
  workflow: Pick<WorkflowJson, "managerStepId" | "steps">,
): ReadonlyMap<string, NodeStepRoleUsage> {
  const usage = new Map<string, NodeStepRoleUsage>();

  for (const step of workflow.steps ?? []) {
    const role = resolveWorkflowStepExecutionRole(workflow, step);
    const current = usage.get(step.nodeId) ?? {
      manager: false,
      worker: false,
    };
    usage.set(step.nodeId, {
      manager: current.manager || role === "manager",
      worker: current.worker || role === "worker",
    });
  }

  return usage;
}
export function normalizeUserActionNodeConfig(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): UserActionNodeConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set([
    "messageToolIds",
    "notificationToolIds",
    "replyPolicy",
    "allowStructuredReply",
    "allowFreeTextReply",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported userAction field",
        ),
      );
    }
  }

  const messageToolIds = normalizeNamedStringArrayField(
    value,
    "messageToolIds",
    path,
    issues,
  );
  const notificationToolIds = normalizeOptionalNamedStringArrayField(
    value,
    "notificationToolIds",
    path,
    issues,
  );

  if (messageToolIds !== null && messageToolIds.length === 0) {
    issues.push(
      makeIssue(
        "error",
        `${path}.messageToolIds`,
        "must contain at least one tool id",
      ),
    );
  }

  const replyPolicyRaw = value["replyPolicy"];
  let replyPolicy: UserActionNodeConfig["replyPolicy"];
  if (replyPolicyRaw !== undefined) {
    if (replyPolicyRaw === "first-valid-reply-wins") {
      replyPolicy = replyPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.replyPolicy`,
          "must be 'first-valid-reply-wins' when provided",
        ),
      );
    }
  }

  const allowStructuredReply = normalizeOptionalBooleanField(
    value,
    "allowStructuredReply",
    path,
    issues,
  );
  const allowFreeTextReply = normalizeOptionalBooleanField(
    value,
    "allowFreeTextReply",
    path,
    issues,
  );

  if (messageToolIds === null) {
    return undefined;
  }

  return {
    messageToolIds,
    ...(notificationToolIds === undefined ? {} : { notificationToolIds }),
    ...(replyPolicy === undefined ? {} : { replyPolicy }),
    ...(allowStructuredReply === undefined ? {} : { allowStructuredReply }),
    ...(allowFreeTextReply === undefined ? {} : { allowFreeTextReply }),
  };
}
export function normalizeNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push(makeIssue("error", `${path}.${key}`, "must be an array"));
    return null;
  }
  const normalized = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (normalized.length !== value.length) {
    issues.push(
      makeIssue(
        "error",
        `${path}.${key}`,
        "must contain only non-empty strings",
      ),
    );
  }
  return normalized;
}
export function normalizeOptionalNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizeNamedStringArrayField(record, key, path, issues);
  return normalized === null ? undefined : normalized;
}
