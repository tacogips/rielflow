import { err, ok, type Result } from "./result";
import { validateJsonSchemaDefinition } from "./json-schema";
import {
  isReservedWorkflowDefinitionPath,
  isSafeWorkflowRelativePath,
} from "./prompt-template-file";
import {
  INLINE_NODE_FIELD,
  isSupportedNodeFilePath,
  normalizeWorkflowRelativeJsonPath,
  remapAuthoredNodePayloadsByNodeFile,
  synthesizeInlineNodeFile,
} from "./authored-node";
import { isSafeWorkflowId } from "./paths";
import {
  isCliAgentBackend,
  normalizeCliAgentBackend,
  normalizeNodeExecutionBackend,
} from "./backend";
import {
  DEFAULT_CONTAINER_RUNNER_KIND,
  DEFAULT_MAX_LOOP_ITERATIONS,
  DEFAULT_NODE_TIMEOUT_MS,
  NODE_ID_PATTERN,
  type ArgumentBinding,
  type CommandExecution,
  type ContainerBuild,
  type ContainerExecution,
  type ContainerRuntimeDefaults,
  type ContainerRunnerKind,
  type JsonObject,
  type CompletionRule,
  type NodeControlKind,
  type NodeOutputContract,
  type NodeDurability,
  type LoopRule,
  type NodeExecutionBackend,
  type NodeKind,
  type NodePayload,
  type NodeRole,
  type NodeType,
  type NodeSessionPolicy,
  type NormalizedWorkflowBundle,
  type SubWorkflowBlock,
  type SubWorkflowConversation,
  type SubWorkflowInputSource,
  type SubWorkflowRef,
  type ValidationIssue,
  type VisNode,
  type WorkflowCallRef,
  type WorkflowEdge,
  type WorkflowJson,
  type WorkflowNodeExecutionPolicy,
  type WorkflowNodeRepeatPolicy,
  type WorkflowNodeRef,
  type WorkflowPrompts,
  type WorkflowVisJson,
  type UserActionNodeConfig,
} from "./types";

interface RawBundle {
  readonly workflow: unknown;
  readonly workflowVis: unknown;
  readonly nodePayloads: Readonly<Record<string, unknown>>;
}

interface LegacyLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface NormalizedVisNodeCandidate {
  readonly id: string;
  readonly order?: number;
  readonly legacyLayout?: LegacyLayout;
}

type UnknownRecord = Record<string, unknown>;
type ValidationResult = Result<
  NormalizedWorkflowBundle,
  readonly ValidationIssue[]
>;

interface ValidationSuccessDetails {
  readonly bundle: NormalizedWorkflowBundle;
  readonly issues: readonly ValidationIssue[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiresSeparatedModel(
  executionBackend: NodeExecutionBackend | undefined,
): executionBackend is NodeExecutionBackend {
  return executionBackend !== undefined;
}

function isNodeSessionMode(value: unknown): value is NodeSessionPolicy["mode"] {
  return value === "new" || value === "reuse";
}

function isNodeType(value: unknown): value is NodeType {
  return (
    value === "agent" ||
    value === "command" ||
    value === "container" ||
    value === "user-action"
  );
}

function isContainerRunnerKind(value: unknown): value is ContainerRunnerKind {
  return (
    value === "podman" ||
    value === "docker" ||
    value === "nerdctl" ||
    value === "apple-container"
  );
}

function makeIssue(
  severity: "error" | "warning",
  path: string,
  message: string,
): ValidationIssue {
  return { severity, path, message };
}

function normalizeNodeKind(value: unknown): NodeKind | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value) {
    case "task":
    case "branch-judge":
    case "loop-judge":
    case "root-manager":
    case "subworkflow-manager":
    case "input":
    case "output":
      return value;
    default:
      return undefined;
  }
}

function normalizeNodeRole(value: unknown): NodeRole | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "manager" || value === "worker") {
    return value;
  }
  return undefined;
}

function normalizeNodeControlKind(value: unknown): NodeControlKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "none" || value === "branch-judge" || value === "loop-judge") {
    return value;
  }
  return undefined;
}

function deriveRoleAndControlFromKind(kind: NodeKind): {
  readonly role: NodeRole;
  readonly control?: NodeControlKind;
} {
  switch (kind) {
    case "root-manager":
      return { role: "manager" };
    case "subworkflow-manager":
    case "branch-judge":
      return kind === "subworkflow-manager"
        ? { role: "worker" }
        : { role: "worker", control: "branch-judge" };
    case "loop-judge":
      return { role: "worker", control: "loop-judge" };
    case "task":
    case "input":
    case "output":
      return { role: "worker" };
  }
}

function deriveLegacyKindFromRoleAndControl(
  role: NodeRole | undefined,
  control: NodeControlKind | undefined,
): NodeKind | undefined {
  if (role === undefined) {
    return undefined;
  }
  if (role === "manager") {
    return "root-manager";
  }
  switch (control) {
    case "branch-judge":
      return "branch-judge";
    case "loop-judge":
      return "loop-judge";
    case "none":
    case undefined:
      return "task";
  }
}

function readStringField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a non-empty string"),
    );
    return null;
  }
  return value;
}

function readNumberField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(
      makeIssue("error", `${path}.${key}`, "must be a finite number"),
    );
    return null;
  }
  return value;
}

function isAbsoluteContainerPath(value: string): boolean {
  return value.startsWith("/");
}

function normalizeStringArrayField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    issues.push(makeIssue("error", path, "must be an array when provided"));
    return undefined;
  }
  const entries: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      issues.push(
        makeIssue("error", `${path}[${index}]`, "must be a non-empty string"),
      );
      return;
    }
    entries.push(entry);
  });
  return entries;
}

function normalizeStringMapField(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== "string") {
      issues.push(
        makeIssue("error", `${path}.${key}`, "must be a string when provided"),
      );
      continue;
    }
    entries[key] = entryValue;
  }
  return entries;
}

function normalizeContainerBuild(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerBuild | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "contextPath",
    "containerfilePath",
    "dockerfilePath",
    "target",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container build field",
        ),
      );
    }
  }

  const contextPath = readStringField(value, "contextPath", path, issues);
  if (contextPath !== null && !isSafeWorkflowRelativePath(contextPath)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.contextPath`,
        "must be a workflow-relative path without '.' or '..' segments",
      ),
    );
  }

  const normalizeBuildPath = (
    key: "containerfilePath" | "dockerfilePath",
  ): string | undefined => {
    const rawValue = value[key];
    if (rawValue === undefined) {
      return undefined;
    }
    if (typeof rawValue !== "string" || rawValue.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "must be a non-empty string when provided",
        ),
      );
      return undefined;
    }
    if (!isSafeWorkflowRelativePath(rawValue)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "must be a workflow-relative path without '.' or '..' segments",
        ),
      );
      return undefined;
    }
    if (isReservedWorkflowDefinitionPath(rawValue)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "must not target canonical workflow definition files such as workflow.json, workflow-vis.json, or node-*.json",
        ),
      );
      return undefined;
    }
    return rawValue;
  };

  const containerfilePath = normalizeBuildPath("containerfilePath");
  const dockerfilePath = normalizeBuildPath("dockerfilePath");
  const targetRaw = value["target"];
  let target: string | undefined;
  if (targetRaw !== undefined) {
    if (typeof targetRaw === "string" && targetRaw.length > 0) {
      target = targetRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.target`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (contextPath === null || !isSafeWorkflowRelativePath(contextPath)) {
    return undefined;
  }

  return {
    contextPath,
    ...(containerfilePath === undefined ? {} : { containerfilePath }),
    ...(dockerfilePath === undefined ? {} : { dockerfilePath }),
    ...(target === undefined ? {} : { target }),
  };
}

