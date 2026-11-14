import type { JsonObject, JsonValue } from "./types";

type JsonSchemaPrimitiveType =
  | "null"
  | "boolean"
  | "object"
  | "array"
  | "number"
  | "integer"
  | "string";

type JsonSchemaType =
  | JsonSchemaPrimitiveType
  | readonly JsonSchemaPrimitiveType[];

interface JsonSchemaNode extends JsonObject {
  readonly $schema?: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: JsonSchemaType;
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly items?: JsonSchemaNode;
  readonly enum?: readonly JsonValue[];
  readonly const?: JsonValue;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly allOf?: readonly JsonSchemaNode[];
}

export interface JsonSchemaValidationError {
  readonly path: string;
  readonly message: string;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$schema",
  "title",
  "description",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "anyOf",
  "oneOf",
  "allOf",
]);

const JSON_SCHEMA_PRIMITIVE_TYPES = new Set<JsonSchemaPrimitiveType>([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce<Record<string, unknown>>((accumulator, key) => {
        accumulator[key] = sortJsonValue(value[key]);
        return accumulator;
      }, {});
  }
  return value;
}

function pushError(
  errors: JsonSchemaValidationError[],
  path: string,
  message: string,
): void {
  errors.push({ path, message });
}

function validateSchemaNode(
  schema: unknown,
  path: string,
  errors: JsonSchemaValidationError[],
): schema is JsonSchemaNode {
  const initialErrorCount = errors.length;
  if (!isJsonObject(schema)) {
    pushError(errors, path, "must be an object");
    return false;
  }

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      pushError(
        errors,
        `${path}.${key}`,
        "uses an unsupported JSON Schema keyword",
      );
    }
  }

  const schemaVersion = schema["$schema"];
  if (schemaVersion !== undefined && typeof schemaVersion !== "string") {
    pushError(errors, `${path}.$schema`, "must be a string when provided");
  }
  const title = schema["title"];
  if (title !== undefined && typeof title !== "string") {
    pushError(errors, `${path}.title`, "must be a string when provided");
  }
  const description = schema["description"];
  if (description !== undefined && typeof description !== "string") {
    pushError(errors, `${path}.description`, "must be a string when provided");
  }

  const type = schema["type"];
  if (type !== undefined) {
    if (typeof type === "string") {
      if (!JSON_SCHEMA_PRIMITIVE_TYPES.has(type as JsonSchemaPrimitiveType)) {
        pushError(
          errors,
          `${path}.type`,
          "must be a supported JSON Schema type",
        );
      }
    } else if (Array.isArray(type)) {
      if (type.length === 0) {
        pushError(errors, `${path}.type`, "must not be an empty array");
      }
      for (const [index, entry] of type.entries()) {
        if (
          typeof entry !== "string" ||
          !JSON_SCHEMA_PRIMITIVE_TYPES.has(entry as JsonSchemaPrimitiveType)
        ) {
          pushError(
            errors,
            `${path}.type[${index}]`,
            "must be a supported JSON Schema type",
          );
        }
      }
    } else {
      pushError(errors, `${path}.type`, "must be a string or array of strings");
    }
  }

  const properties = schema["properties"];
  if (properties !== undefined) {
    if (!isJsonObject(properties)) {
      pushError(
        errors,
        `${path}.properties`,
        "must be an object when provided",
      );
    } else {
      for (const [key, value] of Object.entries(properties)) {
        validateSchemaNode(value, `${path}.properties.${key}`, errors);
      }
    }
  }

  const required = schema["required"];
  if (required !== undefined) {
    if (!Array.isArray(required)) {
      pushError(errors, `${path}.required`, "must be an array when provided");
    } else {
      for (const [index, entry] of required.entries()) {
        if (typeof entry !== "string" || entry.length === 0) {
          pushError(
            errors,
            `${path}.required[${index}]`,
            "must be a non-empty string",
          );
        }
      }
    }
  }

  const additionalProperties = schema["additionalProperties"];
  if (additionalProperties !== undefined) {
    if (typeof additionalProperties === "boolean") {
      // valid
    } else {
      validateSchemaNode(
        additionalProperties,
        `${path}.additionalProperties`,
        errors,
      );
    }
  }

  const items = schema["items"];
  if (items !== undefined) {
    validateSchemaNode(items, `${path}.items`, errors);
  }

  const enumValue = schema["enum"];
  if (enumValue !== undefined) {
    if (!Array.isArray(enumValue) || enumValue.length === 0) {
      pushError(
        errors,
        `${path}.enum`,
        "must be a non-empty array when provided",
      );
    }
  }

  const minLength = schema["minLength"];
  if (
    minLength !== undefined &&
    (typeof minLength !== "number" ||
      !Number.isInteger(minLength) ||
      minLength < 0)
  ) {
    pushError(
      errors,
      `${path}.minLength`,
      "must be an integer >= 0 when provided",
    );
  }
  const maxLength = schema["maxLength"];
  if (
    maxLength !== undefined &&
    (typeof maxLength !== "number" ||
      !Number.isInteger(maxLength) ||
      maxLength < 0)
  ) {
    pushError(
      errors,
      `${path}.maxLength`,
      "must be an integer >= 0 when provided",
    );
  }
  if (
    typeof minLength === "number" &&
    typeof maxLength === "number" &&
    minLength > maxLength
  ) {
    pushError(errors, `${path}.maxLength`, "must be >= minLength");
  }

  const pattern = schema["pattern"];
  if (pattern !== undefined) {
    if (typeof pattern !== "string") {
      pushError(errors, `${path}.pattern`, "must be a string when provided");
    } else {
      try {
        new RegExp(pattern, "u");
      } catch {
        pushError(
          errors,
          `${path}.pattern`,
          "must be a valid regular expression",
        );
      }
    }
  }

  const minimum = schema["minimum"];
  if (
    minimum !== undefined &&
    (typeof minimum !== "number" || !Number.isFinite(minimum))
  ) {
    pushError(
      errors,
      `${path}.minimum`,
      "must be a finite number when provided",
    );
  }
  const maximum = schema["maximum"];
  if (
    maximum !== undefined &&
    (typeof maximum !== "number" || !Number.isFinite(maximum))
  ) {
    pushError(
      errors,
      `${path}.maximum`,
      "must be a finite number when provided",
    );
  }
  if (
    typeof minimum === "number" &&
    typeof maximum === "number" &&
    minimum > maximum
  ) {
    pushError(errors, `${path}.maximum`, "must be >= minimum");
  }

  const minItems = schema["minItems"];
  if (
    minItems !== undefined &&
    (typeof minItems !== "number" ||
      !Number.isInteger(minItems) ||
      minItems < 0)
  ) {
    pushError(
      errors,
      `${path}.minItems`,
      "must be an integer >= 0 when provided",
    );
  }
  const maxItems = schema["maxItems"];
  if (
    maxItems !== undefined &&
    (typeof maxItems !== "number" ||
      !Number.isInteger(maxItems) ||
      maxItems < 0)
  ) {
    pushError(
      errors,
      `${path}.maxItems`,
      "must be an integer >= 0 when provided",
    );
  }
  if (
    typeof minItems === "number" &&
    typeof maxItems === "number" &&
    minItems > maxItems
  ) {
    pushError(errors, `${path}.maxItems`, "must be >= minItems");
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const combinator = schema[key];
    if (combinator === undefined) {
      continue;
    }
    if (!Array.isArray(combinator) || combinator.length === 0) {
      pushError(
        errors,
        `${path}.${key}`,
        "must be a non-empty array when provided",
      );
      continue;
    }
    combinator.forEach((entry, index) => {
      validateSchemaNode(entry, `${path}.${key}[${index}]`, errors);
    });
  }

  return errors.length === initialErrorCount;
}

