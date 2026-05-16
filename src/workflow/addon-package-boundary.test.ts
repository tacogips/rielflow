import { describe, expect, test } from "vitest";
import { loadBoundaryAddonPackage } from "./addon-package-boundary";

describe("add-on package boundary", () => {
  test("loads the add-ons package from the source checkout before dist is built", async () => {
    const module = await loadBoundaryAddonPackage();

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });
});
