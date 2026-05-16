import type {
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedNodeAddon,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
} from "../../divedra-core/src/index";

function builtinAddonName(parts: readonly string[]): string {
  return ["divedra", parts.join("-")].join("/");
}

export const X_GATEWAY_READ_ADDON_NAME = builtinAddonName([
  "x",
  "gateway",
  "read",
]);
export const X_GATEWAY_ADDON_NAME = builtinAddonName(["x", "gateway"]);
export const MAIL_GATEWAY_READ_ADDON_NAME = builtinAddonName([
  "mail",
  "gateway",
  "read",
]);
export const MAIL_GATEWAY_ADDON_NAME = builtinAddonName(["mail", "gateway"]);

export type GatewayReadinessAddon =
  | ResolvedXGatewayReadAddon
  | ResolvedXGatewayAddon
  | ResolvedMailGatewayReadAddon
  | ResolvedMailGatewayAddon;

export function isGatewayReadinessAddon(
  addon: ResolvedNodeAddon | undefined,
): addon is GatewayReadinessAddon {
  return (
    addon?.name === X_GATEWAY_READ_ADDON_NAME ||
    addon?.name === X_GATEWAY_ADDON_NAME ||
    addon?.name === MAIL_GATEWAY_READ_ADDON_NAME ||
    addon?.name === MAIL_GATEWAY_ADDON_NAME
  );
}
