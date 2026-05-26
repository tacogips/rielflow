import { normalizeWorkflowRelativeJsonPath } from "../authored-node";
import {
  NODE_ID_PATTERN,
  type ValidationIssue,
  type WorkflowNodeExecutionPolicy,
  type WorkflowNodeRegistryRef,
  type WorkflowStepFanout,
  type WorkflowStepRef,
  type WorkflowStepSessionPolicy,
  type WorkflowStepTransition,
} from "../types";
import type { WorkflowValidationOptions } from "./validation-types-and-runtime-options";
import {
  isNodeSessionMode,
  isRecord,
  makeIssue,
  normalizeNodeRole,
  normalizePositiveIntegerValue,
  normalizePositiveNumberField,
  normalizeStringArrayField,
  readPositiveIntegerField,
  readStringField,
} from "./validation-types-and-runtime-options";
import {
  normalizeRegistryNodeKind,
  normalizeWorkflowNodeAddonRef,
  normalizeWorkflowNodeRepeatPolicy,
} from "./node-container-and-addon-validation";

export function normalizeWorkflowNodeRegistryRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowNodeRegistryRef | null {
  const path = `workflow.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "id",
    "nodeFile",
    "addon",
    "execution",
    "kind",
    "repeat",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step-addressed node registry field",
        ),
      );
    }
  }

  const id = readStringField(value, "id", path, issues);
  if (id !== null && !NODE_ID_PATTERN.test(id)) {
    issues.push(
      makeIssue("error", `${path}.id`, "must match ^[a-z0-9][a-z0-9-]{1,63}$"),
    );
  }

  const nodeFileRaw = value["nodeFile"];
  let nodeFile: string | undefined;
  if (nodeFileRaw !== undefined) {
    if (typeof nodeFileRaw !== "string" || nodeFileRaw.length === 0) {
      issues.push(
        makeIssue("error", `${path}.nodeFile`, "must be a non-empty string"),
      );
    } else {
      nodeFile = normalizeWorkflowRelativeJsonPath(nodeFileRaw);
    }
  }

  const addon = normalizeWorkflowNodeAddonRef(
    value["addon"],
    `${path}.addon`,
    issues,
  );
  const execution = normalizeWorkflowNodeExecutionPolicy(
    value["execution"],
    `${path}.execution`,
    issues,
  );
  const kind = normalizeRegistryNodeKind(value["kind"], `${path}.kind`, issues);
  const repeat = normalizeWorkflowNodeRepeatPolicy(
    value["repeat"],
    `${path}.repeat`,
    issues,
  );

  if ((nodeFile === undefined) === (addon === undefined)) {
    issues.push(
      makeIssue("error", path, "must declare exactly one of nodeFile or addon"),
    );
  }

  if (id === null) {
    return null;
  }

  return {
    id,
    ...(nodeFile === undefined ? {} : { nodeFile }),
    ...(addon === undefined ? {} : { addon }),
    ...(execution === undefined ? {} : { execution }),
    ...(kind === undefined ? {} : { kind }),
    ...(repeat === undefined ? {} : { repeat }),
  };
}
export function normalizeWorkflowStepTransition(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepTransition | null {
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "toStepId",
    "toWorkflowId",
    "resumeStepId",
    "label",
    "fanout",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step transition field",
        ),
      );
    }
  }

  const toStepId = readStringField(value, "toStepId", path, issues);
  const toWorkflowIdRaw = value["toWorkflowId"];
  let toWorkflowId: string | undefined;
  if (toWorkflowIdRaw !== undefined) {
    if (typeof toWorkflowIdRaw === "string" && toWorkflowIdRaw.length > 0) {
      toWorkflowId = toWorkflowIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.toWorkflowId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const resumeStepIdRaw = value["resumeStepId"];
  let resumeStepId: string | undefined;
  if (resumeStepIdRaw !== undefined) {
    if (typeof resumeStepIdRaw === "string" && resumeStepIdRaw.length > 0) {
      resumeStepId = resumeStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.resumeStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const labelRaw = value["label"];
  let label: string | undefined;
  if (labelRaw !== undefined) {
    if (typeof labelRaw === "string" && labelRaw.length > 0) {
      label = labelRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.label`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (toWorkflowId === undefined && resumeStepId !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.resumeStepId`,
        "is supported only when toWorkflowId is set",
      ),
    );
  }

  const fanout = normalizeWorkflowStepFanout(
    value["fanout"],
    `${path}.fanout`,
    issues,
  );

  if (toStepId === null) {
    return null;
  }

  return {
    toStepId,
    ...(toWorkflowId === undefined ? {} : { toWorkflowId }),
    ...(resumeStepId === undefined ? {} : { resumeStepId }),
    ...(label === undefined ? {} : { label }),
    ...(fanout === undefined ? {} : { fanout }),
  };
}
export function normalizeWorkflowStepFanout(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "groupId",
    "itemsFrom",
    "itemVariable",
    "concurrency",
    "joinStepId",
    "failurePolicy",
    "resultOrder",
    "writeOwnership",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported fanout field",
        ),
      );
    }
  }

  const groupId = readStringField(value, "groupId", path, issues);
  const itemsFrom = readStringField(value, "itemsFrom", path, issues);
  if (
    typeof itemsFrom === "string" &&
    !(itemsFrom === "" || itemsFrom.startsWith("/"))
  ) {
    issues.push(
      makeIssue("error", `${path}.itemsFrom`, "must be a JSON Pointer"),
    );
  }
  const joinStepId = readStringField(value, "joinStepId", path, issues);
  const itemVariableRaw = value["itemVariable"];
  let itemVariable: string | undefined;
  if (itemVariableRaw !== undefined) {
    if (
      typeof itemVariableRaw === "string" &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(itemVariableRaw)
    ) {
      itemVariable = itemVariableRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.itemVariable`,
          "must be an identifier-like non-empty string when provided",
        ),
      );
    }
  }

  const concurrency =
    value["concurrency"] === undefined
      ? undefined
      : readPositiveIntegerField(value, "concurrency", path, issues);
  const failurePolicyRaw = value["failurePolicy"];
  let failurePolicy: WorkflowStepFanout["failurePolicy"] | undefined;
  if (failurePolicyRaw !== undefined) {
    if (
      failurePolicyRaw === "fail-fast" ||
      failurePolicyRaw === "collect-all"
    ) {
      failurePolicy = failurePolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.failurePolicy`,
          "must be 'fail-fast' or 'collect-all' when provided",
        ),
      );
    }
  }
  const resultOrderRaw = value["resultOrder"];
  let resultOrder: WorkflowStepFanout["resultOrder"] | undefined;
  if (resultOrderRaw !== undefined) {
    if (resultOrderRaw === "input") {
      resultOrder = resultOrderRaw;
    } else {
      issues.push(makeIssue("error", `${path}.resultOrder`, "must be 'input'"));
    }
  }
  const writeOwnership = normalizeWorkflowFanoutWriteOwnership(
    value["writeOwnership"],
    `${path}.writeOwnership`,
    issues,
  );

  if (groupId === null || itemsFrom === null || joinStepId === null) {
    return undefined;
  }
  return {
    groupId,
    itemsFrom,
    ...(itemVariable === undefined ? {} : { itemVariable }),
    ...(concurrency === undefined || concurrency === null
      ? {}
      : { concurrency }),
    joinStepId,
    ...(failurePolicy === undefined ? {} : { failurePolicy }),
    ...(resultOrder === undefined ? {} : { resultOrder }),
    ...(writeOwnership === undefined ? {} : { writeOwnership }),
  };
}
export function normalizeWorkflowFanoutWriteOwnership(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepFanout["writeOwnership"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const allowedKeys = new Set(["mode", "paths", "directories"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported fanout writeOwnership field",
        ),
      );
    }
  }
  const modeRaw = value["mode"];
  let mode: "read-only" | "disjoint-paths" | "isolated-workspace" | undefined;
  if (
    modeRaw === "read-only" ||
    modeRaw === "disjoint-paths" ||
    modeRaw === "isolated-workspace"
  ) {
    mode = modeRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'read-only', 'disjoint-paths', or 'isolated-workspace'",
      ),
    );
  }
  const paths = normalizeStringArrayField(
    value["paths"],
    `${path}.paths`,
    issues,
  );
  const directories = normalizeStringArrayField(
    value["directories"],
    `${path}.directories`,
    issues,
  );
  if (mode === undefined) {
    return undefined;
  }
  return {
    mode,
    ...(paths === undefined ? {} : { paths }),
    ...(directories === undefined ? {} : { directories }),
  };
}
export function normalizeWorkflowStepSessionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowStepSessionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set(["mode", "inheritFromStepId"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported step session policy field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowStepSessionPolicy["mode"];
  if (modeRaw !== undefined) {
    if (isNodeSessionMode(modeRaw)) {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be 'new' or 'reuse' when provided",
        ),
      );
    }
  }

  const inheritFromStepIdRaw = value["inheritFromStepId"];
  let inheritFromStepId: string | undefined;
  if (inheritFromStepIdRaw !== undefined) {
    if (
      typeof inheritFromStepIdRaw === "string" &&
      inheritFromStepIdRaw.length > 0
    ) {
      inheritFromStepId = inheritFromStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.inheritFromStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(inheritFromStepId === undefined ? {} : { inheritFromStepId }),
  };
}
export function normalizeWorkflowNodeExecutionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeExecutionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set(["mode", "decisionBy"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported workflow node execution field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowNodeExecutionPolicy["mode"] | undefined;
  if (modeRaw !== undefined) {
    if (modeRaw === "required" || modeRaw === "optional") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mode`,
          "must be 'required' or 'optional' when provided",
        ),
      );
    }
  }

  const decisionByRaw = value["decisionBy"];
  let decisionBy: WorkflowNodeExecutionPolicy["decisionBy"] | undefined;
  if (decisionByRaw !== undefined) {
    if (decisionByRaw === "owning-manager") {
      decisionBy = decisionByRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.decisionBy`,
          "must be 'owning-manager' when provided",
        ),
      );
    }
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(decisionBy === undefined ? {} : { decisionBy }),
  };
}
export function normalizeWorkflowStepRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
  options: Pick<WorkflowValidationOptions, "allowResolvedStepFileFields">,
): WorkflowStepRef | null {
  const path = `workflow.steps[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const allowedKeys = new Set([
    "id",
    "stepFile",
    "nodeId",
    "description",
    "role",
    "promptVariant",
    "timeoutMs",
    "stallTimeoutMs",
    "sessionPolicy",
    "transitions",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue("error", `${path}.${key}`, "uses an unsupported step field"),
      );
    }
  }

  const id = readStringField(value, "id", path, issues);
  const stepFileRaw = value["stepFile"];
  let stepFile: string | undefined;
  if (stepFileRaw !== undefined) {
    if (typeof stepFileRaw === "string" && stepFileRaw.length > 0) {
      stepFile = normalizeWorkflowRelativeJsonPath(stepFileRaw);
    } else {
      issues.push(
        makeIssue("error", `${path}.stepFile`, "must be a non-empty string"),
      );
    }
  }
  if (stepFile !== undefined && options.allowResolvedStepFileFields !== true) {
    for (const inlineField of [
      "nodeId",
      "description",
      "role",
      "promptVariant",
      "timeoutMs",
      "sessionPolicy",
      "transitions",
    ] as const) {
      if (value[inlineField] !== undefined) {
        issues.push(
          makeIssue(
            "error",
            `${path}.${inlineField}`,
            "must not be authored inline when workflow.steps[].stepFile is used",
          ),
        );
      }
    }
  }

  const nodeIdRaw = value["nodeId"];
  let nodeId: string | undefined;
  if (typeof nodeIdRaw === "string" && nodeIdRaw.length > 0) {
    nodeId = nodeIdRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeId`,
        "must be a non-empty string after step files are resolved",
      ),
    );
  }

  const descriptionRaw = value["description"];
  let description: string | undefined;
  if (descriptionRaw !== undefined) {
    if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
      description = descriptionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.description`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const role = normalizeNodeRole(value["role"]);
  if (value["role"] !== undefined && role === undefined) {
    issues.push(
      makeIssue("error", `${path}.role`, "must be 'manager' or 'worker'"),
    );
  }

  const promptVariantRaw = value["promptVariant"];
  let promptVariant: string | undefined;
  if (promptVariantRaw !== undefined) {
    if (typeof promptVariantRaw === "string" && promptVariantRaw.length > 0) {
      promptVariant = promptVariantRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.promptVariant`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const timeoutMsRaw = value["timeoutMs"];
  const timeoutMs = normalizePositiveNumberField(
    timeoutMsRaw,
    `${path}.timeoutMs`,
    issues,
  );
  const stallTimeoutMs = normalizePositiveIntegerValue(
    value["stallTimeoutMs"],
    `${path}.stallTimeoutMs`,
    issues,
  );

  const sessionPolicy = normalizeWorkflowStepSessionPolicy(
    value["sessionPolicy"],
    `${path}.sessionPolicy`,
    issues,
  );

  const transitionsRaw = value["transitions"];
  let transitions: readonly WorkflowStepTransition[] | undefined;
  if (transitionsRaw !== undefined) {
    if (!Array.isArray(transitionsRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.transitions`,
          "must be an array when provided",
        ),
      );
    } else {
      transitions = transitionsRaw
        .map((transition, transitionIndex) =>
          normalizeWorkflowStepTransition(
            transition,
            `${path}.transitions[${transitionIndex}]`,
            issues,
          ),
        )
        .filter(
          (transition): transition is WorkflowStepTransition =>
            transition !== null,
        );
    }
  }

  if (id === null || nodeId === undefined) {
    return null;
  }

  return {
    id,
    ...(stepFile === undefined ? {} : { stepFile }),
    nodeId,
    ...(description === undefined ? {} : { description }),
    ...(role === undefined ? {} : { role }),
    ...(promptVariant === undefined ? {} : { promptVariant }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(stallTimeoutMs === undefined ? {} : { stallTimeoutMs }),
    ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
    ...(transitions === undefined ? {} : { transitions }),
  };
}
