import {
  describeSuperviserControlAddon,
  isSuperviserControlAddonName,
} from "./types";
import type {
  AgentWorkerAddonConfig,
  CliAgentBackend,
  ChatReplyWorkerConfig,
  GitCommitAddonConfig,
  GitPushAddonConfig,
  MailGatewayAddonConfig,
  MailGatewayReadAddonConfig,
  AsyncNodeAddonPayloadResolver,
  LoadOptions,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  NodeOutputContract,
  NodePayload,
  ResolvedNodeAddon,
  ResolvedSuperviserControlAddon,
  ResolvedWorkflowSource,
  SuperviserControlAddonName,
  ValidationIssue,
  WorkflowNodeAddonRef,
  XGatewayAddonConfig,
  XGatewayReadAddonConfig,
} from "./types";
import { resolveAddonSource } from "./catalog";
import { resolveLocalNodeAddonPayload } from "./local-node-addons";

export const CHAT_REPLY_WORKER_ADDON_NAME = "divedra/chat-reply-worker";
export const CHAT_REPLY_WORKER_ADDON_VERSION = "1";
export const CODEX_WORKER_ADDON_NAME = "divedra/codex-worker";
export const CLAUDE_CODE_WORKER_ADDON_NAME = "divedra/claude-code-worker";
export const AGENT_WORKER_ADDON_VERSION = "1";
export const X_GATEWAY_ADDON_NAME = "divedra/x-gateway";
export const X_GATEWAY_ADDON_VERSION = "1";
export const X_GATEWAY_READ_ADDON_NAME = "divedra/x-gateway-read";
export const X_GATEWAY_READ_ADDON_VERSION = "1";
export const DEFAULT_X_GATEWAY_IMAGE = "ghcr.io/tacogips/x-gateway:latest";
export const MAIL_GATEWAY_ADDON_NAME = "divedra/mail-gateway";
export const MAIL_GATEWAY_ADDON_VERSION = "1";
export const MAIL_GATEWAY_READ_ADDON_NAME = "divedra/mail-gateway-read";
export const MAIL_GATEWAY_READ_ADDON_VERSION = "1";
export const DEFAULT_MAIL_GATEWAY_IMAGE =
  "ghcr.io/tacogips/mail-gateway:latest";
export const GIT_COMMIT_ADDON_NAME = "divedra/git-commit";
export const GIT_COMMIT_ADDON_VERSION = "1";
export const GIT_PUSH_ADDON_NAME = "divedra/git-push";
export const GIT_PUSH_ADDON_VERSION = "1";
export const SUPERVISER_CONTROL_ADDON_VERSION = "1";

