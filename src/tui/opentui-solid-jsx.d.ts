import type { JSX as OpenTuiJSX } from "@opentui/solid";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements extends OpenTuiJSX.IntrinsicElements {}
  }
}
