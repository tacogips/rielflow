export type EventPathRootName =
  | "binding"
  | "event"
  | "source"
  | "workflowInput";

export interface EventPathRoots {
  readonly binding?: unknown | undefined;
  readonly event?: unknown | undefined;
  readonly source?: unknown | undefined;
  readonly workflowInput?: unknown | undefined;
}

export interface ResolveEventPathReferenceInput {
  readonly expression: string;
  readonly roots: EventPathRoots;
  readonly allowedRoots: readonly EventPathRootName[];
  readonly allowArrayTraversal?: boolean | undefined;
  readonly filterEmptySegments?: boolean | undefined;
  readonly trimExpression?: boolean | undefined;
}

export interface ResolveEventPathTextInput
  extends Omit<ResolveEventPathReferenceInput, "expression"> {
  readonly path?: string | undefined;
  readonly defaultPath?: string | undefined;
  readonly trimString?: boolean | undefined;
}

export interface RenderEventTemplateInput {
  readonly value: unknown;
  readonly roots: EventPathRoots;
  readonly allowedRoots: readonly EventPathRootName[];
  readonly allowArrayTraversal?: boolean | undefined;
}

const TEMPLATE_EXACT_REFERENCE_PATTERN = /^\{\{\s*([^}]+?)\s*\}\}$/;
const TEMPLATE_REFERENCE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g;
const NAMED_TEMPLATE_REFERENCE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function isJsonObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRootAllowed(
  allowedRoots: readonly EventPathRootName[],
  rootName: string | undefined,
): rootName is EventPathRootName {
  return (
    rootName !== undefined &&
    allowedRoots.includes(rootName as EventPathRootName)
  );
}

function getRootValue(
  roots: EventPathRoots,
  rootName: EventPathRootName,
): unknown {
  switch (rootName) {
    case "binding":
      return roots.binding;
    case "event":
      return roots.event;
    case "source":
      return roots.source;
    case "workflowInput":
      return roots.workflowInput;
  }
}

function canReadSegment(value: unknown, allowArrayTraversal: boolean): boolean {
  return isJsonObject(value) || (allowArrayTraversal && Array.isArray(value));
}

export function readDottedPath(
  root: unknown,
  pathSegments: readonly string[],
  options: { readonly allowArrayTraversal?: boolean | undefined } = {},
): unknown {
  const allowArrayTraversal = options.allowArrayTraversal ?? false;
  let current = root;
  for (const segment of pathSegments) {
    if (!canReadSegment(current, allowArrayTraversal)) {
      return undefined;
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return current;
}

export function resolveEventPathReference(
  input: ResolveEventPathReferenceInput,
): unknown {
  const expression =
    input.trimExpression === false ? input.expression : input.expression.trim();
  const segments = input.filterEmptySegments
    ? expression.split(".").filter((segment) => segment.length > 0)
    : expression.split(".");
  const rootName = segments[0];
  if (!isRootAllowed(input.allowedRoots, rootName)) {
    return undefined;
  }
  const root = getRootValue(input.roots, rootName);
  if (root === undefined) {
    return undefined;
  }
  return readDottedPath(root, segments.slice(1), {
    allowArrayTraversal: input.allowArrayTraversal,
  });
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  const rendered = JSON.stringify(value);
  return rendered === undefined ? "" : rendered;
}

export function renderEventStringTemplate(input: {
  readonly template: string;
  readonly roots: EventPathRoots;
  readonly allowedRoots: readonly EventPathRootName[];
  readonly allowArrayTraversal?: boolean | undefined;
}): string {
  return input.template.replace(
    TEMPLATE_REFERENCE_PATTERN,
    (_match, expression) =>
      stringifyTemplateValue(
        resolveEventPathReference({
          expression: String(expression),
          roots: input.roots,
          allowedRoots: input.allowedRoots,
          allowArrayTraversal: input.allowArrayTraversal,
        }),
      ),
  );
}

export function renderEventTemplateValue(
  input: RenderEventTemplateInput,
): unknown {
  if (typeof input.value === "string") {
    const exact = input.value.match(TEMPLATE_EXACT_REFERENCE_PATTERN);
    if (exact !== null) {
      return resolveEventPathReference({
        expression: exact[1] ?? "",
        roots: input.roots,
        allowedRoots: input.allowedRoots,
        allowArrayTraversal: input.allowArrayTraversal,
      });
    }
    return renderEventStringTemplate({
      template: input.value,
      roots: input.roots,
      allowedRoots: input.allowedRoots,
      allowArrayTraversal: input.allowArrayTraversal,
    });
  }
  if (Array.isArray(input.value)) {
    return input.value.map((entry) =>
      renderEventTemplateValue({ ...input, value: entry }),
    );
  }
  if (isJsonObject(input.value)) {
    return Object.fromEntries(
      Object.entries(input.value).map(([key, entry]) => [
        key,
        renderEventTemplateValue({ ...input, value: entry }),
      ]),
    );
  }
  return input.value;
}

export function resolveEventPathText(
  input: ResolveEventPathTextInput,
): string | undefined {
  const expression = input.path ?? input.defaultPath;
  if (expression === undefined) {
    return undefined;
  }
  const value = resolveEventPathReference({
    expression,
    roots: input.roots,
    allowedRoots: input.allowedRoots,
    allowArrayTraversal: input.allowArrayTraversal,
    filterEmptySegments: input.filterEmptySegments,
  });
  if (typeof value === "string") {
    if (input.trimString === true) {
      const trimmed = value.trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function renderNamedTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(NAMED_TEMPLATE_REFERENCE_PATTERN, (_match, key) => {
    return values[String(key)] ?? "";
  });
}
