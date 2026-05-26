import { describe, expect, test } from "vitest";
import { isJsonObject } from "./json";

describe("isJsonObject", () => {
  test("accepts plain object values", () => {
    expect(isJsonObject({ ok: true })).toBe(true);
  });

  test("rejects arrays and null", () => {
    expect(isJsonObject(["x"])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
  });
});
