import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  isSafeSupervisionRunId,
  resolveSupervisionMutableWorkflowDirectory,
  resolveSupervisionRunDirectory,
} from "./paths";

describe("supervision path helpers", () => {
  test("isSafeSupervisionRunId accepts engine-shaped ids and rejects traversal or bad shape", () => {
    expect(isSafeSupervisionRunId("sup-0123456789abcdef")).toBe(true);
    expect(isSafeSupervisionRunId("sup-01234567")).toBe(true);
    expect(isSafeSupervisionRunId("sup-")).toBe(false);
    expect(isSafeSupervisionRunId("sup-0123456")).toBe(false);
    expect(isSafeSupervisionRunId("other-0123456789abcdef")).toBe(false);
    expect(isSafeSupervisionRunId("sup-01234567../x")).toBe(false);
    expect(isSafeSupervisionRunId("sup-GGGGGGGGGGGGGGGG")).toBe(false);
  });

  test("resolveSupervisionRunDirectory returns a path under the artifact root or undefined", () => {
    const root = path.join(path.sep, "tmp", "artifact");
    const id = "sup-0123456789abcdef";
    const resolved = resolveSupervisionRunDirectory(root, id);
    expect(resolved).toBe(path.join(root, "supervision", id));

    expect(resolveSupervisionRunDirectory(root, "evil/../x")).toBeUndefined();
  });

  test("resolveSupervisionMutableWorkflowDirectory requires safe supervision id and workflow id", () => {
    const root = path.join(path.sep, "tmp", "artifact");
    const sup = "sup-0123456789abcdef";
    const wf = "my-workflow";
    const resolved = resolveSupervisionMutableWorkflowDirectory(root, sup, wf);
    expect(resolved).toBe(
      path.join(root, "supervision", sup, "mutable", wf),
    );

    expect(
      resolveSupervisionMutableWorkflowDirectory(root, "bad", wf),
    ).toBeUndefined();
    expect(
      resolveSupervisionMutableWorkflowDirectory(root, sup, "../escape"),
    ).toBeUndefined();
  });
});
