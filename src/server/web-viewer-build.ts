import type { BuildArtifact, BunPlugin } from "bun";

interface BabelSolidTransformDependencies {
  readonly transformAsync: (
    code: string,
    options: {
      readonly filename: string;
      readonly presets: readonly unknown[];
      readonly sourceMaps: false;
    },
  ) => Promise<{ readonly code?: string | null } | null>;
  readonly solidPreset: unknown;
  readonly typescriptPreset: unknown;
}

interface WorkflowViewerAssetBuildOptions {
  readonly entrypoint: string;
  readonly outdir: string;
  readonly minify: boolean;
}

let babelSolidTransformDependencies:
  | Promise<BabelSolidTransformDependencies>
  | undefined;

async function loadBabelSolidTransformDependencies(): Promise<BabelSolidTransformDependencies> {
  babelSolidTransformDependencies ??= Promise.all([
    import("@babel/core"),
    import("babel-preset-solid"),
    import("@babel/preset-typescript"),
  ]).then(([babelCore, solidPreset, typescriptPreset]) => ({
    transformAsync: babelCore.transformAsync,
    solidPreset: solidPreset.default,
    typescriptPreset: typescriptPreset.default,
  }));

  return babelSolidTransformDependencies;
}

function createSolidBrowserTransformPlugin(): BunPlugin {
  return {
    name: "divedra-solid-browser-transform",
    setup: (build) => {
      build.onLoad(
        { filter: /[/\\]src[/\\]web[/\\].*\.tsx$/ },
        async (args) => {
          const code = await Bun.file(args.path).text();
          const deps = await loadBabelSolidTransformDependencies();
          const transformed = await deps.transformAsync(code, {
            filename: args.path,
            presets: [
              [
                deps.solidPreset,
                {
                  generate: "dom",
                  moduleName: "solid-js/web",
                },
              ],
              [
                deps.typescriptPreset,
                {
                  allExtensions: true,
                  isTSX: true,
                },
              ],
            ],
            sourceMaps: false,
          });

          return {
            contents: transformed?.code ?? "",
            loader: "js",
          };
        },
      );
    },
  };
}

function formatBuildLogs(
  logs: readonly { readonly message: string }[],
): string {
  const message = logs
    .map((entry) => entry.message)
    .join("\n")
    .trim();
  return message.length > 0 ? message : "Bun.build returned no diagnostic logs";
}

async function buildWorkflowViewerClientBundle(options: {
  readonly entrypoint: string;
  readonly minify: boolean;
  readonly outdir?: string;
}): Promise<readonly BuildArtifact[]> {
  const result = await Bun.build({
    entrypoints: [options.entrypoint],
    target: "browser",
    minify: options.minify,
    sourcemap: "none",
    plugins: [createSolidBrowserTransformPlugin()],
    ...(options.outdir === undefined ? {} : { outdir: options.outdir }),
  });

  if (!result.success) {
    throw new Error(
      `failed to build workflow viewer asset: ${formatBuildLogs(result.logs)}`,
    );
  }

  return result.outputs;
}

function findJavascriptOutput(
  outputs: readonly BuildArtifact[],
): BuildArtifact {
  const output =
    outputs.find((candidate) => candidate.path.endsWith(".js")) ?? outputs[0];
  if (output === undefined) {
    throw new Error("failed to build workflow viewer asset: no output");
  }
  return output;
}

export async function buildWorkflowViewerClientScriptFromSource(
  entrypoint: string,
): Promise<string> {
  const outputs = await buildWorkflowViewerClientBundle({
    entrypoint,
    minify: false,
  });
  return findJavascriptOutput(outputs).text();
}

export async function buildWorkflowViewerClientAsset(
  options: WorkflowViewerAssetBuildOptions,
): Promise<void> {
  await buildWorkflowViewerClientBundle(options);
}
