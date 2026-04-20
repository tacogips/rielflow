import type {
  AgentWorkerAddonConfig,
  CliAgentBackend,
  ChatReplyWorkerConfig,
  MailGatewayAddonConfig,
  MailGatewayReadAddonConfig,
  AsyncNodeAddonPayloadResolver,
  NodeAddonDefinition,
  NodeAddonPayloadResolver,
  NodeAddonResolveInput,
  NodeAddonResolveResult,
  NodeOutputContract,
  NodePayload,
  ResolvedNodeAddon,
  ValidationIssue,
  WorkflowNodeAddonRef,
  XGatewayAddonConfig,
  XGatewayReadAddonConfig,
} from "./types";

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

function normalizeXGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "queryTemplate",
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

  const queryTemplate = readRequiredStringConfig(
    config,
    "queryTemplate",
    path,
    issues,
  );
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

  if (issues.length > 0 || queryTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      queryTemplate,
      ...(image === undefined ? {} : { image }),
      ...(runnerKind === undefined ? {} : { runnerKind }),
      ...(runnerPath === undefined ? {} : { runnerPath }),
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    },
    issues,
  };
}

function normalizeXGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: XGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "documentTemplate",
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

  const documentTemplate = readRequiredStringConfig(
    config,
    "documentTemplate",
    path,
    issues,
  );
  const image = readOptionalStringConfig(config, "image", path, issues);
  const runnerPath = readOptionalStringConfig(
    config,
    "runnerPath",
    path,
    issues,
  );

  const runnerKindRaw = config["runnerKind"];
  let runnerKind: XGatewayAddonConfig["runnerKind"];
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
  let networkPolicy: XGatewayAddonConfig["networkPolicy"];
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

  if (issues.length > 0 || documentTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      documentTemplate,
      ...(image === undefined ? {} : { image }),
      ...(runnerKind === undefined ? {} : { runnerKind }),
      ...(runnerPath === undefined ? {} : { runnerPath }),
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    },
    issues,
  };
}

function normalizeMailGatewayReadConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayReadAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "queryTemplate",
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

  const queryTemplate = readRequiredStringConfig(
    config,
    "queryTemplate",
    path,
    issues,
  );
  const image = readOptionalStringConfig(config, "image", path, issues);
  const runnerPath = readOptionalStringConfig(
    config,
    "runnerPath",
    path,
    issues,
  );

  const runnerKindRaw = config["runnerKind"];
  let runnerKind: MailGatewayReadAddonConfig["runnerKind"];
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
  let networkPolicy: MailGatewayReadAddonConfig["networkPolicy"];
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

  if (issues.length > 0 || queryTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      queryTemplate,
      ...(image === undefined ? {} : { image }),
      ...(runnerKind === undefined ? {} : { runnerKind }),
      ...(runnerPath === undefined ? {} : { runnerPath }),
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    },
    issues,
  };
}

function normalizeMailGatewayConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: MailGatewayAddonConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set([
    "documentTemplate",
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

  const documentTemplate = readRequiredStringConfig(
    config,
    "documentTemplate",
    path,
    issues,
  );
  const image = readOptionalStringConfig(config, "image", path, issues);
  const runnerPath = readOptionalStringConfig(
    config,
    "runnerPath",
    path,
    issues,
  );

  const runnerKindRaw = config["runnerKind"];
  let runnerKind: MailGatewayAddonConfig["runnerKind"];
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
  let networkPolicy: MailGatewayAddonConfig["networkPolicy"];
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

  if (issues.length > 0 || documentTemplate === undefined) {
    return { issues };
  }

  return {
    config: {
      documentTemplate,
      ...(image === undefined ? {} : { image }),
      ...(runnerKind === undefined ? {} : { runnerKind }),
      ...(runnerPath === undefined ? {} : { runnerPath }),
      ...(networkPolicy === undefined ? {} : { networkPolicy }),
    },
    issues,
  };
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

function resolveXGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== X_GATEWAY_READ_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? X_GATEWAY_READ_ADDON_VERSION;
  if (version !== X_GATEWAY_READ_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${X_GATEWAY_READ_ADDON_NAME}`,
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

  const normalized = normalizeXGatewayReadConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: X_GATEWAY_READ_ADDON_NAME,
    version: X_GATEWAY_READ_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.env === undefined ? {} : { env: input.addon.env }),
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that runs a read-only x-gateway query in a container.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: X_GATEWAY_READ_OUTPUT,
    },
    issues: [],
  };
}

function resolveXGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== X_GATEWAY_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? X_GATEWAY_ADDON_VERSION;
  if (version !== X_GATEWAY_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${X_GATEWAY_ADDON_NAME}`,
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

  const normalized = normalizeXGatewayConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: X_GATEWAY_ADDON_NAME,
    version: X_GATEWAY_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.env === undefined ? {} : { env: input.addon.env }),
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that runs an x-gateway query or mutation in a container.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: X_GATEWAY_OUTPUT,
    },
    issues: [],
  };
}

function resolveMailGatewayReadPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== MAIL_GATEWAY_READ_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? MAIL_GATEWAY_READ_ADDON_VERSION;
  if (version !== MAIL_GATEWAY_READ_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${MAIL_GATEWAY_READ_ADDON_NAME}`,
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

  const normalized = normalizeMailGatewayReadConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: MAIL_GATEWAY_READ_ADDON_NAME,
    version: MAIL_GATEWAY_READ_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.env === undefined ? {} : { env: input.addon.env }),
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that runs a read-only mail-gateway query in a container.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: MAIL_GATEWAY_READ_OUTPUT,
    },
    issues: [],
  };
}

function resolveMailGatewayPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  if (input.addon.name !== MAIL_GATEWAY_ADDON_NAME) {
    return { issues: [] };
  }

  const version = input.addon.version ?? MAIL_GATEWAY_ADDON_VERSION;
  if (version !== MAIL_GATEWAY_ADDON_VERSION) {
    return {
      issues: [
        makeIssue(
          `${input.path}.version`,
          `unsupported version '${version}' for ${MAIL_GATEWAY_ADDON_NAME}`,
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

  const normalized = normalizeMailGatewayConfig(
    input.addon.config,
    `${input.path}.config`,
  );
  if (normalized.config === undefined) {
    return { issues: normalized.issues };
  }

  const addon: ResolvedNodeAddon = {
    name: MAIL_GATEWAY_ADDON_NAME,
    version: MAIL_GATEWAY_ADDON_VERSION,
    config: normalized.config,
    ...(input.addon.env === undefined ? {} : { env: input.addon.env }),
    ...(input.addon.inputs === undefined ? {} : { inputs: input.addon.inputs }),
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that runs a mail-gateway query or mutation in a container.",
      nodeType: "addon",
      variables: input.addon.inputs ?? {},
      addon,
      output: MAIL_GATEWAY_OUTPUT,
    },
    issues: [],
  };
}

export function resolveBuiltinNodeAddonPayload(
  input: NodeAddonResolveInput,
): NodeAddonResolveResult {
  const version = input.addon.version ?? CHAT_REPLY_WORKER_ADDON_VERSION;
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

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}

export async function resolveNodeAddonPayloadAsync(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
  readonly thirdPartyResolvers?: readonly AsyncNodeAddonPayloadResolver[];
}): Promise<NodeAddonResolveResult> {
  if (isBuiltinAddonNamespace(input.addon.name)) {
    return resolveBuiltinNodeAddonPayload(input);
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

  return {
    issues: [
      makeIssue(
        `${input.path}.name`,
        `unknown third-party node add-on '${input.addon.name}'`,
      ),
    ],
  };
}
