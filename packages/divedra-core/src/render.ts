function lookupPath(
  data: Readonly<Record<string, unknown>>,
  keyPath: string,
): unknown {
  const keys = keyPath.split(".").filter((entry) => entry.length > 0);
  let current: unknown = data;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function renderPromptTemplate(
  template: string,
  variables: Readonly<Record<string, unknown>>,
): string {
  return template.replace(
    /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g,
    (_match: string, path: string) => {
      const value = lookupPath(variables, path);
      if (value === undefined || value === null) {
        return "";
      }
      if (typeof value === "string") {
        return value;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      return JSON.stringify(value);
    },
  );
}
