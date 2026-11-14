import { describe, expect, test } from "vitest";
import {
  createBoundaryAddonPackageLoader,
  loadBoundaryAddonPackage,
  resolveDefaultBoundaryAddonPackageEntrypoints,
} from "./addon-package-boundary";

describe("add-on package boundary", () => {
  test("falls back to the package source entrypoint before dist is built", async () => {
    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: new URL(
          "../../packages/divedra-addons/dist/missing-for-test.js",
          import.meta.url,
        ),
        sourceEntrypoint: new URL(
          "../../../divedra-addons/src/index.ts",
          import.meta.url,
        ),
      }),
    );

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });

  test("loads the add-ons package through an injected dev source resolver", async () => {
    const module = await loadBoundaryAddonPackage(
      async () =>
        (await import("../../../divedra-addons/src/index")) as Readonly<
          Record<string, unknown>
        >,
    );

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });

  test("resolves package entrypoints from bundled root and package CLI locations", async () => {
    const rootCliEntrypoints = resolveDefaultBoundaryAddonPackageEntrypoints(
      new URL("../../../../dist/main.js", import.meta.url),
    );
    const packageCliEntrypoints = resolveDefaultBoundaryAddonPackageEntrypoints(
      new URL("../../dist/main.js", import.meta.url),
    );

    expect(rootCliEntrypoints.builtEntrypoint.pathname).toMatch(
      /\/packages\/divedra-addons\/dist\/index\.js$/,
    );
    expect(rootCliEntrypoints.sourceEntrypoint.pathname).toMatch(
      /\/packages\/divedra-addons\/src\/index\.ts$/,
    );
    expect(packageCliEntrypoints.builtEntrypoint.pathname).toMatch(
      /\/packages\/divedra-addons\/dist\/index\.js$/,
    );
    expect(packageCliEntrypoints.sourceEntrypoint.pathname).toMatch(
      /\/packages\/divedra-addons\/src\/index\.ts$/,
    );

    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: new URL(
          "missing-for-test.js",
          rootCliEntrypoints.builtEntrypoint,
        ),
        sourceEntrypoint: rootCliEntrypoints.sourceEntrypoint,
      }),
    );

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });
});
