import { describe, expect, test } from "vitest";
import {
  createBoundaryAddonPackageLoader,
  loadBoundaryAddonPackage,
  resolveDefaultBoundaryAddonPackageEntrypoints,
} from "./addon-package-boundary";

describe("add-on package boundary", () => {
  const sourceModuleUrl = new URL(
    'data:text/javascript,export const selected = "source";',
  );
  const builtModuleUrl = new URL(
    'data:text/javascript,export const selected = "built";',
  );

  test("falls back to the package source entrypoint before dist is built", async () => {
    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: new URL(
          "../../packages/rielflow-addons/dist/missing-for-test.js",
          import.meta.url,
        ),
        sourceEntrypoint: new URL(
          "../../../rielflow-addons/src/index.ts",
          import.meta.url,
        ),
      }),
    );

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });

  test("prefers source before built output for source-tree package entrypoints", async () => {
    const entrypoints = resolveDefaultBoundaryAddonPackageEntrypoints(
      new URL("addon-package-boundary.ts", import.meta.url),
    );

    expect(
      entrypoints.importOrder.map((entrypoint) => entrypoint.pathname),
    ).toEqual([
      entrypoints.sourceEntrypoint.pathname,
      entrypoints.builtEntrypoint.pathname,
    ]);

    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: builtModuleUrl,
        sourceEntrypoint: sourceModuleUrl,
        importOrder: [sourceModuleUrl, builtModuleUrl],
      }),
    );

    expect(module["selected"]).toBe("source");
  });

  test("prefers built output before source for bundled package entrypoints", async () => {
    const entrypoints = resolveDefaultBoundaryAddonPackageEntrypoints(
      new URL("../../dist/main.js", import.meta.url),
    );

    expect(
      entrypoints.importOrder.map((entrypoint) => entrypoint.pathname),
    ).toEqual([
      entrypoints.builtEntrypoint.pathname,
      entrypoints.sourceEntrypoint.pathname,
    ]);

    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: builtModuleUrl,
        sourceEntrypoint: sourceModuleUrl,
        importOrder: [builtModuleUrl, sourceModuleUrl],
      }),
    );

    expect(module["selected"]).toBe("built");
  });

  test("loads the add-ons package through an injected dev source resolver", async () => {
    const module = await loadBoundaryAddonPackage(
      async () =>
        (await import("../../../rielflow-addons/src/index")) as Readonly<
          Record<string, unknown>
        >,
    );

    expect(typeof module["resolveNodeAddonPayloadAsync"]).toBe("function");
    expect(typeof module["executeNativeNode"]).toBe("function");
  });

  test("falls back to the bundled package module when release entrypoints are absent", async () => {
    const module = await loadBoundaryAddonPackage(
      createBoundaryAddonPackageLoader({
        builtEntrypoint: new URL(
          "file:///missing-rielflow-addons/dist/index.js",
        ),
        sourceEntrypoint: new URL(
          "file:///missing-rielflow-addons/src/index.ts",
        ),
        fallbackModule: {
          selected: "bundled",
          resolveNodeAddonPayloadAsync: async () => ({ issues: [] }),
          executeNativeNode: async () => ({ ok: true }),
        },
      }),
    );

    expect(module["selected"]).toBe("bundled");
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
      /\/packages\/rielflow-addons\/dist\/index\.js$/,
    );
    expect(rootCliEntrypoints.sourceEntrypoint.pathname).toMatch(
      /\/packages\/rielflow-addons\/src\/index\.ts$/,
    );
    expect(packageCliEntrypoints.builtEntrypoint.pathname).toMatch(
      /\/packages\/rielflow-addons\/dist\/index\.js$/,
    );
    expect(packageCliEntrypoints.sourceEntrypoint.pathname).toMatch(
      /\/packages\/rielflow-addons\/src\/index\.ts$/,
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