function normalizeContainerRuntimeDefaults(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerRuntimeDefaults {
  if (value === undefined) {
    return { runnerKind: DEFAULT_CONTAINER_RUNNER_KIND };
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return { runnerKind: DEFAULT_CONTAINER_RUNNER_KIND };
  }

  const allowedKeys = new Set(["runnerKind", "runnerPath"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container runtime defaults field",
        ),
      );
    }
  }

  const runnerKindRaw = value["runnerKind"];
  let runnerKind = DEFAULT_CONTAINER_RUNNER_KIND;
  if (runnerKindRaw !== undefined) {
    if (isContainerRunnerKind(runnerKindRaw)) {
      runnerKind = runnerKindRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerKind`,
          "must be podman, docker, nerdctl, or apple-container",
        ),
      );
    }
  }

  const runnerPathRaw = value["runnerPath"];
  let runnerPath: string | undefined;
  if (runnerPathRaw !== undefined) {
    if (typeof runnerPathRaw === "string" && runnerPathRaw.length > 0) {
      runnerPath = runnerPathRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerPath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  return {
    runnerKind,
    ...(runnerPath === undefined ? {} : { runnerPath }),
  };
}

function normalizeCommandExecution(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CommandExecution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "scriptPath",
    "argvTemplate",
    "envTemplate",
    "workingDirectory",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported command field",
        ),
      );
    }
  }

  const scriptPath = readStringField(value, "scriptPath", path, issues);
  if (scriptPath !== null && !isSafeWorkflowRelativePath(scriptPath)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.scriptPath`,
        "must be a workflow-relative path without '.' or '..' segments",
      ),
    );
  }

  const argvTemplate = normalizeStringArrayField(
    value["argvTemplate"],
    `${path}.argvTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMapField(
    value["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );

  const workingDirectoryRaw = value["workingDirectory"];
  let workingDirectory: string | undefined;
  if (workingDirectoryRaw !== undefined) {
    if (
      typeof workingDirectoryRaw === "string" &&
      workingDirectoryRaw.length > 0 &&
      isSafeWorkflowRelativePath(workingDirectoryRaw)
    ) {
      workingDirectory = workingDirectoryRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.workingDirectory`,
          "must be a workflow-relative path without '.' or '..' segments when provided",
        ),
      );
    }
  }

  if (scriptPath === null || !isSafeWorkflowRelativePath(scriptPath)) {
    return undefined;
  }

  return {
    scriptPath,
    ...(argvTemplate === undefined ? {} : { argvTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}

function normalizeContainerExecution(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerExecution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const allowedKeys = new Set([
    "runnerKind",
    "runnerPath",
    "image",
    "build",
    "entrypoint",
    "argsTemplate",
    "envTemplate",
    "workingDirectory",
    "workspace",
    "resources",
    "networkPolicy",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported container field",
        ),
      );
    }
  }

  const runnerKindRaw = value["runnerKind"];
  let runnerKind: ContainerRunnerKind | undefined;
  if (runnerKindRaw !== undefined) {
    if (isContainerRunnerKind(runnerKindRaw)) {
      runnerKind = runnerKindRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerKind`,
          "must be podman, docker, nerdctl, or apple-container",
        ),
      );
    }
  }

  const runnerPathRaw = value["runnerPath"];
  let runnerPath: string | undefined;
  if (runnerPathRaw !== undefined) {
    if (typeof runnerPathRaw === "string" && runnerPathRaw.length > 0) {
      runnerPath = runnerPathRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.runnerPath`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const imageRaw = value["image"];
  let image: string | undefined;
  if (imageRaw !== undefined) {
    if (typeof imageRaw === "string" && imageRaw.length > 0) {
      image = imageRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.image`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const build = normalizeContainerBuild(
    value["build"],
    `${path}.build`,
    issues,
  );
  if ((image === undefined) === (build === undefined)) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must declare exactly one of container.image or container.build",
      ),
    );
  }

  const entrypoint = normalizeStringArrayField(
    value["entrypoint"],
    `${path}.entrypoint`,
    issues,
  );
  const argsTemplate = normalizeStringArrayField(
    value["argsTemplate"],
    `${path}.argsTemplate`,
    issues,
  );
  const envTemplate = normalizeStringMapField(
    value["envTemplate"],
    `${path}.envTemplate`,
    issues,
  );

  const workingDirectoryRaw = value["workingDirectory"];
  let workingDirectory: string | undefined;
  if (workingDirectoryRaw !== undefined) {
    if (
      typeof workingDirectoryRaw === "string" &&
      workingDirectoryRaw.length > 0 &&
      isAbsoluteContainerPath(workingDirectoryRaw)
    ) {
      workingDirectory = workingDirectoryRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.workingDirectory`,
          "must be an absolute container path when provided",
        ),
      );
    }
  }

  const workspaceRaw = value["workspace"];
  let workspace: ContainerExecution["workspace"];
  if (workspaceRaw !== undefined) {
    if (!isRecord(workspaceRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.workspace`,
          "must be an object when provided",
        ),
      );
    } else {
      const modeRaw = workspaceRaw["mode"];
      let mode: "none" | "ephemeral" | undefined;
      if (modeRaw !== undefined) {
        if (modeRaw === "none" || modeRaw === "ephemeral") {
          mode = modeRaw;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.workspace.mode`,
              "must be 'none' or 'ephemeral'",
            ),
          );
        }
      }
      const mountPathRaw = workspaceRaw["mountPath"];
      let mountPath: string | undefined;
      if (mountPathRaw !== undefined) {
        if (
          typeof mountPathRaw === "string" &&
          mountPathRaw.length > 0 &&
          isAbsoluteContainerPath(mountPathRaw)
        ) {
          mountPath = mountPathRaw;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.workspace.mountPath`,
              "must be an absolute container path when provided",
            ),
          );
        }
      }
      workspace = {
        ...(mode === undefined ? {} : { mode }),
        ...(mountPath === undefined ? {} : { mountPath }),
      };
    }
  }

  const resourcesRaw = value["resources"];
  let resources: ContainerExecution["resources"];
  if (resourcesRaw !== undefined) {
    if (!isRecord(resourcesRaw)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.resources`,
          "must be an object when provided",
        ),
      );
    } else {
      const parsed: Record<string, number> = {};
      for (const key of ["cpuMax", "memoryMaxMb", "pidsMax"] as const) {
        const rawValue = resourcesRaw[key];
        if (rawValue === undefined) {
          continue;
        }
        if (
          typeof rawValue === "number" &&
          Number.isFinite(rawValue) &&
          rawValue > 0
        ) {
          parsed[key] = rawValue;
        } else {
          issues.push(
            makeIssue(
              "error",
              `${path}.resources.${key}`,
              "must be > 0 when provided",
            ),
          );
        }
      }
      resources = parsed;
    }
  }

  const networkPolicyRaw = value["networkPolicy"];
  let networkPolicy: "disabled" | "egress-allowed" | undefined;
  if (networkPolicyRaw !== undefined) {
    if (
      networkPolicyRaw === "disabled" ||
      networkPolicyRaw === "egress-allowed"
    ) {
      networkPolicy = networkPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.networkPolicy`,
          "must be 'disabled' or 'egress-allowed'",
        ),
      );
    }
  }

  return {
    ...(runnerKind === undefined ? {} : { runnerKind }),
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(image === undefined ? {} : { image }),
    ...(build === undefined ? {} : { build }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(argsTemplate === undefined ? {} : { argsTemplate }),
    ...(envTemplate === undefined ? {} : { envTemplate }),
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(resources === undefined ? {} : { resources }),
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
  };
}

function normalizeNodeDurability(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeDurability | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const modeRaw = value["mode"];
  if (modeRaw !== "disabled" && modeRaw !== "node-persistent") {
    issues.push(
      makeIssue(
        "error",
        `${path}.mode`,
        "must be 'disabled' or 'node-persistent'",
      ),
    );
    return undefined;
  }

  const mountPathRaw = value["mountPath"];
  let mountPath: string | undefined;
  if (mountPathRaw !== undefined) {
    if (
      typeof mountPathRaw === "string" &&
      mountPathRaw.length > 0 &&
      isAbsoluteContainerPath(mountPathRaw)
    ) {
      mountPath = mountPathRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.mountPath`,
          "must be an absolute container path when provided",
        ),
      );
    }
  }

  return {
    mode: modeRaw,
    ...(mountPath === undefined ? {} : { mountPath }),
  };
}

function normalizeLegacyRuntimeIsolationToContainer(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): ContainerExecution | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const modeRaw = value["mode"];
  if (modeRaw === "host") {
    issues.push(
      makeIssue(
        "warning",
        path,
        "legacy runtimeIsolation.mode='host' is ignored; omit runtimeIsolation in new workflows",
      ),
    );
    return undefined;
  }
  if (modeRaw !== "podman") {
    issues.push(
      makeIssue("error", `${path}.mode`, "must be 'host' or 'podman'"),
    );
    return undefined;
  }

  const normalized = normalizeContainerExecution(
    {
      runnerKind: "podman",
      ...(value["image"] === undefined ? {} : { image: value["image"] }),
      ...(value["build"] === undefined ? {} : { build: value["build"] }),
    },
    path,
    issues,
  );
  if (normalized !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        path,
        "legacy runtimeIsolation normalized to container metadata",
      ),
    );
  }
  return normalized;
}

function normalizeCompletion(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): CompletionRule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const typeValue = value["type"];
  if (
    typeValue !== "checklist" &&
    typeValue !== "score-threshold" &&
    typeValue !== "validator-result" &&
    typeValue !== "none"
  ) {
    issues.push(
      makeIssue("error", `${path}.type`, "must be a valid completion type"),
    );
    return undefined;
  }

  const configValue = value["config"];
  if (configValue !== undefined && !isRecord(configValue)) {
    issues.push(
      makeIssue("error", `${path}.config`, "must be an object when provided"),
    );
    return { type: typeValue };
  }

  if (isRecord(configValue)) {
    return { type: typeValue, config: configValue };
  }
  return { type: typeValue };
}

