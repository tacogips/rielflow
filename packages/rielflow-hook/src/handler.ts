import type { HookResponse, ParsedHookContext } from "./types";

export interface HookHandler {
  handle(ctx: ParsedHookContext): Promise<HookResponse>;
}

export class NoopHookHandler implements HookHandler {
  async handle(_ctx: ParsedHookContext): Promise<HookResponse> {
    return {};
  }
}

export class HookBlockError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HookBlockError";
    this.reason = reason;
  }
}
