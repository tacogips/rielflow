import type {
  AgentWorkerAddonConfig,
  CliAgentBackend,
  GitCommitAddonConfig,
  GitPushAddonConfig,
  MailGatewayAddonConfig,
  MailGatewayReadAddonConfig,
  NodeOutputContract,
  NodePayload,
  ResolvedNodeAddon,
  ValidationIssue,
  WorkflowNodeAddonRef,
  XGatewayAddonConfig,
  XGatewayReadAddonConfig,
} from "../types";
import {
  AGENT_WORKER_ADDON_VERSION,
  CLAUDE_CODE_WORKER_ADDON_NAME,
  CODEX_WORKER_ADDON_NAME,
  GIT_COMMIT_ADDON_NAME,
  GIT_COMMIT_ADDON_VERSION,
  GIT_COMMIT_OUTPUT,
  GIT_PUSH_ADDON_NAME,
  GIT_PUSH_ADDON_VERSION,
  GIT_PUSH_OUTPUT,
  MAIL_GATEWAY_ADDON_NAME,
  MAIL_GATEWAY_ADDON_VERSION,
  MAIL_GATEWAY_OUTPUT,
  MAIL_GATEWAY_READ_ADDON_NAME,
  MAIL_GATEWAY_READ_ADDON_VERSION,
  MAIL_GATEWAY_READ_OUTPUT,
  X_GATEWAY_ADDON_NAME,
  X_GATEWAY_ADDON_VERSION,
  X_GATEWAY_OUTPUT,
  X_GATEWAY_READ_ADDON_NAME,
  X_GATEWAY_READ_ADDON_VERSION,
  X_GATEWAY_READ_OUTPUT,
  isRecord,
  makeIssue,
  normalizeGatewayTemplateConfig,
  normalizeSessionPolicy,
  normalizeXGatewayConfig,
  normalizeXGatewayReadConfig,
  readOptionalStringConfig,
  readRequiredStringConfig,
} from "./addon-constants-and-agent-config";

export function normalizeMailGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "queryTemplate");
}
export function normalizeMailGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "documentTemplate");
}
export type GatewayConfigNormalizer<Config> = (
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
) => {
  readonly config?: Config;
  readonly issues: readonly ValidationIssue[];
};
export interface BuiltinGatewayAddonDescriptor<Config> {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly output: NodeOutputContract;
  readonly normalizeConfig: GatewayConfigNormalizer<Config>;
  readonly createResolvedAddon: (input: {
    readonly config: Config;
    readonly authoredAddon: WorkflowNodeAddonRef;
  }) => ResolvedNodeAddon;
}
export function validateGatewayAddonFields(
  addon: WorkflowNodeAddonRef,
  path: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (addon.config !== undefined && !isRecord(addon.config)) {
    issues.push(makeIssue(`${path}.config`, "must be an object"));
  }
  if (addon.inputs !== undefined && !isRecord(addon.inputs)) {
    issues.push(makeIssue(`${path}.inputs`, "must be an object"));
  }
  return issues;
}
export const X_GATEWAY_READ_DESCRIPTOR: BuiltinGatewayAddonDescriptor<XGatewayReadAddonConfig> =
  {
    name: X_GATEWAY_READ_ADDON_NAME,
    version: X_GATEWAY_READ_ADDON_VERSION,
    description:
      "Built-in worker that runs a read-only x-gateway query in a container.",
    output: X_GATEWAY_READ_OUTPUT,
    normalizeConfig: normalizeXGatewayReadConfig,
    createResolvedAddon: ({ config, authoredAddon }) => ({
      name: X_GATEWAY_READ_ADDON_NAME,
      version: X_GATEWAY_READ_ADDON_VERSION,
      config,
      ...(authoredAddon.env === undefined ? {} : { env: authoredAddon.env }),
      ...(authoredAddon.inputs === undefined
        ? {}
        : { inputs: authoredAddon.inputs }),
    }),
  };