function normalizeNodeRef(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowNodeRef | null {
  const path = `workflow.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const nodeFileRaw = value["nodeFile"];
  const inlineNodeRaw = value[INLINE_NODE_FIELD];
  let nodeFile: string | null = null;
  if (nodeFileRaw === undefined) {
    if (inlineNodeRaw === undefined) {
      issues.push(
        makeIssue(
          "error",
          `${path}.nodeFile`,
          "is required unless node is provided inline",
        ),
      );
    } else if (id !== null) {
      nodeFile = synthesizeInlineNodeFile(id);
    }
  } else if (typeof nodeFileRaw !== "string" || nodeFileRaw.length === 0) {
    issues.push(
      makeIssue("error", `${path}.nodeFile`, "must be a non-empty string"),
    );
  } else {
    nodeFile = normalizeWorkflowRelativeJsonPath(nodeFileRaw);
  }
  if (nodeFileRaw !== undefined && inlineNodeRaw !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.${INLINE_NODE_FIELD}`,
        "must be omitted when nodeFile is provided",
      ),
    );
  }
  const completion = normalizeCompletion(
    value["completion"],
    `${path}.completion`,
    issues,
  );
  const repeat = normalizeWorkflowNodeRepeatPolicy(
    value["repeat"],
    `${path}.repeat`,
    issues,
  );
  const execution = normalizeWorkflowNodeExecutionPolicy(
    value["execution"],
    `${path}.execution`,
    issues,
  );
  const groupRaw = value["group"];
  let group: string | undefined;
  if (groupRaw !== undefined) {
    if (typeof groupRaw !== "string" || groupRaw.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.group`,
          "must be a non-empty string when provided",
        ),
      );
    } else {
      group = groupRaw;
    }
  }

  const roleRaw = value["role"];
  const normalizedRole = normalizeNodeRole(roleRaw);
  let role: WorkflowNodeRef["role"];
  if (roleRaw !== undefined) {
    if (normalizedRole === undefined) {
      issues.push(
        makeIssue("error", `${path}.role`, "must be 'manager' or 'worker'"),
      );
    } else {
      role = normalizedRole;
    }
  }

  const controlRaw = value["control"];
  const normalizedControl = normalizeNodeControlKind(controlRaw);
  let control: WorkflowNodeRef["control"];
  if (controlRaw !== undefined) {
    if (normalizedControl === undefined) {
      issues.push(
        makeIssue(
          "error",
          `${path}.control`,
          "must be 'none', 'branch-judge', or 'loop-judge'",
        ),
      );
    } else if (normalizedControl !== "none") {
      control = normalizedControl;
    }
  }

  const kindRaw = value["kind"];
  let kind: WorkflowNodeRef["kind"];
  if (kindRaw !== undefined) {
    const normalizedKind = normalizeNodeKind(kindRaw);
    if (normalizedKind === undefined) {
      issues.push(
        makeIssue("error", `${path}.kind`, "must be a valid node kind"),
      );
    } else {
      kind = normalizedKind;
      const derived = deriveRoleAndControlFromKind(normalizedKind);
      if (role !== undefined && role !== derived.role) {
        issues.push(
          makeIssue(
            "error",
            `${path}.role`,
            `must match kind '${normalizedKind}'`,
          ),
        );
      }

      const derivedControl = derived.control;
      if (
        control !== undefined &&
        control !== "none" &&
        derivedControl !== undefined &&
        control !== derivedControl
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.control`,
            `must match kind '${normalizedKind}'`,
          ),
        );
      } else if (
        control !== undefined &&
        control !== "none" &&
        derivedControl === undefined
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.control`,
            `kind '${normalizedKind}' does not support control '${control}'`,
          ),
        );
      }
    }
  }

  if (role === undefined && control !== undefined) {
    role = "worker";
  }
  if (repeat !== undefined) {
    if (role === "manager") {
      issues.push(
        makeIssue(
          "error",
          `${path}.repeat`,
          "manager-role nodes cannot declare repeat",
        ),
      );
    }
    role ??= "worker";
    if (control !== undefined && control !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `${path}.control`,
          "repeat nodes must use loop-judge control",
        ),
      );
    }
    control = "loop-judge";
    if (kind !== undefined && kind !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `${path}.kind`,
          "repeat nodes must use kind 'loop-judge'",
        ),
      );
    }
    kind = "loop-judge";
  }
  if (kind === undefined) {
    kind = deriveLegacyKindFromRoleAndControl(role, control);
  }
  if (role === "manager" && control !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.control`,
        "manager-role nodes cannot declare branch or loop control",
      ),
    );
  }

  if (id === null || nodeFile === null) {
    return null;
  }

  if (!NODE_ID_PATTERN.test(id)) {
    issues.push(
      makeIssue("error", `${path}.id`, "must match ^[a-z0-9][a-z0-9-]{1,63}$"),
    );
  }
  if (!isSupportedNodeFilePath(id, nodeFile)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeFile`,
        `must be a workflow-relative path whose basename equals node-${id}.json`,
      ),
    );
  }

  return {
    id,
    nodeFile,
    ...(kind === undefined ? {} : { kind }),
    ...(role === undefined ? {} : { role }),
    ...(control === undefined ? {} : { control }),
    ...(completion === undefined ? {} : { completion }),
    ...(execution === undefined ? {} : { execution }),
    ...(group === undefined ? {} : { group }),
    ...(repeat === undefined ? {} : { repeat }),
  };
}

function normalizeWorkflowNodeExecutionPolicy(
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
          "uses an unsupported workflow node execution policy field",
        ),
      );
    }
  }

  const modeRaw = value["mode"];
  let mode: WorkflowNodeExecutionPolicy["mode"];
  if (modeRaw !== undefined) {
    if (modeRaw === "required" || modeRaw === "optional") {
      mode = modeRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.mode`, "must be 'required' or 'optional'"),
      );
    }
  }

  const decisionByRaw = value["decisionBy"];
  let decisionBy: WorkflowNodeExecutionPolicy["decisionBy"];
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

  if (mode === undefined && decisionBy === undefined) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must define execution.mode when execution is provided",
      ),
    );
    return undefined;
  }
  if (mode === "optional" && decisionBy === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.decisionBy`,
        "is required when execution.mode is 'optional'",
      ),
    );
  }
  if (mode !== "optional" && decisionBy !== undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.decisionBy`,
        "is currently valid only when execution.mode is 'optional'",
      ),
    );
  }

  return {
    ...(mode === undefined ? {} : { mode }),
    ...(decisionBy === undefined ? {} : { decisionBy }),
  };
}

function normalizeWorkflowNodeRepeatPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeRepeatPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set(["while", "restartAt", "maxIterations"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported workflow node repeat field",
        ),
      );
    }
  }

  const whileExpression = readStringField(value, "while", path, issues);
  const restartAtRaw = value["restartAt"];
  let restartAt: string | undefined;
  if (restartAtRaw !== undefined) {
    if (typeof restartAtRaw !== "string" || restartAtRaw.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `${path}.restartAt`,
          "must be a non-empty string when provided",
        ),
      );
    } else {
      restartAt = restartAtRaw;
    }
  }

  const maxIterationsRaw = value["maxIterations"];
  let maxIterations: number | undefined;
  if (maxIterationsRaw !== undefined) {
    if (
      typeof maxIterationsRaw !== "number" ||
      !Number.isFinite(maxIterationsRaw) ||
      maxIterationsRaw <= 0
    ) {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxIterations`,
          "must be a finite number > 0 when provided",
        ),
      );
    } else {
      maxIterations = maxIterationsRaw;
    }
  }

  if (whileExpression === null) {
    return undefined;
  }

  return {
    while: whileExpression,
    ...(restartAt === undefined ? {} : { restartAt }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
  };
}

function normalizeEdge(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowEdge | null {
  const path = `workflow.edges[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const from = readStringField(value, "from", path, issues);
  const to = readStringField(value, "to", path, issues);
  const when = readStringField(value, "when", path, issues);
  const priorityRaw = value["priority"];

  let priority: number | undefined;
  if (priorityRaw !== undefined) {
    const parsed = readNumberField(value, "priority", path, issues);
    if (parsed !== null) {
      priority = parsed;
    }
  }

  if (from === null || to === null || when === null) {
    return null;
  }

  return {
    from,
    to,
    when,
    ...(priority === undefined ? {} : { priority }),
  };
}

function normalizeLoop(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): LoopRule | null {
  const path = `workflow.loops[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const judgeNodeId = readStringField(value, "judgeNodeId", path, issues);
  const continueWhen = readStringField(value, "continueWhen", path, issues);
  const exitWhen = readStringField(value, "exitWhen", path, issues);

  let maxIterations: number | undefined;
  const maxIterationsRaw = value["maxIterations"];
  if (maxIterationsRaw !== undefined) {
    const parsed = readNumberField(value, "maxIterations", path, issues);
    if (parsed !== null && parsed > 0) {
      maxIterations = parsed;
    } else if (parsed !== null) {
      issues.push(makeIssue("error", `${path}.maxIterations`, "must be > 0"));
    }
  }

  let backoffMs: number | undefined;
  const backoffRaw = value["backoffMs"];
  if (backoffRaw !== undefined) {
    const parsed = readNumberField(value, "backoffMs", path, issues);
    if (parsed !== null && parsed >= 0) {
      backoffMs = parsed;
    } else if (parsed !== null) {
      issues.push(makeIssue("error", `${path}.backoffMs`, "must be >= 0"));
    }
  }

  if (
    id === null ||
    judgeNodeId === null ||
    continueWhen === null ||
    exitWhen === null
  ) {
    return null;
  }

  return {
    id,
    judgeNodeId,
    continueWhen,
    exitWhen,
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(backoffMs === undefined ? {} : { backoffMs }),
  };
}

function normalizeWorkflowCall(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): WorkflowCallRef | null {
  const path = `workflow.workflowCalls[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const workflowId = readStringField(value, "workflowId", path, issues);
  const callerNodeId = readStringField(value, "callerNodeId", path, issues);

  const resultNodeIdRaw = value["resultNodeId"];
  let resultNodeId: string | undefined;
  if (resultNodeIdRaw !== undefined) {
    if (typeof resultNodeIdRaw === "string" && resultNodeIdRaw.length > 0) {
      resultNodeId = resultNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.resultNodeId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  if (id === null || workflowId === null || callerNodeId === null) {
    return null;
  }

  return {
    id,
    workflowId,
    callerNodeId,
    ...(resultNodeId === undefined ? {} : { resultNodeId }),
  };
}

function normalizeSubWorkflowInputSource(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): SubWorkflowInputSource | null {
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const typeRaw = value["type"];
  if (
    typeRaw !== "human-input" &&
    typeRaw !== "workflow-output" &&
    typeRaw !== "node-output" &&
    typeRaw !== "sub-workflow-output"
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.type`,
        "must be a valid sub-workflow input source type",
      ),
    );
    return null;
  }

  const workflowId =
    typeof value["workflowId"] === "string" ? value["workflowId"] : undefined;
  const nodeId =
    typeof value["nodeId"] === "string" ? value["nodeId"] : undefined;
  const subWorkflowId =
    typeof value["subWorkflowId"] === "string"
      ? value["subWorkflowId"]
      : undefined;

  if (
    typeRaw === "workflow-output" &&
    (workflowId === undefined || workflowId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.workflowId`,
        "is required when type is workflow-output",
      ),
    );
  }
  if (
    typeRaw === "node-output" &&
    (nodeId === undefined || nodeId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeId`,
        "is required when type is node-output",
      ),
    );
  }
  if (
    typeRaw === "sub-workflow-output" &&
    (subWorkflowId === undefined || subWorkflowId.length === 0)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.subWorkflowId`,
        "is required when type is sub-workflow-output",
      ),
    );
  }

  if (value["selectionPolicy"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.selectionPolicy`,
        "deprecated/unsupported in current runtime phase; remove or migrate before execution",
      ),
    );
    issues.push(
      makeIssue(
        "error",
        `${path}.selectionPolicy`,
        "is currently unsupported and rejected in the active runtime phase",
      ),
    );
  }

  return {
    type: typeRaw,
    ...(workflowId === undefined ? {} : { workflowId }),
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(subWorkflowId === undefined ? {} : { subWorkflowId }),
  };
}

function normalizeSubWorkflow(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): SubWorkflowRef | null {
  const path = `workflow.subWorkflows[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const description = readStringField(value, "description", path, issues);
  const managerNodeId = readStringField(value, "managerNodeId", path, issues);
  const inputNodeId = readStringField(value, "inputNodeId", path, issues);
  const outputNodeId = readStringField(value, "outputNodeId", path, issues);
  const nodeIdsRaw = value["nodeIds"];
  if (!Array.isArray(nodeIdsRaw)) {
    issues.push(makeIssue("error", `${path}.nodeIds`, "must be an array"));
  }
  const nodeIds = Array.isArray(nodeIdsRaw)
    ? nodeIdsRaw.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : undefined;
  if (
    Array.isArray(nodeIdsRaw) &&
    nodeIds !== undefined &&
    nodeIds.length !== nodeIdsRaw.length
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.nodeIds`,
        "must contain only non-empty strings",
      ),
    );
  }

  const inputSourcesAlias = value["inputs"];
  const inputSourcesRaw = value["inputSources"] ?? inputSourcesAlias;
  if (value["inputSources"] === undefined && inputSourcesAlias !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.inputs`,
        "legacy field 'inputs' normalized to 'inputSources'; update workflow JSON to canonical schema",
      ),
    );
  }
  if (!Array.isArray(inputSourcesRaw)) {
    issues.push(makeIssue("error", `${path}.inputSources`, "must be an array"));
  }
  const inputSources = Array.isArray(inputSourcesRaw)
    ? inputSourcesRaw
        .map((entry, sourceIndex) =>
          normalizeSubWorkflowInputSource(
            entry,
            `${path}.inputSources[${sourceIndex}]`,
            issues,
          ),
        )
        .filter((entry): entry is SubWorkflowInputSource => entry !== null)
    : [];

  let block: SubWorkflowBlock | undefined;
  const blockRaw = value["block"];
  if (blockRaw !== undefined) {
    if (!isRecord(blockRaw)) {
      issues.push(
        makeIssue("error", `${path}.block`, "must be an object when provided"),
      );
    } else {
      const typeRaw = blockRaw["type"];
      const loopIdRaw = blockRaw["loopId"];
      if (
        typeRaw !== "plain" &&
        typeRaw !== "branch-block" &&
        typeRaw !== "loop-body"
      ) {
        issues.push(
          makeIssue(
            "error",
            `${path}.block.type`,
            "must be 'plain', 'branch-block', or 'loop-body'",
          ),
        );
      } else {
        if (
          loopIdRaw !== undefined &&
          (typeof loopIdRaw !== "string" || loopIdRaw.length === 0)
        ) {
          issues.push(
            makeIssue(
              "error",
              `${path}.block.loopId`,
              "must be a non-empty string when provided",
            ),
          );
        }
        block = {
          type: typeRaw,
          ...(typeof loopIdRaw === "string" && loopIdRaw.length > 0
            ? { loopId: loopIdRaw }
            : {}),
        };
      }
    }
  }

  if (
    id === null ||
    description === null ||
    managerNodeId === null ||
    inputNodeId === null ||
    outputNodeId === null ||
    nodeIds === undefined
  ) {
    return null;
  }

  return {
    id,
    description,
    managerNodeId,
    inputNodeId,
    outputNodeId,
    nodeIds,
    inputSources,
    ...(block === undefined ? {} : { block }),
  };
}

function normalizeSubWorkflowConversation(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): SubWorkflowConversation | null {
  const path = `workflow.subWorkflowConversations[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  const stopWhen = readStringField(value, "stopWhen", path, issues);

  const participantsAlias = value["participantsIds"];
  const participantsRaw = value["participants"] ?? participantsAlias;
  if (value["participants"] === undefined && participantsAlias !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.participantsIds`,
        "legacy field 'participantsIds' normalized to 'participants'; update workflow JSON to canonical schema",
      ),
    );
  }
  if (!Array.isArray(participantsRaw)) {
    issues.push(makeIssue("error", `${path}.participants`, "must be an array"));
  }
  const participants = Array.isArray(participantsRaw)
    ? participantsRaw.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
  if (
    Array.isArray(participantsRaw) &&
    participants.length !== participantsRaw.length
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.participants`,
        "must contain only non-empty strings",
      ),
    );
  }

  const maxTurnsRaw = value["maxTurns"];
  let maxTurns: number | null = null;
  if (
    typeof maxTurnsRaw === "number" &&
    Number.isFinite(maxTurnsRaw) &&
    maxTurnsRaw > 0
  ) {
    maxTurns = maxTurnsRaw;
  } else {
    issues.push(
      makeIssue("error", `${path}.maxTurns`, "must be a positive number"),
    );
  }

  if (value["conversationPolicy"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.conversationPolicy`,
        "deprecated/unsupported in current runtime phase; remove or migrate before execution",
      ),
    );
    issues.push(
      makeIssue(
        "error",
        `${path}.conversationPolicy`,
        "is currently unsupported and rejected in the active runtime phase",
      ),
    );
  }

  if (id === null || stopWhen === null || maxTurns === null) {
    return null;
  }

  return {
    id,
    participants,
    maxTurns,
    stopWhen,
  };
}

