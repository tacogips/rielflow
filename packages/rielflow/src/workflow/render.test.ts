import { describe, expect, test } from "vitest";
import { renderPromptTemplate } from "./render";

describe("renderPromptTemplate", () => {
  test("renders scalar variables", () => {
    const output = renderPromptTemplate("Hello {{name}} #{{count}}", {
      name: "world",
      count: 3,
    });
    expect(output).toBe("Hello world #3");
  });

  test("supports dot path lookup", () => {
    const output = renderPromptTemplate("User={{user.name}}", {
      user: { name: "alice" },
    });
    expect(output).toBe("User=alice");
  });

  test("returns empty string for missing keys", () => {
    const output = renderPromptTemplate("x={{missing}}", {});
    expect(output).toBe("x=");
  });
});
