import { NoopHookHandler, type HookHandler } from "./handler";
import {
  type HookResponse,
  KNOWN_HOOK_EVENT_NAMES,
  type ParsedHookContext,
  SUPPORTED_HOOK_VENDORS,
} from "./types";

export type HandlerKey =
  `${(typeof SUPPORTED_HOOK_VENDORS)[number]}:${(typeof KNOWN_HOOK_EVENT_NAMES)[number] | "Unknown"}`;
export type HandlerRegistry = ReadonlyMap<HandlerKey, HookHandler>;

const NOOP_HANDLER = new NoopHookHandler();
const DEFAULT_HANDLER_REGISTRY = new Map<HandlerKey, HookHandler>(
  SUPPORTED_HOOK_VENDORS.flatMap((vendor) =>
    KNOWN_HOOK_EVENT_NAMES.map((eventName) => [
      buildHandlerKey(vendor, eventName),
      NOOP_HANDLER,
    ]),
  ),
);

function buildHandlerKey(
  vendor: ParsedHookContext["vendor"],
  eventName: ParsedHookContext["eventName"],
): HandlerKey {
  return `${vendor}:${eventName}`;
}

export async function dispatchHook(
  ctx: ParsedHookContext,
  options: {
    readonly registry?: HandlerRegistry;
  } = {},
): Promise<HookResponse> {
  const registry = options.registry ?? DEFAULT_HANDLER_REGISTRY;
  const handler = registry.get(buildHandlerKey(ctx.vendor, ctx.eventName));
  if (handler !== undefined) {
    return handler.handle(ctx);
  }
  return NOOP_HANDLER.handle(ctx);
}