function buildRepeatExitExpression(whileExpression: string): string {
  return `!(${whileExpression})`;
}

function synthesizeSequentialEdges(input: {
  readonly nodes: readonly WorkflowNodeRef[];
  readonly issues: ValidationIssue[];
}): readonly WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];

  input.nodes.forEach((node, index) => {
    const nextNode = input.nodes[index + 1];
    if (nextNode === undefined) {
      if (node.repeat !== undefined) {
        input.issues.push(
          makeIssue(
            "error",
            `workflow.nodes[${index}].repeat`,
            "repeat nodes cannot be the terminal node in simplified sequential mode",
          ),
        );
      }
      return;
    }

    if (node.repeat === undefined) {
      edges.push({ from: node.id, to: nextNode.id, when: "always" });
      return;
    }

    const restartAt = node.repeat.restartAt ?? node.id;
    const restartIndex = input.nodes.findIndex(
      (candidate) => candidate.id === restartAt,
    );
    if (restartIndex < 0) {
      input.issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].repeat.restartAt`,
          `must reference an existing node id (${restartAt})`,
        ),
      );
      return;
    }
    if (restartIndex > index) {
      input.issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].repeat.restartAt`,
          "must reference the same node or an earlier node in simplified sequential mode",
        ),
      );
      return;
    }

    edges.push({ from: node.id, to: restartAt, when: node.repeat.while });
    edges.push({
      from: node.id,
      to: nextNode.id,
      when: buildRepeatExitExpression(node.repeat.while),
    });
  });

  return edges;
}

function synthesizeRepeatLoops(
  nodes: readonly WorkflowNodeRef[],
): readonly LoopRule[] {
  return nodes.flatMap((node) =>
    node.repeat === undefined
      ? []
      : [
          {
            id: `repeat-${node.id}`,
            judgeNodeId: node.id,
            continueWhen: node.repeat.while,
            exitWhen: buildRepeatExitExpression(node.repeat.while),
            ...(node.repeat.maxIterations === undefined
              ? {}
              : { maxIterations: node.repeat.maxIterations }),
          },
        ],
  );
}

