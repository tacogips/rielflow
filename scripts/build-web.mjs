import path from "node:path";
import { buildWorkflowViewerClientAsset } from "../src/server/web-viewer-build.ts";

const entrypoint = path.resolve(
  import.meta.dirname,
  "../src/web/workflow-viewer.tsx",
);
const outdir = path.resolve(import.meta.dirname, "../dist/web");

await buildWorkflowViewerClientAsset({
  entrypoint,
  outdir,
  minify: true,
});