export const X_GATEWAY_DESCRIPTOR: BuiltinGatewayAddonDescriptor<XGatewayAddonConfig> =
  {
    name: X_GATEWAY_ADDON_NAME,
    version: X_GATEWAY_ADDON_VERSION,
    description:
      "Built-in worker that runs an x-gateway query or mutation in a container.",
    output: X_GATEWAY_OUTPUT,
    normalizeConfig: normalizeXGatewayConfig,
    createResolvedAddon: ({ config, authoredAddon }) => ({
      name: X_GATEWAY_ADDON_NAME,
      version: X_GATEWAY_ADDON_VERSION,
      config,
      ...(authoredAddon.env === undefined ? {} : { env: authoredAddon.env }),
      ...(authoredAddon.inputs === undefined
        ? {}
        : { inputs: authoredAddon.inputs }),
    }),
  };
export const MAIL_GATEWAY_READ_DESCRIPTOR: BuiltinGatewayAddonDescriptor<MailGatewayReadAddonConfig> =
  {
    name: MAIL_GATEWAY_READ_ADDON_NAME,
    version: MAIL_GATEWAY_READ_ADDON_VERSION,
    description:
      "Built-in worker that runs a read-only mail-gateway query in a container.",
    output: MAIL_GATEWAY_READ_OUTPUT,
    normalizeConfig: normalizeMailGatewayReadConfig,
    createResolvedAddon: ({ config, authoredAddon }) => ({
      name: MAIL_GATEWAY_READ_ADDON_NAME,
      version: MAIL_GATEWAY_READ_ADDON_VERSION,
      config,
      ...(authoredAddon.env === undefined ? {} : { env: authoredAddon.env }),
      ...(authoredAddon.inputs === undefined
        ? {}
        : { inputs: authoredAddon.inputs }),
    }),
  };
export const MAIL_GATEWAY_DESCRIPTOR: BuiltinGatewayAddonDescriptor<MailGatewayAddonConfig> =
  {
    name: MAIL_GATEWAY_ADDON_NAME,
    version: MAIL_GATEWAY_ADDON_VERSION,
    description:
      "Built-in worker that runs a mail-gateway query or mutation in a container.",
    output: MAIL_GATEWAY_OUTPUT,
    normalizeConfig: normalizeMailGatewayConfig,
    createResolvedAddon: ({ config, authoredAddon }) => ({
      name: MAIL_GATEWAY_ADDON_NAME,
      version: MAIL_GATEWAY_ADDON_VERSION,
      config,
      ...(authoredAddon.env === undefined ? {} : { env: authoredAddon.env }),
      ...(authoredAddon.inputs === undefined
        ? {}
        : { inputs: authoredAddon.inputs }),
    }),
  };