function normalizeWorkflow(
  workflow: unknown,
  issues: ValidationIssue[],
): WorkflowJson | null {
  if (!isRecord(workflow)) {
    issues.push(makeIssue("error", "workflow", "must be an object"));
    return null;
  }

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
  let description: string | null;
  if (descriptionRaw === undefined) {
    description = "";
  } else if (typeof descriptionRaw === "string" && descriptionRaw.length > 0) {
    description = descriptionRaw;
  } else {
    issues.push(
      makeIssue(
        "error",
        "workflow.description",
        "must be a non-empty string when provided",
      ),
    );
    description = null;
  }
  const managerNodeIdRaw = workflow["managerNodeId"];
  let managerNodeId: string | undefined | null;
  if (managerNodeIdRaw !== undefined) {
    if (typeof managerNodeIdRaw === "string" && managerNodeIdRaw.length > 0) {
      managerNodeId = managerNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.managerNodeId",
          "must be a non-empty string when provided",
        ),
      );
      managerNodeId = null;
    }
  }

  const entryNodeIdRaw = workflow["entryNodeId"];
  let entryNodeId: string | undefined | null;
  if (entryNodeIdRaw !== undefined) {
    if (typeof entryNodeIdRaw === "string" && entryNodeIdRaw.length > 0) {
      entryNodeId = entryNodeIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          "workflow.entryNodeId",
          "must be a non-empty string when provided",
        ),
      );
      entryNodeId = null;
    }
  }

  const defaultsValue = workflow["defaults"];
  if (!isRecord(defaultsValue)) {
    issues.push(makeIssue("error", "workflow.defaults", "must be an object"));
  }

  const maxLoopIterations =
    isRecord(defaultsValue) &&
    readNumberField(
      defaultsValue,
      "maxLoopIterations",
      "workflow.defaults",
      issues,
    );
  const nodeTimeoutMs =
    isRecord(defaultsValue) &&
    readNumberField(
      defaultsValue,
      "nodeTimeoutMs",
      "workflow.defaults",
      issues,
    );
  const containerRuntime = normalizeContainerRuntimeDefaults(
    isRecord(defaultsValue) ? defaultsValue["containerRuntime"] : undefined,
    "workflow.defaults.containerRuntime",
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

  const subWorkflowsRaw = workflow["subWorkflows"];
  const subWorkflows = Array.isArray(subWorkflowsRaw)
    ? subWorkflowsRaw
        .map((entry, index) => normalizeSubWorkflow(entry, index, issues))
        .filter((entry): entry is SubWorkflowRef => entry !== null)
    : [];
  if (subWorkflowsRaw !== undefined && !Array.isArray(subWorkflowsRaw)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflows",
        "must be an array when provided",
      ),
    );
  }

  const nodesRaw = workflow["nodes"];
  if (!Array.isArray(nodesRaw)) {
    issues.push(makeIssue("error", "workflow.nodes", "must be an array"));
  }
  const nodes = Array.isArray(nodesRaw)
    ? nodesRaw
        .map((entry, index) => normalizeNodeRef(entry, index, issues))
        .filter((entry): entry is WorkflowNodeRef => entry !== null)
    : [];

  const edgesRaw = workflow["edges"];
  if (edgesRaw !== undefined && !Array.isArray(edgesRaw)) {
    issues.push(
      makeIssue("error", "workflow.edges", "must be an array when provided"),
    );
  }
  const authoredEdges = Array.isArray(edgesRaw)
    ? edgesRaw
        .map((entry, index) => normalizeEdge(entry, index, issues))
        .filter((entry): entry is WorkflowEdge => entry !== null)
    : undefined;

  const workflowCallsRaw = workflow["workflowCalls"];
  if (workflowCallsRaw !== undefined && !Array.isArray(workflowCallsRaw)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowCalls",
        "must be an array when provided",
      ),
    );
  }
  const workflowCalls = Array.isArray(workflowCallsRaw)
    ? workflowCallsRaw
        .map((entry, index) => normalizeWorkflowCall(entry, index, issues))
        .filter((entry): entry is WorkflowCallRef => entry !== null)
    : undefined;

  const loopsRaw = workflow["loops"];
  const authoredLoops = Array.isArray(loopsRaw)
    ? loopsRaw
        .map((entry, index) => normalizeLoop(entry, index, issues))
        .filter((entry): entry is LoopRule => entry !== null)
    : undefined;

  if (loopsRaw !== undefined && !Array.isArray(loopsRaw)) {
    issues.push(
      makeIssue("error", "workflow.loops", "must be an array when provided"),
    );
  }

  const hasRepeatNodes = nodes.some((node) => node.repeat !== undefined);
  if (hasRepeatNodes && authoredEdges !== undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.edges",
        "repeat is supported only when workflow.edges is omitted in the simplified transition format",
      ),
    );
  }

  const edges = authoredEdges ?? synthesizeSequentialEdges({ nodes, issues });
  const repeatLoops = synthesizeRepeatLoops(nodes);
  const loops =
    authoredLoops === undefined
      ? repeatLoops.length === 0
        ? undefined
        : repeatLoops
      : [...authoredLoops, ...repeatLoops];

  const branching = workflow["branching"];
  if (branching !== undefined) {
    if (!isRecord(branching)) {
      issues.push(
        makeIssue("error", "workflow.branching", "must be an object"),
      );
    }
    if (!isRecord(branching) || branching["mode"] !== "fan-out") {
      issues.push(
        makeIssue("error", "workflow.branching.mode", "must be 'fan-out'"),
      );
    }
  }

  const subWorkflowConversationsRaw = workflow["subWorkflowConversations"];
  if (
    subWorkflowConversationsRaw !== undefined &&
    !Array.isArray(subWorkflowConversationsRaw)
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.subWorkflowConversations",
        "must be an array when provided",
      ),
    );
  }
  const subWorkflowConversations = Array.isArray(subWorkflowConversationsRaw)
    ? subWorkflowConversationsRaw
        .map((entry, index) =>
          normalizeSubWorkflowConversation(entry, index, issues),
        )
        .filter((entry): entry is SubWorkflowConversation => entry !== null)
    : undefined;

  const authoredManagerNodeIds = nodes
    .filter((node) => node.role === "manager")
    .map((node) => node.id);
  const hasManagerNode =
    managerNodeId !== undefined || authoredManagerNodeIds.length > 0;
  let effectiveManagerNodeId = managerNodeId;
  if (effectiveManagerNodeId === undefined) {
    if (authoredManagerNodeIds.length === 1) {
      effectiveManagerNodeId = authoredManagerNodeIds[0];
    } else if (
      authoredManagerNodeIds.length === 0 &&
      entryNodeId !== undefined
    ) {
      effectiveManagerNodeId = entryNodeId;
    }
  }
  let effectiveEntryNodeId = entryNodeId;
  if (effectiveEntryNodeId === undefined) {
    effectiveEntryNodeId = effectiveManagerNodeId;
  }

  if (effectiveManagerNodeId === undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "is required unless exactly one manager-role node can be inferred or entryNodeId is provided for a manager-less workflow",
      ),
    );
  }
  if (effectiveEntryNodeId === undefined) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryNodeId",
        "is required unless it can be derived from managerNodeId",
      ),
    );
  }

  if (
    workflowId === null ||
    description === null ||
    managerNodeId === null ||
    entryNodeId === null ||
    typeof maxLoopIterations !== "number" ||
    typeof nodeTimeoutMs !== "number" ||
    effectiveManagerNodeId === undefined ||
    effectiveEntryNodeId === undefined
  ) {
    return null;
  }

  if (maxLoopIterations <= 0) {
    issues.push(
      makeIssue("error", "workflow.defaults.maxLoopIterations", "must be > 0"),
    );
  }
  if (nodeTimeoutMs <= 0) {
    issues.push(
      makeIssue("error", "workflow.defaults.nodeTimeoutMs", "must be > 0"),
    );
  }

  return {
    workflowId: workflowId!,
    description: description!,
    defaults: { maxLoopIterations, nodeTimeoutMs, containerRuntime },
    ...(prompts === undefined ? {} : { prompts }),
    managerNodeId: effectiveManagerNodeId!,
    hasManagerNode,
    entryNodeId: effectiveEntryNodeId!,
    ...(workflowCalls === undefined ? {} : { workflowCalls }),
    subWorkflows,
    ...(subWorkflowConversations === undefined
      ? {}
      : { subWorkflowConversations }),
    nodes,
    edges,
    ...(loops === undefined ? {} : { loops }),
    branching: { mode: "fan-out" },
  };
}