const CHAT_REPLY_WORKER_OUTPUT: NodeOutputContract = {
  description:
    "Provider-neutral chat reply request produced by the built-in chat reply worker.",
  jsonSchema: {
    type: "object",
    required: ["reply"],
    additionalProperties: true,
    properties: {
      reply: {
        type: "object",
        required: ["status", "target", "message", "idempotencyKey"],
        additionalProperties: true,
        properties: {
          status: {
            enum: ["sent", "queued", "intent-only", "dry-run"],
          },
          target: {
            type: "object",
            additionalProperties: true,
          },
          message: {
            type: "object",
            required: ["text"],
            additionalProperties: false,
            properties: {
              text: { type: "string", minLength: 1 },
            },
          },
          idempotencyKey: { type: "string", minLength: 1 },
          providerMessageId: { type: "string", minLength: 1 },
          dispatchId: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

const X_GATEWAY_READ_OUTPUT: NodeOutputContract = {
  description:
    "Read-only x-gateway query result produced by the built-in x-gateway read add-on.",
  jsonSchema: {
    type: "object",
    required: ["xGateway"],
    additionalProperties: true,
    properties: {
      xGateway: {
        type: "object",
        required: ["ok"],
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          data: {},
        },
      },
    },
  },
};

const X_GATEWAY_OUTPUT: NodeOutputContract = {
  description:
    "x-gateway query or mutation result produced by the built-in x-gateway add-on.",
  jsonSchema: {
    type: "object",
    required: ["xGateway"],
    additionalProperties: true,
    properties: {
      xGateway: {
        type: "object",
        required: ["ok"],
        additionalProperties: true,
        properties: {
          ok: { type: "boolean" },
          data: {},
        },
      },
    },
  },
};

const MAIL_GATEWAY_READ_OUTPUT: NodeOutputContract = {
  description:
    "Read-only mail-gateway query result produced by the built-in mail-gateway read add-on.",
  jsonSchema: {
    type: "object",
    required: ["mailGateway"],
    additionalProperties: true,
    properties: {
      mailGateway: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};

const MAIL_GATEWAY_OUTPUT: NodeOutputContract = {
  description:
    "mail-gateway query or mutation result produced by the built-in mail-gateway add-on.",
  jsonSchema: {
    type: "object",
    required: ["mailGateway"],
    additionalProperties: true,
    properties: {
      mailGateway: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};

const GIT_COMMIT_OUTPUT: NodeOutputContract = {
  description:
    "Git commit result produced by the built-in git commit add-on.",
  jsonSchema: {
    type: "object",
    required: ["git"],
    additionalProperties: true,
    properties: {
      git: {
        type: "object",
        required: ["status", "commitHash", "committedFiles"],
        additionalProperties: true,
        properties: {
          status: { enum: ["committed"] },
          commitHash: { type: "string", minLength: 1 },
          committedFiles: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

const GIT_PUSH_OUTPUT: NodeOutputContract = {
  description:
    "Git push result produced by the built-in git push add-on.",
  jsonSchema: {
    type: "object",
    required: ["git"],
    additionalProperties: true,
    properties: {
      git: {
        type: "object",
        required: ["status", "commitHash", "pushedRemote", "pushedBranch"],
        additionalProperties: true,
        properties: {
          status: { enum: ["pushed"] },
          commitHash: { type: "string", minLength: 1 },
          pushedRemote: { type: "string", minLength: 1 },
          pushedBranch: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

const SUPERVISER_CONTROL_ADDON_OUTPUT: NodeOutputContract = {
  description:
    "Nested superviser control-plane result (start/status/rerun/load/save) scoped to a supervision run (phase-2 auto-improve).",
  jsonSchema: {
    type: "object",
    required: ["superviser"],
    additionalProperties: true,
    properties: {
      superviser: {
        type: "object",
        additionalProperties: true,
      },
    },
  },
};

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function errorMessageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidationIssue(value: unknown): value is ValidationIssue {
  if (!isRecord(value)) {
    return false;
  }
  const severity = value["severity"];
  return (
    (severity === "error" || severity === "warning") &&
    typeof value["path"] === "string" &&
    typeof value["message"] === "string"
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function normalizeThirdPartyResolverResult(input: {
  readonly addonName: string;
  readonly path: string;
  readonly value: unknown;
}): NodeAddonResolveResult {
  if (input.value === undefined) {
    return { issues: [] };
  }
  if (!isRecord(input.value)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult`,
          `third-party node add-on resolver for '${input.addonName}' must return an object result`,
        ),
      ],
    };
  }

  const issuesRaw = input.value["issues"] ?? [];
  if (!Array.isArray(issuesRaw)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.issues`,
          `third-party node add-on resolver for '${input.addonName}' must return issues as an array`,
        ),
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  for (const [index, issue] of issuesRaw.entries()) {
    if (isValidationIssue(issue)) {
      issues.push(issue);
      continue;
    }
    return {
      issues: [
        makeIssue(
          `${input.path}.resolverResult.issues[${index}]`,
          "must contain validation issues with severity, path, and message",
        ),
      ],
    };
  }

  const payload = input.value["payload"];
  return {
    issues,
    ...(payload === undefined ? {} : { payload: payload as NodePayload }),
  };
}

function definitionVersionMatches(
  definition: NodeAddonDefinition,
  addon: WorkflowNodeAddonRef,
): boolean {
  return (
    definition.version === undefined ||
    addon.version === undefined ||
    definition.version === addon.version
  );
}

function describeAddonDefinitionVersions(
  definitions: readonly NodeAddonDefinition[],
): string {
  return definitions
    .map((definition) => definition.version ?? "<unspecified>")
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
}

export function createNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): NodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return (input) => {
    const matchingNameDefinitions = registeredDefinitions.filter(
      (definition) => definition.name === input.addon.name,
    );
    if (matchingNameDefinitions.length === 0) {
      return undefined;
    }

    const matchingDefinitions = matchingNameDefinitions.filter((definition) =>
      definitionVersionMatches(definition, input.addon),
    );
    if (matchingDefinitions.length === 0) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `unsupported version '${input.addon.version ?? "<unspecified>"}' for third-party node add-on '${input.addon.name}'; registered versions: ${describeAddonDefinitionVersions(matchingNameDefinitions)}`,
          ),
        ],
      };
    }

    if (input.addon.version === undefined && matchingDefinitions.length > 1) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `must be specified because multiple versions are registered for third-party node add-on '${input.addon.name}': ${describeAddonDefinitionVersions(matchingDefinitions)}`,
          ),
        ],
      };
    }

    const [definition] = matchingDefinitions;
    if (definition === undefined) {
      return undefined;
    }
    const resolved = definition.resolve(input);
    if (isPromiseLike(resolved)) {
      void Promise.resolve(resolved).catch(() => undefined);
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on '${input.addon.name}' uses an async definition resolver; use loadWorkflowFromDisk or validateWorkflowBundleAsync for async add-ons`,
          ),
        ],
      };
    }
    return resolved;
  };
}

export function createNodeAddonPayloadResolver(
  definition: NodeAddonDefinition,
): NodeAddonPayloadResolver {
  return createNodeAddonRegistry([definition]);
}

export function createAsyncNodeAddonRegistry(
  definitions: readonly NodeAddonDefinition[],
): AsyncNodeAddonPayloadResolver {
  const registeredDefinitions = [...definitions];
  return async (input) => {
    const matchingNameDefinitions = registeredDefinitions.filter(
      (definition) => definition.name === input.addon.name,
    );
    if (matchingNameDefinitions.length === 0) {
      return undefined;
    }

    const matchingDefinitions = matchingNameDefinitions.filter((definition) =>
      definitionVersionMatches(definition, input.addon),
    );
    if (matchingDefinitions.length === 0) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `unsupported version '${input.addon.version ?? "<unspecified>"}' for third-party node add-on '${input.addon.name}'; registered versions: ${describeAddonDefinitionVersions(matchingNameDefinitions)}`,
          ),
        ],
      };
    }

    if (input.addon.version === undefined && matchingDefinitions.length > 1) {
      return {
        issues: [
          makeIssue(
            `${input.path}.version`,
            `must be specified because multiple versions are registered for third-party node add-on '${input.addon.name}': ${describeAddonDefinitionVersions(matchingDefinitions)}`,
          ),
        ],
      };
    }

    const [definition] = matchingDefinitions;
    return definition === undefined
      ? undefined
      : await definition.resolve(input);
  };
}

export function createAsyncNodeAddonPayloadResolver(
  definition: NodeAddonDefinition,
): AsyncNodeAddonPayloadResolver {
  return createAsyncNodeAddonRegistry([definition]);
}

function normalizeChatReplyWorkerConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: ChatReplyWorkerConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "textTemplate",
    "visibility",
    "threadPolicy",
    "onMissingTarget",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const textTemplate = config["textTemplate"];
  if (typeof textTemplate !== "string" || textTemplate.trim().length === 0) {
    issues.push(
      makeIssue(`${path}.textTemplate`, "must be a non-empty string"),
    );
  }

  const visibility = config["visibility"];
  if (
    visibility !== undefined &&
    visibility !== "public" &&
    visibility !== "ephemeral"
  ) {
    issues.push(
      makeIssue(`${path}.visibility`, "must be 'public' or 'ephemeral'"),
    );
  }

  const threadPolicy = config["threadPolicy"];
  if (
    threadPolicy !== undefined &&
    threadPolicy !== "same-thread" &&
    threadPolicy !== "conversation-root"
  ) {
    issues.push(
      makeIssue(
        `${path}.threadPolicy`,
        "must be 'same-thread' or 'conversation-root'",
      ),
    );
  }

  const onMissingTarget = config["onMissingTarget"];
  if (
    onMissingTarget !== undefined &&
    onMissingTarget !== "fail" &&
    onMissingTarget !== "intent-only" &&
    onMissingTarget !== "dry-run"
  ) {
    issues.push(
      makeIssue(
        `${path}.onMissingTarget`,
        "must be 'fail', 'intent-only', or 'dry-run'",
      ),
    );
  }

  if (issues.length > 0 || typeof textTemplate !== "string") {
    return { issues };
  }
  const normalizedVisibility =
    visibility === "public" || visibility === "ephemeral"
      ? visibility
      : undefined;
  const normalizedThreadPolicy =
    threadPolicy === "same-thread" || threadPolicy === "conversation-root"
      ? threadPolicy
      : undefined;
  const normalizedOnMissingTarget =
    onMissingTarget === "fail" ||
    onMissingTarget === "intent-only" ||
    onMissingTarget === "dry-run"
      ? onMissingTarget
      : undefined;

  return {
    config: {
      textTemplate,
      ...(normalizedVisibility === undefined
        ? {}
        : { visibility: normalizedVisibility }),
      ...(normalizedThreadPolicy === undefined
        ? {}
        : { threadPolicy: normalizedThreadPolicy }),
      ...(normalizedOnMissingTarget === undefined
        ? {}
        : { onMissingTarget: normalizedOnMissingTarget }),
    },
    issues,
  };
}

function normalizeSessionPolicy(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): AgentWorkerAddonConfig["sessionPolicy"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue(path, "must be an object when provided"));
    return undefined;
  }
  const mode = value["mode"];
  if (mode !== "new" && mode !== "reuse") {
    issues.push(makeIssue(`${path}.mode`, "must be 'new' or 'reuse'"));
    return undefined;
  }
  return { mode };
}

function readOptionalStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = config[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  return undefined;
}

function readRequiredStringConfig(
  config: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  const value = readOptionalStringConfig(config, key, path, issues);
  if (value === undefined && config[key] === undefined) {
    issues.push(makeIssue(`${path}.${key}`, "must be a non-empty string"));
  }
  return value;
}

type GatewayTemplateKey = "queryTemplate" | "documentTemplate";

interface GatewayContainerConfigFields {
  readonly image?: string;
  readonly runnerKind?: "podman" | "docker" | "nerdctl";
  readonly runnerPath?: string;
  readonly networkPolicy?: "disabled" | "egress-allowed";
}

interface QueryGatewayConfig extends GatewayContainerConfigFields {
  readonly queryTemplate: string;
}

interface DocumentGatewayConfig extends GatewayContainerConfigFields {
  readonly documentTemplate: string;
}

function buildGatewayContainerConfig(
  input: GatewayContainerConfigFields,
): GatewayContainerConfigFields {
  return {
    ...(input.image === undefined ? {} : { image: input.image }),
    ...(input.runnerKind === undefined ? {} : { runnerKind: input.runnerKind }),
    ...(input.runnerPath === undefined ? {} : { runnerPath: input.runnerPath }),
    ...(input.networkPolicy === undefined
      ? {}
      : { networkPolicy: input.networkPolicy }),
  };
}

function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: "queryTemplate",
): {
  readonly config?: QueryGatewayConfig;
  readonly issues: readonly ValidationIssue[];
};
function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: "documentTemplate",
): {
  readonly config?: DocumentGatewayConfig;
  readonly issues: readonly ValidationIssue[];
};
function normalizeGatewayTemplateConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
  templateKey: GatewayTemplateKey,
): {
  readonly config?: QueryGatewayConfig | DocumentGatewayConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    templateKey,
    "image",
    "runnerKind",
    "runnerPath",
    "networkPolicy",
  ]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const template = readRequiredStringConfig(config, templateKey, path, issues);
  const image = readOptionalStringConfig(config, "image", path, issues);
  const runnerPath = readOptionalStringConfig(
    config,
    "runnerPath",
    path,
    issues,
  );

  const runnerKindRaw = config["runnerKind"];
  let runnerKind: XGatewayReadAddonConfig["runnerKind"];
  if (runnerKindRaw !== undefined) {
    if (
      runnerKindRaw === "podman" ||
      runnerKindRaw === "docker" ||
      runnerKindRaw === "nerdctl"
    ) {
      runnerKind = runnerKindRaw;
    } else {
      issues.push(
        makeIssue(
          `${path}.runnerKind`,
          "must be 'podman', 'docker', or 'nerdctl'",
        ),
      );
    }
  }

  const networkPolicyRaw = config["networkPolicy"];
  let networkPolicy: XGatewayReadAddonConfig["networkPolicy"];
  if (networkPolicyRaw !== undefined) {
    if (
      networkPolicyRaw === "disabled" ||
      networkPolicyRaw === "egress-allowed"
    ) {
      networkPolicy = networkPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          `${path}.networkPolicy`,
          "must be 'disabled' or 'egress-allowed'",
        ),
      );
    }
  }

  if (issues.length > 0 || template === undefined) {
    return { issues };
  }

  const containerConfig = buildGatewayContainerConfig({
    ...(image === undefined ? {} : { image }),
    ...(runnerKind === undefined ? {} : { runnerKind }),
    ...(runnerPath === undefined ? {} : { runnerPath }),
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
  });

  if (templateKey === "queryTemplate") {
    return {
      config: {
        queryTemplate: template,
        ...containerConfig,
      },
      issues,
    };
  }

  return {
    config: {
      documentTemplate: template,
      ...containerConfig,
    },
    issues,
  };
}

function normalizeXGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "queryTemplate");
}

function normalizeXGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "documentTemplate");
}

function normalizeMailGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "queryTemplate");
}

function normalizeMailGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  return normalizeGatewayTemplateConfig(value, path, "documentTemplate");
}

type GatewayConfigNormalizer<Config> = (
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
) => {
  readonly config?: Config;
  readonly issues: readonly ValidationIssue[];
};

interface BuiltinGatewayAddonDescriptor<Config> {
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

function validateGatewayAddonFields(
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

const X_GATEWAY_READ_DESCRIPTOR: BuiltinGatewayAddonDescriptor<XGatewayReadAddonConfig> =
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

const X_GATEWAY_DESCRIPTOR: BuiltinGatewayAddonDescriptor<XGatewayAddonConfig> =
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

const MAIL_GATEWAY_READ_DESCRIPTOR: BuiltinGatewayAddonDescriptor<MailGatewayReadAddonConfig> =
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

const MAIL_GATEWAY_DESCRIPTOR: BuiltinGatewayAddonDescriptor<MailGatewayAddonConfig> =
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

function normalizeGitCommitConfig(
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

function normalizeGitPushConfig(
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

  const gitPath = readOptionalStringConfig(
    config,
    "gitPath",
    path,
    issues,
  );
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

function validateGitAddonFields(
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

function normalizeAgentWorkerConfig(
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

function rejectUnsupportedAddonEnv(
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

function isAgentWorkerAddonName(
  name: string,
): name is
  | typeof CODEX_WORKER_ADDON_NAME
  | typeof CLAUDE_CODE_WORKER_ADDON_NAME {
  return (
    name === CODEX_WORKER_ADDON_NAME || name === CLAUDE_CODE_WORKER_ADDON_NAME
  );
}

function resolveAgentWorkerBackend(
  name: typeof CODEX_WORKER_ADDON_NAME | typeof CLAUDE_CODE_WORKER_ADDON_NAME,
): CliAgentBackend {
  switch (name) {
    case CODEX_WORKER_ADDON_NAME:
      return "codex-agent";
    case CLAUDE_CODE_WORKER_ADDON_NAME:
      return "claude-code-agent";
  }
}

function resolveAgentWorkerPayload(input: {
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

function resolveGatewayPayload<Config>(
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

function resolveXGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, X_GATEWAY_READ_DESCRIPTOR);
}

function resolveXGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, X_GATEWAY_DESCRIPTOR);
}

function resolveMailGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, MAIL_GATEWAY_READ_DESCRIPTOR);
}

function resolveMailGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  return resolveGatewayPayload(input, MAIL_GATEWAY_DESCRIPTOR);
}

function resolveGitCommitPayload(input: {
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

function resolveGitPushPayload(input: {
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

function resolveSuperviserControlPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (!isSuperviserControlAddonName(input.addon.name)) {
    return { issues: [] };
  }
  const name: SuperviserControlAddonName = input.addon.name;
  const version = input.addon.version ?? SUPERVISER_CONTROL_ADDON_VERSION;
  if (version !== SUPERVISER_CONTROL_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${name}`,
        ),
      ],
    };
  }
  let argumentsTemplate: Readonly<Record<string, unknown>> | undefined;
  let argumentBindings: NodePayload["argumentBindings"];
  const cfg = input.addon.config;
  if (cfg !== undefined) {
    if (!isRecord(cfg)) {
      return {
        issues: [makeIssue(`${input.path}.config`, "must be an object")],
      };
    }
    const allowed = new Set(["argumentsTemplate", "argumentBindings"]);
    for (const key of Object.keys(cfg)) {
      if (!allowed.has(key)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.${key}`,
              "only argumentsTemplate and argumentBindings are allowed for divedra superviser control add-ons",
            ),
          ],
        };
      }
    }
    const at = cfg["argumentsTemplate"];
    if (at !== undefined) {
      if (!isRecord(at)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.argumentsTemplate`,
              "must be an object",
            ),
          ],
        };
      }
      argumentsTemplate = at;
    }
    const ab = cfg["argumentBindings"];
    if (ab !== undefined) {
      if (!Array.isArray(ab)) {
        return {
          issues: [
            makeIssue(
              `${input.path}.config.argumentBindings`,
              "must be an array",
            ),
          ],
        };
      }
      argumentBindings = ab as NodePayload["argumentBindings"];
    }
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
  const addon: ResolvedSuperviserControlAddon = {
    name,
    version: SUPERVISER_CONTROL_ADDON_VERSION,
  };
  return {
    payload: {
      id: input.nodeId,
      description: describeSuperviserControlAddon(name),
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: SUPERVISER_CONTROL_ADDON_OUTPUT,
      ...(argumentsTemplate === undefined ? {} : { argumentsTemplate }),
      ...(argumentBindings === undefined ? {} : { argumentBindings }),
    },
    issues: [],
  };
}

export function resolveBuiltinNodeAddonPayload(
  input: NodeAddonResolveInput,
): NodeAddonResolveResult {
  const version = input.addon.version ?? CHAT_REPLY_WORKER_ADDON_VERSION;
  const superviserControlPayload = resolveSuperviserControlPayload(input);
  if (
    superviserControlPayload.payload !== undefined ||
    superviserControlPayload.issues.length > 0
  ) {
    return superviserControlPayload;
  }
  const agentWorkerPayload = resolveAgentWorkerPayload(input);
  if (
    agentWorkerPayload.payload !== undefined ||
    agentWorkerPayload.issues.length > 0
  ) {
    return agentWorkerPayload;
  }
  const xGatewayReadPayload = resolveXGatewayReadPayload(input);
  if (
    xGatewayReadPayload.payload !== undefined ||
    xGatewayReadPayload.issues.length > 0
  ) {
    return xGatewayReadPayload;
  }
  const xGatewayPayload = resolveXGatewayPayload(input);
  if (
    xGatewayPayload.payload !== undefined ||
    xGatewayPayload.issues.length > 0
  ) {
    return xGatewayPayload;
  }
  const mailGatewayReadPayload = resolveMailGatewayReadPayload(input);
  if (
    mailGatewayReadPayload.payload !== undefined ||
    mailGatewayReadPayload.issues.length > 0
  ) {
    return mailGatewayReadPayload;
  }
  const mailGatewayPayload = resolveMailGatewayPayload(input);
  if (
    mailGatewayPayload.payload !== undefined ||
    mailGatewayPayload.issues.length > 0
  ) {
    return mailGatewayPayload;
  }
  const gitCommitPayload = resolveGitCommitPayload(input);
  if (
    gitCommitPayload.payload !== undefined ||
    gitCommitPayload.issues.length > 0
  ) {
    return gitCommitPayload;
  }
  const gitPushPayload = resolveGitPushPayload(input);
  if (
    gitPushPayload.payload !== undefined ||
    gitPushPayload.issues.length > 0
  ) {
    return gitPushPayload;
  }

  if (input.addon.name !== CHAT_REPLY_WORKER_ADDON_NAME) {
    return {
      issues: [
        makeIssue(
          `${input.path}.name`,
          `unknown built-in node add-on '${input.addon.name}'`,
        ),
      ],
    };
  }
  if (version !== CHAT_REPLY_WORKER_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${CHAT_REPLY_WORKER_ADDON_NAME}`,
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

  const normalized = normalizeChatReplyWorkerConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: CHAT_REPLY_WORKER_ADDON_NAME,
    version: CHAT_REPLY_WORKER_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that prepares a provider-neutral reply to the triggering chat event.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: CHAT_REPLY_WORKER_OUTPUT,
    },
    issues: [],
  };
}

function isBuiltinAddonNamespace(name: string): boolean {
  return name.startsWith("divedra/");
}

export function resolveNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
  readonly thirdPartyResolvers?: readonly NodeAddonPayloadResolver[];
}): NodeAddonResolveResult {
  if (isBuiltinAddonNamespace(input.addon.name)) {
    return resolveBuiltinNodeAddonPayload(input);
  }

  for (const resolver of input.thirdPartyResolvers ?? []) {
    let resolvedRaw: unknown;
    try {
      resolvedRaw = resolver(input);
    } catch (error: unknown) {
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on resolver failed for '${input.addon.name}': ${errorMessageFromUnknown(error)}`,
          ),
        ],
      };
    }

    const resolved = normalizeThirdPartyResolverResult({
      addonName: input.addon.name,
      path: input.path,
      value: resolvedRaw,
    });
    if (resolved.payload !== undefined || (resolved.issues ?? []).length > 0) {
      return resolved;
    }
  }

  if (requiresAsyncLocalAddonResolution(input)) {
    return {
      issues: [
        makeIssue(
          `${input.path}.name`,
          `local node add-on '${input.addon.name}' requires async workflow loading or validation`,
        ),
      ],
    };
  }

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}

function requiresAsyncLocalAddonResolution(input: {
  readonly addon: WorkflowNodeAddonRef;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
}): boolean {
  if (input.addon.version === undefined || input.addon.version.length === 0) {
    return false;
  }
  const env = input.options?.env ?? process.env;
  return (
    input.options?.addonRoot !== undefined ||
    (env["DIVEDRA_ADDON_ROOT"] ?? "").length > 0 ||
    (input.workflowSource !== undefined &&
      input.workflowSource.scope !== "direct")
  );
}

export async function resolveNodeAddonPayloadAsync(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly workflowSource?: ResolvedWorkflowSource;
  readonly options?: LoadOptions;
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}): Promise<NodeAddonResolveResult> {
  if (isBuiltinAddonNamespace(input.addon.name)) {
    return resolveBuiltinNodeAddonPayload(input);
  }

  let deferredLocalIssue: ValidationIssue | undefined;
  const localSource = await resolveAddonSource({
    addon: input.addon,
    ...(input.workflowSource === undefined
      ? {}
      : { workflowSource: input.workflowSource }),
    ...(input.options === undefined ? {} : { options: input.options }),
  });
  if (localSource.ok) {
    return await resolveLocalNodeAddonPayload({
      nodeId: input.nodeId,
      addon: input.addon,
      path: input.path,
      source: localSource.value,
    });
  }
  if (localSource.error.code !== "NOT_FOUND") {
    deferredLocalIssue = makeIssue(input.path, localSource.error.message);
    if ((input.thirdPartyResolvers ?? []).length === 0) {
      return { issues: [deferredLocalIssue] };
    }
  }

  for (const resolver of input.thirdPartyResolvers ?? []) {
    let resolvedRaw: unknown;
    try {
      resolvedRaw = await resolver(input);
    } catch (error: unknown) {
      return {
        issues: [
          makeIssue(
            input.path,
            `third-party node add-on resolver failed for '${input.addon.name}': ${errorMessageFromUnknown(error)}`,
          ),
        ],
      };
    }

    const resolved = normalizeThirdPartyResolverResult({
      addonName: input.addon.name,
      path: input.path,
      value: resolvedRaw,
    });
    if (resolved.payload !== undefined || (resolved.issues ?? []).length > 0) {
      return resolved;
    }
  }

  if (deferredLocalIssue !== undefined) {
    return { issues: [deferredLocalIssue] };
  }

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}