export function normalizeGitCommitConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: GitCommitAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "commitMessageTemplate",
    "committedFilesTemplate",
    "gitPath",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const commitMessageTemplate = readRequiredStringConfig(
    config,
    "commitMessageTemplate",
    path,
    issues,
  );
  const committedFilesTemplate = readRequiredStringConfig(
    config,
    "committedFilesTemplate",
    path,
    issues,
  );
  const gitPath = readOptionalStringConfig(config, "gitPath", path, issues);

  if (
    issues.length > 0 ||
    commitMessageTemplate === undefined ||
    committedFilesTemplate === undefined
  ) {
    return { issues };
  }

  return {
    config: {
      commitMessageTemplate,
      committedFilesTemplate,
      ...(gitPath === undefined ? {} : { gitPath }),
    },
    issues,
  };
}
export function normalizeGitPushConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: GitPushAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set(["gitPath", "remoteTemplate", "branchTemplate"]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const gitPath = readOptionalStringConfig(config, "gitPath", path, issues);
  const remoteTemplate = readOptionalStringConfig(
    config,
    "remoteTemplate",
    path,
    issues,
  );
  const branchTemplate = readOptionalStringConfig(
    config,
    "branchTemplate",
    path,
    issues,
  );

  if (issues.length > 0) {
    return { issues };
  }

  return {
    config: {
      ...(gitPath === undefined ? {} : { gitPath }),
      ...(remoteTemplate === undefined ? {} : { remoteTemplate }),
      ...(branchTemplate === undefined ? {} : { branchTemplate }),
    },
    issues,
  };
}
export function validateGitAddonFields(
  addon: WorkflowNodeAddonRef,
  path: string,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (addon.config !== undefined && !isRecord(addon.config)) {
    issues.push(makeIssue(`${path}.config`, "must be an object"));
  }
  if (addon.inputs !== undefined && !isRecord(addon.inputs)) {
    issues.push(makeIssue(`${path}.inputs`, "must be an object"));
  }
  return issues;
}
export function normalizeAgentWorkerConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: AgentWorkerAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "model",
    "promptTemplate",
    "systemPromptTemplate",
    "sessionStartPromptTemplate",
    "sessionPolicy",
    "timeoutMs",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const model = readRequiredStringConfig(config, "model", path, issues);
  const promptTemplate = readRequiredStringConfig(
    config,
    "promptTemplate",
    path,
    issues,
  );
  const systemPromptTemplate = readOptionalStringConfig(
    config,
    "systemPromptTemplate",
    path,
    issues,
  );
  const sessionStartPromptTemplate = readOptionalStringConfig(
    config,
    "sessionStartPromptTemplate",
    path,
    issues,
  );
  const sessionPolicy = normalizeSessionPolicy(
    config["sessionPolicy"],
    `${path}.sessionPolicy`,
    issues,
  );

  const timeoutMsRaw = config["timeoutMs"];
  let timeoutMs: number | undefined;
  if (timeoutMsRaw !== undefined) {
    if (typeof timeoutMsRaw === "number" && timeoutMsRaw > 0) {
      timeoutMs = timeoutMsRaw;
    } else {
      issues.push(makeIssue(`${path}.timeoutMs`, "must be > 0 when provided"));
    }
  }

  if (
    issues.length > 0 ||
    model === undefined ||
    promptTemplate === undefined
  ) {
    return { issues };
  }

  return {
    config: {
      model,
      promptTemplate,
      ...(systemPromptTemplate === undefined ? {} : { systemPromptTemplate }),
      ...(sessionStartPromptTemplate === undefined
        ? {}
        : { sessionStartPromptTemplate }),
      ...(sessionPolicy === undefined ? {} : { sessionPolicy }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
    issues,
  };
}
export function rejectUnsupportedAddonEnv(
  addon: WorkflowNodeAddonRef,
  path: string,
): readonly ValidationIssue[] {
  if (addon.env === undefined) {
    return [];
  }
  return [
    makeIssue(
      `${path}.env`,
      `is not supported by ${addon.name} version ${addon.version ?? "1"}`,
    ),
  ];
}
export function isAgentWorkerAddonName(
  name: string,
): name is
  | typeof CODEX_WORKER_ADDON_NAME
  | typeof CLAUDE_CODE_WORKER_ADDON_NAME {
  return (
    name === CODEX_WORKER_ADDON_NAME || name === CLAUDE_CODE_WORKER_ADDON_NAME
  );
}
export function resolveAgentWorkerBackend(
  name: typeof CODEX_WORKER_ADDON_NAME | typeof CLAUDE_CODE_WORKER_ADDON_NAME,
): CliAgentBackend {
  switch (name) {
    case CODEX_WORKER_ADDON_NAME:
      return "codex-agent";
    case CLAUDE_CODE_WORKER_ADDON_NAME:
      return "claude-code-agent";
  }
}
export function resolveAgentWorkerPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (!isAgentWorkerAddonName(input.addon.name)) {
    return { issues: [] };
  }

  const version = input.addon.version ?? AGENT_WORKER_ADDON_VERSION;
  if (version !== AGENT_WORKER_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${input.addon.name}`,
        ),
      ],
    };
  }
  if (input.addon.config !== undefined && !isRecord(input.addon.config)) {
    return {
      issues: [makeIssue(`${input.path}.config`, "must be an object")],
    };
  }
  if (input.addon.inputs !== undefined && !isRecord(input.addon.inputs)) {
    return {
      issues: [makeIssue(`${input.path}.inputs`, "must be an object")],
    };
  }
  const unsupportedEnvIssues = rejectUnsupportedAddonEnv(
    input.addon,
    input.path,
  );
  if (unsupportedEnvIssues.length > 0) {
    return { issues: unsupportedEnvIssues };
  }

  const normalized = normalizeAgentWorkerConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: input.addon.name,
    version: AGENT_WORKER_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        input.addon.name === CODEX_WORKER_ADDON_NAME
          ? "Built-in worker that runs a Codex agent task."
          : "Built-in worker that runs a Claude Code agent task.",
      model: normalized.config.model,
      executionBackend: resolveAgentWorkerBackend(input.addon.name),
      promptTemplate: normalized.config.promptTemplate,
      ...(normalized.config.systemPromptTemplate === undefined
        ? {}
        : { systemPromptTemplate: normalized.config.systemPromptTemplate }),
      ...(normalized.config.sessionStartPromptTemplate === undefined
        ? {}
        : {
            sessionStartPromptTemplate:
              normalized.config.sessionStartPromptTemplate,
          }),
      ...(normalized.config.sessionPolicy === undefined
        ? {}
        : { sessionPolicy: normalized.config.sessionPolicy }),
      variables: input.addon.inputs ?? {},
      addon,
      ...(normalized.config.timeoutMs === undefined
        ? {}
        : { timeoutMs: normalized.config.timeoutMs }),
    },
    issues: [],
  };
}
export function resolveGatewayPayload<Config>(
  input: {
    readonly nodeId: string;
    readonly addon: WorkflowNodeAddonRef;
    readonly path: string;
  },
  descriptor: BuiltinGatewayAddonDescriptor<Config>,
): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== descriptor.name) {
    return { issues: [] };
  }

  const version = input.addon.version ?? descriptor.version;
  if (version !== descriptor.version) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${descriptor.name}`,
        ),
      ],
    };
  }

  const fieldIssues = validateGatewayAddonFields(input.addon, input.path);
  if (fieldIssues.length > 0) {
    return { issues: fieldIssues };
  }

  const normalized = descriptor.normalizeConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  return {
    payload: {
      id: input.nodeId,
      description: descriptor.description,
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon: descriptor.createResolvedAddon({
        config: normalized.config,
        authoredAddon: input.addon,
      }),
      output: descriptor.output,
    },
    issues: [],
  };
}
export function resolveXGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, X_GATEWAY_READ_DESCRIPTOR);
}
export function resolveXGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, X_GATEWAY_DESCRIPTOR);
}
export function resolveMailGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, MAIL_GATEWAY_READ_DESCRIPTOR);
}
export function resolveMailGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, MAIL_GATEWAY_DESCRIPTOR);
}
export function resolveGitCommitPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== GIT_COMMIT_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? GIT_COMMIT_ADDON_VERSION;
  if (version !== GIT_COMMIT_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${GIT_COMMIT_ADDON_NAME}`,
        ),
      ],
    };
  }

  const fieldIssues = validateGitAddonFields(input.addon, input.path);
  if (fieldIssues.length > 0) {
    return { issues: fieldIssues };
  }
  const unsupportedEnvIssues = rejectUnsupportedAddonEnv(
    input.addon,
    input.path,
  );
  if (unsupportedEnvIssues.length > 0) {
    return { issues: unsupportedEnvIssues };
  }

  const normalized = normalizeGitCommitConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that stages explicit file paths and creates one git commit.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon: {
        name: GIT_COMMIT_ADDON_NAME,
        version: GIT_COMMIT_ADDON_VERSION,
        config: normalized.config,
        ...(input.addon.inputs === undefined
          ? {}
          : { inputs: input.addon.inputs }),
      },
      output: GIT_COMMIT_OUTPUT,
    },
    issues: [],
  };
}
export function resolveGitPushPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== GIT_PUSH_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? GIT_PUSH_ADDON_VERSION;
  if (version !== GIT_PUSH_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${GIT_PUSH_ADDON_NAME}`,
        ),
      ],
    };
  }

  const fieldIssues = validateGitAddonFields(input.addon, input.path);
  if (fieldIssues.length > 0) {
    return { issues: fieldIssues };
  }
  const unsupportedEnvIssues = rejectUnsupportedAddonEnv(
    input.addon,
    input.path,
  );
  if (unsupportedEnvIssues.length > 0) {
    return { issues: unsupportedEnvIssues };
  }

  const normalized = normalizeGitPushConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that pushes HEAD to an explicit or current git branch.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon: {
        name: GIT_PUSH_ADDON_NAME,
        version: GIT_PUSH_ADDON_VERSION,
        config: normalized.config,
        ...(input.addon.inputs === undefined
          ? {}
          : { inputs: input.addon.inputs }),
      },
      output: GIT_PUSH_OUTPUT,
    },
    issues: [],
  };
}