function normalizeVisNode(
  value: unknown,
  index: number,
  issues: ValidationIssue[],
): NormalizedVisNodeCandidate | null {
  const path = `workflowVis.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(value, "id", path, issues);
  if (id === null) {
    return null;
  }

  let order: number | undefined;
  const orderRaw = value["order"];
  if (orderRaw !== undefined) {
    if (
      typeof orderRaw !== "number" ||
      !Number.isInteger(orderRaw) ||
      orderRaw < 0
    ) {
      issues.push(
        makeIssue("error", `${path}.order`, "must be a non-negative integer"),
      );
    } else {
      order = orderRaw;
    }
  } else {
    const hasLegacyLayoutFields =
      value["x"] !== undefined ||
      value["y"] !== undefined ||
      value["width"] !== undefined ||
      value["height"] !== undefined;
    if (hasLegacyLayoutFields) {
      const x = readNumberField(value, "x", path, issues);
      const y = readNumberField(value, "y", path, issues);
      const width = readNumberField(value, "width", path, issues);
      const height = readNumberField(value, "height", path, issues);
      if (x !== null && y !== null && width !== null && height !== null) {
        return {
          id,
          legacyLayout: { x, y, width, height },
        };
      }
    } else {
      issues.push(
        makeIssue("error", `${path}.order`, "must be a non-negative integer"),
      );
    }
  }

  if (value["indent"] !== undefined || value["indentLevel"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.indent`,
        "is ignored; indent is derived from workflow graph structure",
      ),
    );
  }

  if (value["color"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.color`,
        "is ignored; color is derived from workflow loop/group scope",
      ),
    );
  }

  if (order === undefined) {
    return null;
  }

  return {
    id,
    ...(order === undefined ? {} : { order }),
  };
}

function normalizeWorkflowVis(
  workflowVis: unknown,
  issues: ValidationIssue[],
): WorkflowVisJson | null {
  if (!isRecord(workflowVis)) {
    issues.push(makeIssue("error", "workflowVis", "must be an object"));
    return null;
  }

  const nodesRaw = workflowVis["nodes"];
  if (!Array.isArray(nodesRaw)) {
    issues.push(makeIssue("error", "workflowVis.nodes", "must be an array"));
    return null;
  }

  const candidates = nodesRaw
    .map((entry, index) => normalizeVisNode(entry, index, issues))
    .filter((entry): entry is NormalizedVisNodeCandidate => entry !== null);

  const legacyCandidates = candidates.filter(
    (
      entry,
    ): entry is NormalizedVisNodeCandidate & {
      readonly legacyLayout: LegacyLayout;
    } => entry.legacyLayout !== undefined,
  );
  const explicitCandidates = candidates.filter(
    (entry): entry is NormalizedVisNodeCandidate & { readonly order: number } =>
      entry.order !== undefined,
  );

  if (legacyCandidates.length > 0 && explicitCandidates.length > 0) {
    issues.push(
      makeIssue(
        "error",
        "workflowVis.nodes",
        "must not mix explicit order entries with legacy coordinate layout entries",
      ),
    );
  }

  const nodes: readonly VisNode[] =
    legacyCandidates.length > 0
      ? [...legacyCandidates]
          .sort((a, b) => {
            const aLayout = a.legacyLayout;
            const bLayout = b.legacyLayout;
            return (
              aLayout.y - bLayout.y ||
              aLayout.x - bLayout.x ||
              a.id.localeCompare(b.id)
            );
          })
          .map((entry, index) => {
            issues.push(
              makeIssue(
                "warning",
                `workflowVis.nodes[${index}].order`,
                "legacy x/y layout normalized to top-to-bottom, left-to-right order; set explicit order",
              ),
            );
            return { id: entry.id, order: index };
          })
      : [...explicitCandidates]
          .map((entry) => ({ id: entry.id, order: entry.order }))
          .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  if (workflowVis["viewport"] !== undefined) {
    issues.push(
      makeIssue(
        "warning",
        "workflowVis.viewport",
        "legacy canvas viewport is ignored in vertical workflow layout",
      ),
    );
  }

  const uiMetaRaw = workflowVis["uiMeta"];
  if (uiMetaRaw !== undefined && !isRecord(uiMetaRaw)) {
    issues.push(
      makeIssue(
        "error",
        "workflowVis.uiMeta",
        "must be an object when provided",
      ),
    );
  }

  return {
    nodes,
    ...(isRecord(uiMetaRaw) ? { uiMeta: uiMetaRaw } : {}),
  };
}

function normalizeNodeTemplateFields(args: {
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly issues: ValidationIssue[];
  readonly templateField: string;
  readonly templateFileField: string;
  readonly legacyAliasField?: string;
}): {
  readonly template?: string;
  readonly templateFile?: string;
} {
  const templateRaw = args.payload[args.templateField];
  const templateFileRaw = args.payload[args.templateFileField];
  const legacyAliasRaw =
    args.legacyAliasField === undefined
      ? undefined
      : args.payload[args.legacyAliasField];

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
              "must not target canonical workflow definition files such as workflow.json, workflow-vis.json, or node-*.json",
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
  } else if (typeof legacyAliasRaw === "string" && legacyAliasRaw.length > 0) {
    template = legacyAliasRaw;
    args.issues.push(
      makeIssue(
        "warning",
        `${args.path}.${args.legacyAliasField ?? args.templateField}`,
        `legacy field '${args.legacyAliasField}' normalized to '${args.templateField}'`,
      ),
    );
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

function normalizeNodePayload(
  nodeId: string,
  nodeFile: string,
  payload: unknown,
  issues: ValidationIssue[],
): NodePayload | null {
  const path = `nodePayloads.${nodeFile}`;
  if (!isRecord(payload)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return null;
  }

  const id = readStringField(payload, "id", path, issues);
  if (id !== null && id !== nodeId) {
    issues.push(makeIssue("error", `${path}.id`, `must equal ${nodeId}`));
  }

  let nodeType: NodeType = "agent";
  const nodeTypeRaw = payload["nodeType"];
  if (nodeTypeRaw !== undefined) {
    if (isNodeType(nodeTypeRaw)) {
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
  const legacyContainer = normalizeLegacyRuntimeIsolationToContainer(
    payload["runtimeIsolation"],
    `${path}.runtimeIsolation`,
    issues,
  );
  if (container !== undefined && legacyContainer !== undefined) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must not declare both container and legacy runtimeIsolation",
      ),
    );
  }
  const effectiveContainer = container ?? legacyContainer;
  if (effectiveContainer !== undefined && nodeTypeRaw === undefined) {
    nodeType = "container";
  }

  const modelRaw = payload["model"];
  let model: string | undefined;
  if (typeof modelRaw === "string" && modelRaw.length > 0) {
    model = modelRaw;
  } else if (modelRaw !== undefined && nodeType === "agent") {
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
      if (
        typeof executionBackendRaw === "string" &&
        executionBackendRaw !== normalizedExecutionBackend
      ) {
        issues.push(
          makeIssue(
            "warning",
            `${path}.executionBackend`,
            `legacy executionBackend '${executionBackendRaw}' normalized to '${normalizedExecutionBackend}'`,
          ),
        );
      }
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.executionBackend`,
          "must be codex-agent, claude-code-agent, official/openai-sdk, or official/anthropic-sdk",
        ),
      );
    }
  } else if (
    nodeType === "agent" &&
    model !== undefined &&
    !isCliAgentBackend(model)
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.executionBackend`,
        "is required when model is not one of the tacogips CLI-wrapper backend identifiers",
      ),
    );
  } else if (
    nodeType === "agent" &&
    model !== undefined &&
    executionBackend === undefined &&
    isCliAgentBackend(model)
  ) {
    issues.push(
      makeIssue(
        "warning",
        `${path}.model`,
        "legacy CLI backend identifier encoded in model; prefer explicit executionBackend plus a provider model name",
      ),
    );
  }
  if (
    nodeType === "agent" &&
    model !== undefined &&
    requiresSeparatedModel(executionBackend) &&
    normalizeCliAgentBackend(model) !== null
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
    legacyAliasField: "prompt",
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
  if (promptTemplate === undefined && nodeType === "agent") {
    issues.push(
      makeIssue(
        "error",
        `${path}.promptTemplate`,
        "must be a non-empty string",
      ),
    );
  }

  const variablesRaw = payload["variables"];
  const variablesAlias = payload["variable"];
  let variables: UnknownRecord | null = null;
  if (isRecord(variablesRaw)) {
    variables = variablesRaw;
  } else if (isRecord(variablesAlias)) {
    variables = variablesAlias;
    issues.push(
      makeIssue(
        "warning",
        `${path}.variable`,
        "legacy field 'variable' normalized to 'variables'",
      ),
    );
  } else {
    issues.push(makeIssue("error", `${path}.variables`, "must be an object"));
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
  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined) {
    if (typeof timeoutRaw === "number" && timeoutRaw > 0) {
      timeoutMs = timeoutRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.timeoutMs`, "must be > 0 when provided"),
      );
    }
  }

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
          sourceRaw !== "sub-workflow-output" &&
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

  const outputContract = normalizeNodeOutputContract(
    payload["output"],
    `${path}.output`,
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
  if (nodeType === "container" && effectiveContainer === undefined) {
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
  if (nodeType === "user-action" && effectiveContainer !== undefined) {
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
    (nodeType === "agent" &&
      (model === undefined || promptTemplate === undefined))
  ) {
    return null;
  }

  return {
    id,
    ...(description === undefined ? {} : { description }),
    ...(nodeType === "agent" ? {} : { nodeType }),
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
    variables,
    ...(command === undefined ? {} : { command }),
    ...(effectiveContainer === undefined
      ? {}
      : { container: effectiveContainer }),
    ...(durability === undefined ? {} : { durability }),
    ...(userAction === undefined ? {} : { userAction }),
    ...(argumentsTemplate === undefined ? {} : { argumentsTemplate }),
    ...(argumentBindings === undefined ? {} : { argumentBindings }),
    ...(templateEngine === undefined ? {} : { templateEngine }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(outputContract === undefined ? {} : { output: outputContract }),
  };
}

function normalizeUserActionNodeConfig(
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

function normalizeNamedStringArrayField(
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

function normalizeOptionalNamedStringArrayField(
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

function normalizeOptionalBooleanField(
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

function normalizeNodeOutputContract(
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

function intervalsPartiallyOverlap(
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

function findNodeIdByOrder(
  bundle: NormalizedWorkflowBundle,
  order: number,
): string {
  return (
    bundle.workflowVis.nodes.find((entry) => entry.order === order)?.id ??
    "unknown"
  );
}

function pushCrossingIntervalIssue(
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

function runSemanticValidation(
  bundle: NormalizedWorkflowBundle,
  issues: ValidationIssue[],
): void {
  const nodeIdSet = new Set(bundle.workflow.nodes.map((node) => node.id));
  const visOrderByNodeId = new Map(
    bundle.workflowVis.nodes.map((entry) => [entry.id, entry.order]),
  );
  const rootManagerNodeIds = bundle.workflow.nodes
    .filter((node) => node.kind === "root-manager")
    .map((node) => node.id);
  const managerRoleNodeIds = bundle.workflow.nodes
    .filter((node) => node.role === "manager")
    .map((node) => node.id);

  if (!nodeIdSet.has(bundle.workflow.managerNodeId)) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        `must reference an existing node id (${bundle.workflow.managerNodeId})`,
      ),
    );
  }

  if (
    bundle.workflow.entryNodeId !== undefined &&
    !nodeIdSet.has(bundle.workflow.entryNodeId)
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryNodeId",
        `must reference an existing node id (${bundle.workflow.entryNodeId})`,
      ),
    );
  }

  if (managerRoleNodeIds.length > 1) {
    managerRoleNodeIds.forEach((nodeId) => {
      issues.push(
        makeIssue(
          "error",
          "workflow.nodes",
          `node '${nodeId}' cannot use role 'manager' because workflows may define at most one manager node`,
        ),
      );
    });
  }

  const managerNode = bundle.workflow.nodes.find(
    (node) => node.id === bundle.workflow.managerNodeId,
  );
  if (
    managerRoleNodeIds.length === 1 &&
    managerRoleNodeIds[0] !== bundle.workflow.managerNodeId
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        `must reference the manager-role node '${managerRoleNodeIds[0]}'`,
      ),
    );
  }
  if (
    bundle.workflow.hasManagerNode !== false &&
    managerNode?.kind !== "root-manager"
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "must reference a node with kind 'root-manager'",
      ),
    );
  }
  if (
    bundle.workflow.hasManagerNode === false &&
    bundle.workflow.entryNodeId !== undefined &&
    bundle.workflow.managerNodeId !== bundle.workflow.entryNodeId
  ) {
    issues.push(
      makeIssue(
        "error",
        "workflow.managerNodeId",
        "manager-less workflows must derive managerNodeId from entryNodeId during the transition runtime phase",
      ),
    );
  }
  if (bundle.workflow.hasManagerNode === false) {
    issues.push(
      makeIssue(
        "error",
        "workflow.entryNodeId",
        "manager-less workflows are not executable in the current runtime phase",
      ),
    );
  }
  rootManagerNodeIds.forEach((nodeId) => {
    if (nodeId === bundle.workflow.managerNodeId) {
      return;
    }
    issues.push(
      makeIssue(
        "error",
        "workflow.nodes",
        `node '${nodeId}' cannot use kind 'root-manager' unless it is workflow.managerNodeId`,
      ),
    );
  });

  const seenNodeIds = new Set<string>();
  bundle.workflow.nodes.forEach((node, index) => {
    if (seenNodeIds.has(node.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.nodes[${index}].id`,
          `duplicate node id '${node.id}'`,
        ),
      );
      return;
    }
    seenNodeIds.add(node.id);

    const payload = bundle.nodePayloads[node.id];
    if (!payload) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}`,
          "node payload file is missing",
        ),
      );
      return;
    }

    if (
      node.role === "manager" &&
      (payload.nodeType === "command" ||
        payload.nodeType === "container" ||
        payload.nodeType === "user-action")
    ) {
      issues.push(
        makeIssue(
          "error",
          `nodePayloads.${node.nodeFile}.nodeType`,
          "manager-role nodes must stay on the agent execution path",
        ),
      );
    }

    if (
      payload.timeoutMs === undefined &&
      bundle.workflow.defaults.nodeTimeoutMs === DEFAULT_NODE_TIMEOUT_MS
    ) {
      issues.push(
        makeIssue(
          "warning",
          `nodePayloads.${node.nodeFile}.timeoutMs`,
          "not set; workflow default timeout will be applied",
        ),
      );
    }
  });

  bundle.workflow.edges.forEach((edge, index) => {
    if (!nodeIdSet.has(edge.from)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.edges[${index}].from`,
          "must reference an existing node id",
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.edges[${index}].to`,
          "must reference an existing node id",
        ),
      );
    }
  });

  const workflowCallIdSet = new Set<string>();
  bundle.workflow.workflowCalls?.forEach((call, index) => {
    issues.push(
      makeIssue(
        "error",
        "workflow.workflowCalls",
        "workflowCalls are not executable in the current runtime phase",
      ),
    );
    if (workflowCallIdSet.has(call.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].id`,
          `duplicate workflow call id '${call.id}'`,
        ),
      );
    } else {
      workflowCallIdSet.add(call.id);
    }

    if (!nodeIdSet.has(call.callerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].callerNodeId`,
          "must reference an existing node id",
        ),
      );
    }

    if (call.resultNodeId !== undefined && !nodeIdSet.has(call.resultNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.workflowCalls[${index}].resultNodeId`,
          "must reference an existing node id when provided",
        ),
      );
    }
  });

  bundle.workflow.loops?.forEach((loop, index) => {
    if (!nodeIdSet.has(loop.judgeNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference an existing node id",
        ),
      );
      return;
    }
    const judgeNode = bundle.workflow.nodes.find(
      (node) => node.id === loop.judgeNodeId,
    );
    if (judgeNode?.kind !== "loop-judge") {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].judgeNodeId`,
          "must reference a loop-judge node",
        ),
      );
    }
  });

  const declaredSubWorkflowIds = new Set(
    bundle.workflow.subWorkflows.map((entry) => entry.id),
  );
  const declaredLoopIds = new Set(
    (bundle.workflow.loops ?? []).map((entry) => entry.id),
  );
  const subWorkflowIdSet = new Set<string>();
  const loopBodyOwnerByLoopId = new Map<string, string>();
  const subWorkflowNodeOwnership = new Map<string, string>();
  const subWorkflowBoundaryOwnership = new Map<string, string>();
  bundle.workflow.subWorkflows.forEach((subWorkflow, index) => {
    if (subWorkflowIdSet.has(subWorkflow.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].id`,
          `duplicate subWorkflow id '${subWorkflow.id}'`,
        ),
      );
    } else {
      subWorkflowIdSet.add(subWorkflow.id);
    }

    if (subWorkflow.managerNodeId === subWorkflow.inputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must not reference the same node as inputNodeId",
        ),
      );
    }
    if (subWorkflow.managerNodeId === subWorkflow.outputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must not reference the same node as outputNodeId",
        ),
      );
    }
    if (subWorkflow.inputNodeId === subWorkflow.outputNodeId) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          "must not reference the same node as outputNodeId",
        ),
      );
    }

    if (!nodeIdSet.has(subWorkflow.managerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const subManagerNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.managerNodeId,
      );
      if (subManagerNode?.kind !== "subworkflow-manager") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].managerNodeId`,
            "must reference a node with kind 'subworkflow-manager'",
          ),
        );
      }
    }
    const existingBoundaryOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.managerNodeId,
    );
    if (
      existingBoundaryOwner !== undefined &&
      existingBoundaryOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].managerNodeId`,
          `manager node '${subWorkflow.managerNodeId}' is already assigned to subWorkflow '${existingBoundaryOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(
        subWorkflow.managerNodeId,
        subWorkflow.id,
      );
    }

    if (!nodeIdSet.has(subWorkflow.inputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const inputNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.inputNodeId,
      );
      if (inputNode?.kind !== "input") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].inputNodeId`,
            "must reference a node with kind 'input'",
          ),
        );
      }
    }
    const existingInputOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.inputNodeId,
    );
    if (
      existingInputOwner !== undefined &&
      existingInputOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].inputNodeId`,
          `input node '${subWorkflow.inputNodeId}' is already assigned to subWorkflow '${existingInputOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(subWorkflow.inputNodeId, subWorkflow.id);
    }

    if (!nodeIdSet.has(subWorkflow.outputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].outputNodeId`,
          "must reference an existing node id",
        ),
      );
    } else {
      const outputNode = bundle.workflow.nodes.find(
        (node) => node.id === subWorkflow.outputNodeId,
      );
      if (outputNode?.kind !== "output") {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].outputNodeId`,
            "must reference a node with kind 'output'",
          ),
        );
      }
    }
    const existingOutputOwner = subWorkflowBoundaryOwnership.get(
      subWorkflow.outputNodeId,
    );
    if (
      existingOutputOwner !== undefined &&
      existingOutputOwner !== subWorkflow.id
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].outputNodeId`,
          `output node '${subWorkflow.outputNodeId}' is already assigned to subWorkflow '${existingOutputOwner}'`,
        ),
      );
    } else {
      subWorkflowBoundaryOwnership.set(
        subWorkflow.outputNodeId,
        subWorkflow.id,
      );
    }

    if (subWorkflow.nodeIds.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must not be empty",
        ),
      );
    }
    const seenNodeIds = new Set<string>();
    subWorkflow.nodeIds.forEach((nodeId, nodeIndex) => {
      if (seenNodeIds.has(nodeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            `duplicate node id '${nodeId}' is not allowed within the same subWorkflow`,
          ),
        );
        return;
      }
      seenNodeIds.add(nodeId);
      if (!nodeIdSet.has(nodeId)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            "must reference an existing node id",
          ),
        );
        return;
      }
      const existingOwner = subWorkflowNodeOwnership.get(nodeId);
      if (existingOwner !== undefined && existingOwner !== subWorkflow.id) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflows[${index}].nodeIds[${nodeIndex}]`,
            `node id '${nodeId}' is already owned by subWorkflow '${existingOwner}'`,
          ),
        );
        return;
      }
      subWorkflowNodeOwnership.set(nodeId, subWorkflow.id);
    });

    if (!subWorkflow.nodeIds.includes(subWorkflow.managerNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include managerNodeId",
        ),
      );
    }
    if (!subWorkflow.nodeIds.includes(subWorkflow.inputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include inputNodeId",
        ),
      );
    }
    if (!subWorkflow.nodeIds.includes(subWorkflow.outputNodeId)) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].nodeIds`,
          "must include outputNodeId",
        ),
      );
    }

    subWorkflow.inputSources.forEach((source, sourceIndex) => {
      const sourcePath = `workflow.subWorkflows[${index}].inputSources[${sourceIndex}]`;
      if (
        source.type === "node-output" &&
        source.nodeId !== undefined &&
        !nodeIdSet.has(source.nodeId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `${sourcePath}.nodeId`,
            "must reference an existing node id",
          ),
        );
      }
      if (
        source.type === "sub-workflow-output" &&
        source.subWorkflowId !== undefined &&
        !declaredSubWorkflowIds.has(source.subWorkflowId)
      ) {
        issues.push(
          makeIssue(
            "error",
            `${sourcePath}.subWorkflowId`,
            "must reference an existing subWorkflow id",
          ),
        );
      }
    });

    const blockPath = `workflow.subWorkflows[${index}].block`;
    if (subWorkflow.block?.type === "branch-block") {
      const incomingBranchEdges = bundle.workflow.edges.filter(
        (edge) =>
          edge.to === subWorkflow.managerNodeId &&
          bundle.workflow.nodes.find((node) => node.id === edge.from)?.kind ===
            "branch-judge",
      );
      if (incomingBranchEdges.length === 0) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.type`,
            "branch-block subWorkflow must be entered by at least one edge from a branch-judge to its managerNodeId",
          ),
        );
      }
    }
    if (subWorkflow.block?.type === "loop-body") {
      if (subWorkflow.block.loopId === undefined) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.loopId`,
            "is required when block.type is 'loop-body'",
          ),
        );
      } else if (!declaredLoopIds.has(subWorkflow.block.loopId)) {
        issues.push(
          makeIssue(
            "error",
            `${blockPath}.loopId`,
            "must reference an existing workflow loop id",
          ),
        );
      } else {
        const existingOwner = loopBodyOwnerByLoopId.get(
          subWorkflow.block.loopId,
        );
        if (existingOwner !== undefined && existingOwner !== subWorkflow.id) {
          issues.push(
            makeIssue(
              "error",
              `${blockPath}.loopId`,
              `loop '${subWorkflow.block.loopId}' is already assigned to loop-body subWorkflow '${existingOwner}'`,
            ),
          );
        } else {
          loopBodyOwnerByLoopId.set(subWorkflow.block.loopId, subWorkflow.id);
        }

        const loopRule = bundle.workflow.loops?.find(
          (entry) => entry.id === subWorkflow.block?.loopId,
        );
        const continueEdgeToManager =
          loopRule === undefined
            ? undefined
            : bundle.workflow.edges.find(
                (edge) =>
                  edge.from === loopRule.judgeNodeId &&
                  edge.when === loopRule.continueWhen &&
                  edge.to === subWorkflow.managerNodeId,
              );
        if (loopRule !== undefined && continueEdgeToManager === undefined) {
          issues.push(
            makeIssue(
              "error",
              `${blockPath}.loopId`,
              `loop-body subWorkflow must be re-entered by loop '${subWorkflow.block.loopId}' via a continue edge to manager '${subWorkflow.managerNodeId}'`,
            ),
          );
        }
      }
    }
    if (
      subWorkflow.block?.type !== "loop-body" &&
      subWorkflow.block?.loopId !== undefined
    ) {
      issues.push(
        makeIssue(
          "error",
          `${blockPath}.loopId`,
          "is only allowed when block.type is 'loop-body'",
        ),
      );
    }
  });

  bundle.workflow.edges.forEach((edge, index) => {
    const sourceSubWorkflowId = subWorkflowNodeOwnership.get(edge.from);
    const targetSubWorkflowId = subWorkflowNodeOwnership.get(edge.to);

    if (sourceSubWorkflowId === targetSubWorkflowId) {
      return;
    }

    if (
      sourceSubWorkflowId === undefined &&
      targetSubWorkflowId !== undefined
    ) {
      const targetSubWorkflow = bundle.workflow.subWorkflows.find(
        (entry) => entry.id === targetSubWorkflowId,
      );
      if (
        targetSubWorkflow !== undefined &&
        edge.to !== targetSubWorkflow.managerNodeId
      ) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].to`,
            `cross-scope edge from root scope must target recipient sub-workflow manager '${targetSubWorkflow.managerNodeId}', not child node '${edge.to}'`,
          ),
        );
      }
      return;
    }

    if (
      sourceSubWorkflowId !== undefined &&
      targetSubWorkflowId === undefined
    ) {
      if (edge.to !== bundle.workflow.managerNodeId) {
        issues.push(
          makeIssue(
            "error",
            `workflow.edges[${index}].to`,
            `cross-scope edge from sub-workflow '${sourceSubWorkflowId}' to root scope must target workflow manager '${bundle.workflow.managerNodeId}', not root node '${edge.to}'`,
          ),
        );
      }
      return;
    }

    const targetSubWorkflow = bundle.workflow.subWorkflows.find(
      (entry) => entry.id === targetSubWorkflowId,
    );
    if (
      targetSubWorkflow !== undefined &&
      edge.to !== targetSubWorkflow.managerNodeId
    ) {
      issues.push(
        makeIssue(
          "error",
          `workflow.edges[${index}].to`,
          `cross-scope edge from sub-workflow '${sourceSubWorkflowId}' to sub-workflow '${targetSubWorkflowId}' must target recipient manager '${targetSubWorkflow.managerNodeId}', not child node '${edge.to}'`,
        ),
      );
    }
  });

  bundle.workflow.subWorkflowConversations?.forEach((conversation, index) => {
    if (conversation.participants.length < 2) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflowConversations[${index}].participants`,
          "must include at least two participants",
        ),
      );
    }
    if (new Set(conversation.participants).size < 2) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflowConversations[${index}].participants`,
          "must include at least two distinct participants",
        ),
      );
    }
    conversation.participants.forEach((participant, participantIndex) => {
      if (!declaredSubWorkflowIds.has(participant)) {
        issues.push(
          makeIssue(
            "error",
            `workflow.subWorkflowConversations[${index}].participants[${participantIndex}]`,
            "must reference an existing subWorkflow id",
          ),
        );
      }
    });
  });

  const visNodeSet = new Set<string>();
  const visOrderSet = new Set<number>();
  bundle.workflowVis.nodes.forEach((entry, index) => {
    if (!nodeIdSet.has(entry.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflowVis.nodes[${index}].id`,
          "references unknown node id",
        ),
      );
    }
    if (visNodeSet.has(entry.id)) {
      issues.push(
        makeIssue(
          "error",
          `workflowVis.nodes[${index}].id`,
          `duplicate vis node id '${entry.id}'`,
        ),
      );
    } else {
      visNodeSet.add(entry.id);
    }
    if (visOrderSet.has(entry.order)) {
      issues.push(
        makeIssue(
          "error",
          `workflowVis.nodes[${index}].order`,
          `duplicate order '${entry.order}'`,
        ),
      );
    } else {
      visOrderSet.add(entry.order);
    }
  });

  nodeIdSet.forEach((nodeId) => {
    if (!visNodeSet.has(nodeId)) {
      issues.push(
        makeIssue(
          "error",
          "workflowVis.nodes",
          `missing vertical order for node '${nodeId}'`,
        ),
      );
    }
  });

  const subWorkflowIntervals: Array<{
    readonly id: string;
    readonly inputOrder: number;
    readonly outputOrder: number;
  }> = [];
  for (const subWorkflow of bundle.workflow.subWorkflows) {
    const inputOrder = visOrderByNodeId.get(subWorkflow.inputNodeId);
    const outputOrder = visOrderByNodeId.get(subWorkflow.outputNodeId);
    if (inputOrder === undefined || outputOrder === undefined) {
      continue;
    }
    if (inputOrder > outputOrder) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows.${subWorkflow.id}`,
          "must place inputNodeId before outputNodeId in vertical order",
        ),
      );
      continue;
    }
    subWorkflowIntervals.push({
      id: subWorkflow.id,
      inputOrder,
      outputOrder,
    });
  }

  for (let index = 0; index < subWorkflowIntervals.length; index += 1) {
    const current = subWorkflowIntervals[index];
    if (current === undefined) {
      continue;
    }
    for (
      let compareIndex = index + 1;
      compareIndex < subWorkflowIntervals.length;
      compareIndex += 1
    ) {
      const other = subWorkflowIntervals[compareIndex];
      if (other === undefined) {
        continue;
      }
      if (
        intervalsPartiallyOverlap(
          { startOrder: current.inputOrder, endOrder: current.outputOrder },
          { startOrder: other.inputOrder, endOrder: other.outputOrder },
        )
      ) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow.subWorkflows",
          leftId: current.id,
          leftStartOrder: current.inputOrder,
          rightId: other.id,
          rightStartOrder: other.inputOrder,
          messagePrefix: "vertical subWorkflow groups",
        });
      }
    }
  }

  const loopIntervals: Array<{
    readonly id: string;
    readonly startOrder: number;
    readonly endOrder: number;
  }> = [];
  const loopIdsRepresentedBySubWorkflow = new Set<string>();
  bundle.workflow.subWorkflows.forEach((subWorkflow, index) => {
    if (
      subWorkflow.block?.type !== "loop-body" ||
      subWorkflow.block.loopId === undefined
    ) {
      return;
    }
    const inputOrder = visOrderByNodeId.get(subWorkflow.inputNodeId);
    const outputOrder = visOrderByNodeId.get(subWorkflow.outputNodeId);
    if (inputOrder === undefined || outputOrder === undefined) {
      return;
    }
    if (inputOrder > outputOrder) {
      issues.push(
        makeIssue(
          "error",
          `workflow.subWorkflows[${index}].block.loopId`,
          "loop-body subWorkflow must place inputNodeId before outputNodeId in vertical order",
        ),
      );
      return;
    }
    loopIntervals.push({
      id: subWorkflow.block.loopId,
      startOrder: inputOrder,
      endOrder: outputOrder,
    });
    loopIdsRepresentedBySubWorkflow.add(subWorkflow.block.loopId);
  });
  bundle.workflow.loops?.forEach((loop, index) => {
    if (loopIdsRepresentedBySubWorkflow.has(loop.id)) {
      return;
    }
    const judgeOrder = visOrderByNodeId.get(loop.judgeNodeId);
    if (judgeOrder === undefined) {
      return;
    }

    const continueTargets = bundle.workflow.edges.filter(
      (edge) =>
        edge.from === loop.judgeNodeId && edge.when === loop.continueWhen,
    );
    if (continueTargets.length === 0) {
      issues.push(
        makeIssue(
          "error",
          `workflow.loops[${index}].continueWhen`,
          "must have at least one matching continue edge from the loop judge",
        ),
      );
    }
    continueTargets.forEach((edge, continueIndex) => {
      const targetOrder = visOrderByNodeId.get(edge.to);
      if (targetOrder === undefined) {
        return;
      }
      if (targetOrder <= judgeOrder) {
        loopIntervals.push({
          id: loop.id,
          startOrder: targetOrder,
          endOrder: judgeOrder,
        });
      }
      if (targetOrder > judgeOrder) {
        issues.push(
          makeIssue(
            "error",
            `workflow.loops[${index}].continueWhen`,
            `continue edge target '${edge.to}' must appear before loop judge '${loop.judgeNodeId}' in vertical order`,
          ),
        );
      }
      if (
        continueIndex > 0 &&
        targetOrder !== undefined &&
        targetOrder !== visOrderByNodeId.get(continueTargets[0]?.to ?? "")
      ) {
        issues.push(
          makeIssue(
            "warning",
            `workflow.loops[${index}].continueWhen`,
            "multiple continue targets produce a shared visual loop block based on the earliest target",
          ),
        );
      }
    });

    bundle.workflow.edges
      .filter(
        (edge) => edge.from === loop.judgeNodeId && edge.when === loop.exitWhen,
      )
      .forEach((edge) => {
        const targetOrder = visOrderByNodeId.get(edge.to);
        if (targetOrder === undefined) {
          return;
        }
        if (targetOrder <= judgeOrder) {
          issues.push(
            makeIssue(
              "error",
              `workflow.loops[${index}].exitWhen`,
              `exit edge target '${edge.to}' must appear after loop judge '${loop.judgeNodeId}' in vertical order`,
            ),
          );
        }
      });
  });

  for (let index = 0; index < loopIntervals.length; index += 1) {
    const current = loopIntervals[index];
    if (current === undefined) {
      continue;
    }
    for (
      let compareIndex = index + 1;
      compareIndex < loopIntervals.length;
      compareIndex += 1
    ) {
      const other = loopIntervals[compareIndex];
      if (other === undefined || current.id === other.id) {
        continue;
      }
      if (intervalsPartiallyOverlap(current, other)) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow.loops",
          leftId: current.id,
          leftStartOrder: current.startOrder,
          rightId: other.id,
          rightStartOrder: other.startOrder,
          messagePrefix: "vertical loop scopes",
        });
      }
    }
  }

  for (const groupInterval of subWorkflowIntervals) {
    for (const loopInterval of loopIntervals) {
      if (
        intervalsPartiallyOverlap(
          {
            startOrder: groupInterval.inputOrder,
            endOrder: groupInterval.outputOrder,
          },
          loopInterval,
        )
      ) {
        pushCrossingIntervalIssue(issues, bundle, {
          path: "workflow",
          leftId: groupInterval.id,
          leftStartOrder: groupInterval.inputOrder,
          rightId: loopInterval.id,
          rightStartOrder: loopInterval.startOrder,
          messagePrefix: "vertical group and loop scopes",
        });
      }
    }
  }

  if (
    bundle.workflow.defaults.maxLoopIterations === DEFAULT_MAX_LOOP_ITERATIONS
  ) {
    issues.push(
      makeIssue(
        "warning",
        "workflow.defaults.maxLoopIterations",
        "using default loop iteration value; consider explicit value per workflow",
      ),
    );
  }
}

export function validateWorkflowBundleDetailed(
  raw: RawBundle,
): Result<ValidationSuccessDetails, readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const nodePayloadsRaw = remapAuthoredNodePayloadsByNodeFile(
    raw.workflow,
    raw.nodePayloads,
  );

  const workflow = normalizeWorkflow(raw.workflow, issues);
  const workflowVis = normalizeWorkflowVis(raw.workflowVis, issues);

  const nodePayloads: Record<string, NodePayload> = {};
  if (workflow !== null) {
    workflow.nodes.forEach((node) => {
      const payloadRaw = nodePayloadsRaw[node.nodeFile];
      if (payloadRaw === undefined) {
        issues.push(
          makeIssue(
            "error",
            `nodePayloads.${node.nodeFile}`,
            "node payload file is missing",
          ),
        );
        return;
      }
      const payload = normalizeNodePayload(
        node.id,
        node.nodeFile,
        payloadRaw,
        issues,
      );
      if (payload !== null) {
        nodePayloads[node.id] = payload;
      }
    });
  }

  if (workflow === null || workflowVis === null) {
    return err(issues);
  }

  const bundle: NormalizedWorkflowBundle = {
    workflow,
    workflowVis,
    nodePayloads,
  };

  runSemanticValidation(bundle, issues);
  const allErrors = issues.filter((entry) => entry.severity === "error");
  if (allErrors.length > 0) {
    return err(issues);
  }

  return ok({ bundle, issues });
}

export function validateWorkflowBundle(raw: RawBundle): ValidationResult {
  const validation = validateWorkflowBundleDetailed(raw);
  if (!validation.ok) {
    return err(validation.error);
  }
  return ok(validation.value.bundle);
}
