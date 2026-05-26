// Add-ons package contract: own add-on resolution and expose native execution
// compatibility until native executor internals move behind this package.
export * from "./node-addons";
export * from "./local-node-addons";
export * from "./addon-source-summary";
export * from "./mailbox-prompt-guidance";
export {
  isGatewayReadinessAddon,
  type GatewayReadinessAddon,
} from "./runtime-readiness";
export {
  executeAddonNode,
  executeNativeNode,
} from "./native-node-executor/git-and-addon-execution";
export { isContainerRunnerWithDockerCli } from "./native-node-executor/template-env-and-containers";
