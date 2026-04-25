export interface NodeTemplateFieldSpec {
  readonly textField:
    | "systemPromptTemplate"
    | "promptTemplate"
    | "sessionStartPromptTemplate";
  readonly fileField:
    | "systemPromptTemplateFile"
    | "promptTemplateFile"
    | "sessionStartPromptTemplateFile";
}

export const NODE_TEMPLATE_FIELD_SPECS: readonly NodeTemplateFieldSpec[] = [
  {
    fileField: "systemPromptTemplateFile",
    textField: "systemPromptTemplate",
  },
  {
    fileField: "promptTemplateFile",
    textField: "promptTemplate",
  },
  {
    fileField: "sessionStartPromptTemplateFile",
    textField: "sessionStartPromptTemplate",
  },
];

export interface NodeTemplateFieldContainer {
  readonly path: string;
  readonly record: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneNodeTemplateAwarePayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const clonedPayload: Record<string, unknown> = { ...payload };
  const promptVariants = payload["promptVariants"];
  if (!isRecord(promptVariants)) {
    return clonedPayload;
  }

  const clonedVariants: Record<string, unknown> = { ...promptVariants };
  for (const [variantName, variantValue] of Object.entries(promptVariants)) {
    if (isRecord(variantValue)) {
      clonedVariants[variantName] = { ...variantValue };
    }
  }
  clonedPayload["promptVariants"] = clonedVariants;

  return clonedPayload;
}

export function listNodeTemplateFieldContainers(
  payload: Record<string, unknown>,
): readonly NodeTemplateFieldContainer[] {
  const containers: NodeTemplateFieldContainer[] = [
    {
      path: "",
      record: payload,
    },
  ];

  const promptVariants = payload["promptVariants"];
  if (!isRecord(promptVariants)) {
    return containers;
  }

  for (const [variantName, variantValue] of Object.entries(promptVariants)) {
    if (!isRecord(variantValue)) {
      continue;
    }
    containers.push({
      path: `promptVariants.${variantName}`,
      record: variantValue,
    });
  }

  return containers;
}

export function collectNodeTemplateFiles(payload: unknown): readonly string[] {
  if (!isRecord(payload)) {
    return [];
  }

  return listNodeTemplateFieldContainers(payload).flatMap(({ record }) =>
    NODE_TEMPLATE_FIELD_SPECS.flatMap((spec) => {
      const templateFile = record[spec.fileField];
      return typeof templateFile === "string" && templateFile.length > 0
        ? [templateFile]
        : [];
    }),
  );
}