function typeList(
  type: JsonSchemaType | undefined,
): readonly JsonSchemaPrimitiveType[] {
  if (type === undefined) {
    return [];
  }
  return typeof type === "string" ? [type] : type;
}

function matchesType(value: unknown, type: JsonSchemaPrimitiveType): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "string":
      return typeof value === "string";
  }
}

function joinPath(basePath: string, next: string): string {
  if (basePath === "$") {
    return next.startsWith("[") ? `$${next}` : `$.${next}`;
  }
  return next.startsWith("[") ? `${basePath}${next}` : `${basePath}.${next}`;
}

function canPossiblyAcceptObject(schema: JsonSchemaNode): boolean {
  const allowedTypes = typeList(schema.type);
  if (allowedTypes.length > 0 && !allowedTypes.includes("object")) {
    return false;
  }

  if (schema.const !== undefined) {
    return isRecord(schema.const);
  }

  if (schema.enum !== undefined) {
    return schema.enum.some((entry) => isRecord(entry));
  }

  if (schema.allOf !== undefined) {
    return schema.allOf.every((entry) => canPossiblyAcceptObject(entry));
  }

  if (schema.anyOf !== undefined) {
    return schema.anyOf.some((entry) => canPossiblyAcceptObject(entry));
  }

  if (schema.oneOf !== undefined) {
    return schema.oneOf.some((entry) => canPossiblyAcceptObject(entry));
  }

  return true;
}

