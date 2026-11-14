import type {
  ChatPersonaRouterConfig,
  NodeOutputContract,
  ValidationIssue,
} from "../../../rielflow-core/src/index";
import {
  isRecord,
  makeIssue,
  readOptionalStringConfig,
} from "./addon-constants-and-agent-config";

export const CHAT_PERSONA_ROUTER_ADDON_NAME =
  "rielflow/chat-persona-router";
export const CHAT_PERSONA_ROUTER_ADDON_VERSION = "1";

export const CHAT_PERSONA_ROUTER_OUTPUT: NodeOutputContract = {
  description:
    "Provider-neutral chat persona routing decision produced by the built-in chat persona router.",
  jsonSchema: {
    type: "object",
    required: ["target"],
    additionalProperties: true,
    properties: {
      target: { type: "string", minLength: 1 },
      reason: { type: "string" },
    },
  },
};

function readStringArrayConfig(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    issues.push(makeIssue(path, "must be an array of non-empty strings"));
    return undefined;
  }
  return value;
}

export function normalizeChatPersonaRouterConfig(
  value: Readonly<Record<string, unknown>> | undefined,
  path: string,
): {
  readonly config?: ChatPersonaRouterConfig;
  readonly issues: readonly ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const config: Readonly<Record<string, unknown>> = value ?? {};
  const allowedKeys = new Set(["defaultPersonaId", "personas", "textTemplate"]);

  for (const key of Object.keys(config)) {
    if (!allowedKeys.has(key)) {
      issues.push(makeIssue(`${path}.${key}`, "is not supported"));
    }
  }

  const defaultPersonaId = readOptionalStringConfig(
    config,
    "defaultPersonaId",
    `${path}.defaultPersonaId`,
    issues,
  );
  if (defaultPersonaId === undefined) {
    issues.push(
      makeIssue(`${path}.defaultPersonaId`, "must be a non-empty string"),
    );
  }

  const textTemplate = readOptionalStringConfig(
    config,
    "textTemplate",
    `${path}.textTemplate`,
    issues,
  );

  const rawPersonas = config["personas"];
  if (!Array.isArray(rawPersonas) || rawPersonas.length === 0) {
    issues.push(makeIssue(`${path}.personas`, "must be a non-empty array"));
    return { issues };
  }

  const personaIds = new Set<string>();
  const personas: ChatPersonaRouterConfig["personas"][number][] = [];
  for (const [index, rawPersona] of rawPersonas.entries()) {
    const personaPath = `${path}.personas[${String(index)}]`;
    if (!isRecord(rawPersona)) {
      issues.push(makeIssue(personaPath, "must be an object"));
      continue;
    }
    const id = readOptionalStringConfig(rawPersona, "id", `${personaPath}.id`, issues);
    const name = readOptionalStringConfig(
      rawPersona,
      "name",
      `${personaPath}.name`,
      issues,
    );
    const aliases = readStringArrayConfig(
      rawPersona["aliases"],
      `${personaPath}.aliases`,
      issues,
    );
    if (id === undefined || name === undefined) {
      continue;
    }
    if (personaIds.has(id)) {
      issues.push(makeIssue(`${personaPath}.id`, "must be unique"));
      continue;
    }
    personaIds.add(id);
    personas.push({
      id,
      name,
      ...(aliases === undefined ? {} : { aliases }),
    });
  }

  if (defaultPersonaId !== undefined && !personaIds.has(defaultPersonaId)) {
    issues.push(
      makeIssue(
        `${path}.defaultPersonaId`,
        "must match one configured persona id",
      ),
    );
  }

  if (issues.length > 0 || defaultPersonaId === undefined) {
    return { issues };
  }

  return {
    config: {
      defaultPersonaId,
      personas,
      ...(textTemplate === undefined ? {} : { textTemplate }),
    },
    issues,
  };
}
