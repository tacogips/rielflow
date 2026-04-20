import type {
  ChatReplyWorkerConfig,
  NodeOutputContract,
  NodePayload,
  ResolvedNodeAddon,
  ValidationIssue,
  WorkflowNodeAddonRef,
} from "./types";

export const CHAT_REPLY_WORKER_ADDON_NAME = "divedra/chat-reply-worker";
export const CHAT_REPLY_WORKER_ADDON_VERSION = "1";

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

function makeIssue(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function resolveBuiltinNodeAddonPayload(input: {
  readonly nodeId: string;
  readonly addon: WorkflowNodeAddonRef;
  readonly path: string;
}): {
  readonly payload?: NodePayload;
  readonly issues: readonly ValidationIssue[];
} {
  const version = input.addon.version ?? CHAT_REPLY_WORKER_ADDON_VERSION;
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
  };

  return {
    payload: {
      id: input.nodeId,
      description:
        "Built-in worker that prepares a provider-neutral reply to the triggering chat event.",
      nodeType: "addon",
      variables: {},
      addon,
      output: CHAT_REPLY_WORKER_OUTPUT,
    },
    issues: [],
  };
}
