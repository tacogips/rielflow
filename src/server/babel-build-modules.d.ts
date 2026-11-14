declare module "@babel/core" {
  export interface BabelFileResult {
    readonly code?: string | null;
  }

  export interface TransformOptions {
    readonly filename?: string;
    readonly presets?: readonly unknown[];
    readonly sourceMaps?: boolean;
  }

  export function transformAsync(
    code: string,
    options?: TransformOptions,
  ): Promise<BabelFileResult | null>;
}

declare module "@babel/preset-typescript" {
  const preset: unknown;
  export default preset;
}

declare module "babel-preset-solid" {
  const preset: unknown;
  export default preset;
}
