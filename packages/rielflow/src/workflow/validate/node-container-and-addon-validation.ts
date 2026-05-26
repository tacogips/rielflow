import type {
  ContainerExecution,
  ContainerRunnerKind,
  NodeDurability,
  NodeKind,
  ValidationIssue,
  WorkflowNodeAddonEnvBinding,
  WorkflowNodeAddonRef,
  WorkflowNodeRepeatPolicy,
  WorkflowTimeoutPolicy,
} from "../types";
import {
  isAbsoluteContainerPath,
  isContainerRunnerKind,
  isRecord,
  makeIssue,
  normalizeContainerBuild,
  normalizeStringArrayField,
  normalizeStringMapField,
  readStringField,
} from "./validation-types-and-runtime-options";

export function normalizeContainerExecution(
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
export function normalizeNodeDurability(
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
export const ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function isValidEnvVarName(value: string): boolean {
  return ENV_VAR_NAME_PATTERN.test(value);
}
export function normalizeWorkflowNodeAddonEnvBinding(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonEnvBinding | undefined {
  if (typeof value === "string") {
    if (value.length === 0 || !isValidEnvVarName(value)) {
      issues.push(
        makeIssue("error", path, "must be a valid environment variable name"),
      );
      return undefined;
    }
    return { fromEnv: value };
  }

  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }

  const allowedKeys = new Set(["fromEnv", "required"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue("error", `${path}.${key}`, "is not supported"));
    }
  }

  const fromEnv = value["fromEnv"];
  if (typeof fromEnv !== "string" || !isValidEnvVarName(fromEnv)) {
    issues.push(
      makeIssue(
        "error",
        `${path}.fromEnv`,
        "must be a valid environment variable name",
      ),
    );
    return undefined;
  }

  const required = value["required"];
  if (required !== undefined && typeof required !== "boolean") {
    issues.push(makeIssue("error", `${path}.required`, "must be a boolean"));
  }

  return {
    fromEnv,
    ...(typeof required === "boolean" ? { required } : {}),
  };
}
export function normalizeWorkflowNodeAddonEnv(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): Readonly<Record<string, WorkflowNodeAddonEnvBinding>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const bindings: Record<string, WorkflowNodeAddonEnvBinding> = {};
  for (const [targetEnv, bindingValue] of Object.entries(value)) {
    if (!isValidEnvVarName(targetEnv)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${targetEnv}`,
          "target must be a valid environment variable name",
        ),
      );
      continue;
    }
    const binding = normalizeWorkflowNodeAddonEnvBinding(
      bindingValue,
      `${path}.${targetEnv}`,
      issues,
    );
    if (binding !== undefined) {
      bindings[targetEnv] = binding;
    }
  }
  return bindings;
}
export function normalizeWorkflowNodeAddonRef(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowNodeAddonRef | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    if (value.length === 0) {
      issues.push(makeIssue("error", path, "must be a non-empty string"));
      return undefined;
    }
    return { name: value };
  }

  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be a string or object"));
    return undefined;
  }

  const allowedKeys = new Set(["name", "version", "config", "env", "inputs"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue("error", `${path}.${key}`, "is not supported"));
    }
  }

  const name = readStringField(value, "name", path, issues);
  const versionRaw = value["version"];
  let version: string | undefined;
  if (versionRaw !== undefined) {
    if (typeof versionRaw === "string" && versionRaw.length > 0) {
      version = versionRaw;
    } else {
      issues.push(
        makeIssue("error", `${path}.version`, "must be a non-empty string"),
      );
    }
  }

  const configRaw = value["config"];
  if (configRaw !== undefined && !isRecord(configRaw)) {
    issues.push(makeIssue("error", `${path}.config`, "must be an object"));
  }
  const env = normalizeWorkflowNodeAddonEnv(
    value["env"],
    `${path}.env`,
    issues,
  );
  const inputsRaw = value["inputs"];
  if (inputsRaw !== undefined && !isRecord(inputsRaw)) {
    issues.push(makeIssue("error", `${path}.inputs`, "must be an object"));
  }

  if (name === null) {
    return undefined;
  }

  return {
    name,
    ...(version === undefined ? {} : { version }),
    ...(isRecord(configRaw) ? { config: configRaw } : {}),
    ...(env === undefined ? {} : { env }),
    ...(isRecord(inputsRaw) ? { inputs: inputsRaw } : {}),
  };
}
export function normalizeWorkflowTimeoutPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkflowTimeoutPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object when provided"));
    return undefined;
  }

  const onTimeout = value["onTimeout"];
  if (
    onTimeout !== "fail" &&
    onTimeout !== "retry-same-step" &&
    onTimeout !== "jump-to-step"
  ) {
    issues.push(
      makeIssue(
        "error",
        `${path}.onTimeout`,
        "must be 'fail', 'retry-same-step', or 'jump-to-step'",
      ),
    );
    return undefined;
  }

  const maxRetriesRaw = value["maxRetries"];
  let maxRetries: number | undefined;
  if (maxRetriesRaw !== undefined) {
    if (
      typeof maxRetriesRaw === "number" &&
      Number.isInteger(maxRetriesRaw) &&
      maxRetriesRaw >= 0
    ) {
      maxRetries = maxRetriesRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxRetries`,
          "must be an integer >= 0 when provided",
        ),
      );
    }
  }

  const retryTimeoutIncrementMsRaw = value["retryTimeoutIncrementMs"];
  let retryTimeoutIncrementMs: number | undefined;
  if (retryTimeoutIncrementMsRaw !== undefined) {
    if (
      typeof retryTimeoutIncrementMsRaw === "number" &&
      Number.isFinite(retryTimeoutIncrementMsRaw) &&
      retryTimeoutIncrementMsRaw >= 0
    ) {
      retryTimeoutIncrementMs = retryTimeoutIncrementMsRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.retryTimeoutIncrementMs`,
          "must be >= 0 when provided",
        ),
      );
    }
  }

  const jumpStepIdRaw = value["jumpStepId"];
  let jumpStepId: string | undefined;
  if (jumpStepIdRaw !== undefined) {
    if (typeof jumpStepIdRaw === "string" && jumpStepIdRaw.length > 0) {
      jumpStepId = jumpStepIdRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.jumpStepId`,
          "must be a non-empty string when provided",
        ),
      );
    }
  }

  const reuseBackendSessionRaw = value["reuseBackendSession"];
  let reuseBackendSession: boolean | undefined;
  if (reuseBackendSessionRaw !== undefined) {
    if (typeof reuseBackendSessionRaw === "boolean") {
      reuseBackendSession = reuseBackendSessionRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.reuseBackendSession`,
          "must be a boolean when provided",
        ),
      );
    }
  }

  if (onTimeout === "jump-to-step" && jumpStepId === undefined) {
    issues.push(
      makeIssue(
        "error",
        `${path}.jumpStepId`,
        "is required when onTimeout is 'jump-to-step'",
      ),
    );
  }

  return {
    onTimeout,
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retryTimeoutIncrementMs === undefined
      ? {}
      : { retryTimeoutIncrementMs }),
    ...(jumpStepId === undefined ? {} : { jumpStepId }),
    ...(reuseBackendSession === undefined ? {} : { reuseBackendSession }),
  };
}
export const NODE_KIND_VALUES = new Set<NodeKind>([
  "task",
  "branch-judge",
  "loop-judge",
  "input",
  "output",
]);
export function normalizeRegistryNodeKind(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): NodeKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !NODE_KIND_VALUES.has(value as NodeKind)) {
    issues.push(
      makeIssue(
        "error",
        path,
        "must be 'task', 'branch-judge', 'loop-judge', 'input', or 'output'",
      ),
    );
    return undefined;
  }
  return value as NodeKind;
}
export function normalizeWorkflowNodeRepeatPolicy(
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
  const whileRaw = value["while"];
  if (typeof whileRaw !== "string" || whileRaw.length === 0) {
    issues.push(
      makeIssue("error", `${path}.while`, "must be a non-empty string"),
    );
    return undefined;
  }
  const restartAtRaw = value["restartAt"];
  const maxIterationsRaw = value["maxIterations"];
  let restartAt: string | undefined;
  if (restartAtRaw !== undefined) {
    if (typeof restartAtRaw !== "string" || restartAtRaw.length === 0) {
      issues.push(
        makeIssue("error", `${path}.restartAt`, "must be a non-empty string"),
      );
    } else {
      restartAt = restartAtRaw;
    }
  }
  let maxIterations: number | undefined;
  if (maxIterationsRaw !== undefined) {
    if (
      typeof maxIterationsRaw !== "number" ||
      !Number.isInteger(maxIterationsRaw) ||
      maxIterationsRaw < 1
    ) {
      issues.push(
        makeIssue(
          "error",
          `${path}.maxIterations`,
          "must be a positive integer when provided",
        ),
      );
    } else {
      maxIterations = maxIterationsRaw;
    }
  }
  return {
    while: whileRaw,
    ...(restartAt === undefined ? {} : { restartAt }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
  };
}
