import type {
  ResolvedMailGatewayAddon,
  ResolvedMailGatewayReadAddon,
  ResolvedNodeAddon,
  ResolvedXGatewayAddon,
  ResolvedXGatewayReadAddon,
} from "../../rielflow-core/src/index";
import {
  MAIL_GATEWAY_ADDON_NAME,
  MAIL_GATEWAY_READ_ADDON_NAME,
  X_GATEWAY_ADDON_NAME,
  X_GATEWAY_READ_ADDON_NAME,
} from "./node-addons/addon-constants-and-agent-config";

export {
  MAIL_GATEWAY_ADDON_NAME,
  MAIL_GATEWAY_READ_ADDON_NAME,
  X_GATEWAY_ADDON_NAME,
  X_GATEWAY_READ_ADDON_NAME,
};

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