function validateValue(
  schema: JsonSchemaNode,
  value: unknown,
  path: string,
  errors: JsonSchemaValidationError[],
): void {
  const allowedTypes = typeList(schema.type);
  if (
    allowedTypes.length > 0 &&
    !allowedTypes.some((type) => matchesType(value, type))
  ) {
    pushError(errors, path, `must be of type ${allowedTypes.join(" | ")}`);
    return;
  }

  if (
    schema.const !== undefined &&
    stableJson(value) !== stableJson(schema.const)
  ) {
    pushError(errors, path, "must equal the declared const value");
  }

  if (schema.enum !== undefined) {
    const matches = schema.enum.some(
      (entry) => stableJson(entry) === stableJson(value),
    );
    if (!matches) {
      pushError(errors, path, "must equal one of the declared enum values");
    }
  }

  if (schema.allOf !== undefined) {
    schema.allOf.forEach((entry) => validateValue(entry, value, path, errors));
  }

  if (schema.anyOf !== undefined) {
    const branchMatches = schema.anyOf.filter((entry) => {
      const branchErrors: JsonSchemaValidationError[] = [];
      validateValue(entry, value, path, branchErrors);
      return branchErrors.length === 0;
    });
    if (branchMatches.length === 0) {
      pushError(errors, path, "must satisfy at least one anyOf branch");
    }
  }

  if (schema.oneOf !== undefined) {
    const branchMatches = schema.oneOf.filter((entry) => {
      const branchErrors: JsonSchemaValidationError[] = [];
      validateValue(entry, value, path, branchErrors);
      return branchErrors.length === 0;
    });
    if (branchMatches.length !== 1) {
      pushError(errors, path, "must satisfy exactly one oneOf branch");
    }
  }

  if (typeof value === "string") {
    if (
      typeof schema.minLength === "number" &&
      value.length < schema.minLength
    ) {
      pushError(errors, path, `must have length >= ${schema.minLength}`);
    }
    if (
      typeof schema.maxLength === "number" &&
      value.length > schema.maxLength
    ) {
      pushError(errors, path, `must have length <= ${schema.maxLength}`);
    }
    if (
      typeof schema.pattern === "string" &&
      !new RegExp(schema.pattern, "u").test(value)
    ) {
      pushError(errors, path, "must match the declared pattern");
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      pushError(errors, path, `must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      pushError(errors, path, `must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      pushError(errors, path, `must contain at least ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      pushError(errors, path, `must contain at most ${schema.maxItems} items`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        validateValue(
          schema.items as JsonSchemaNode,
          entry,
          joinPath(path, `[${index}]`),
          errors,
        );
      });
    }
  }

  if (isRecord(value)) {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        pushError(errors, joinPath(path, key), "required property is missing");
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (propertySchema !== undefined) {
        validateValue(propertySchema, entry, joinPath(path, key), errors);
        continue;
      }

      if (schema.additionalProperties === false) {
        pushError(
          errors,
          joinPath(path, key),
          "additional property is not allowed",
        );
      } else if (isJsonObject(schema.additionalProperties)) {
        validateValue(
          schema.additionalProperties as JsonSchemaNode,
          entry,
          joinPath(path, key),
          errors,
        );
      }
    }
  }
}

export function validateJsonSchemaDefinition(
  schema: JsonObject,
): readonly JsonSchemaValidationError[] {
  const errors: JsonSchemaValidationError[] = [];
  validateSchemaNode(schema, "$schema", errors);
  if (
    errors.length === 0 &&
    !canPossiblyAcceptObject(schema as JsonSchemaNode)
  ) {
    pushError(
      errors,
      "$schema",
      "must allow object because node output payloads are always top-level JSON objects",
    );
  }
  return errors;
}

export function validateJsonValueAgainstSchema(input: {
  readonly schema: JsonObject;
  readonly value: unknown;
}): readonly JsonSchemaValidationError[] {
  const definitionErrors = validateJsonSchemaDefinition(input.schema);
  if (definitionErrors.length > 0) {
    return definitionErrors;
  }

  const errors: JsonSchemaValidationError[] = [];
  validateValue(input.schema as JsonSchemaNode, input.value, "$", errors);
  return errors;
}
