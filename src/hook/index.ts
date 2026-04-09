import { detectHookVendor } from "./detect-vendor";
import { dispatchHook } from "./dispatch";
import { HookBlockError } from "./handler";
import { parseHookPayload } from "./parse";
import type { HookResponse, HookVendor, ParsedHookContext } from "./types";

export interface HookCommandIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface HookCommandDependencies {
  readonly readStdin: () => Promise<string>;
  readonly dispatchHook?: (ctx: ParsedHookContext) => Promise<HookResponse>;
}

async function readHookStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const readable = stream as NodeJS.ReadableStream & {
    setEncoding?: (encoding: BufferEncoding) => void;
  };
  readable.setEncoding?.("utf8");
  let output = "";
  for await (const chunk of readable) {
    if (typeof chunk === "string") {
      output += chunk;
      continue;
    }
    if (chunk instanceof Uint8Array) {
      output += new TextDecoder().decode(chunk);
      continue;
    }
    output += String(chunk);
  }
  return output;
}

export function createReadHookStdin(
  stream: NodeJS.ReadableStream,
): HookCommandDependencies["readStdin"] {
  return () => readHookStdin(stream);
}

export async function runHookCommand(input: {
  readonly deps: HookCommandDependencies;
  readonly explicitVendor?: HookVendor;
  readonly io: HookCommandIo;
}): Promise<number> {
  try {
    const rawStdin = await input.deps.readStdin();
    const parsed = parseHookPayload(rawStdin);
    const vendor = detectHookVendor({
      payload: parsed.payload,
      eventName: parsed.eventName,
      ...(input.explicitVendor === undefined
        ? {}
        : { explicitVendor: input.explicitVendor }),
    });
    const context = {
      vendor,
      eventName: parsed.eventName,
      rawEventName: parsed.rawEventName,
      payload: parsed.payload,
    } satisfies ParsedHookContext;
    const response = await (input.deps.dispatchHook ?? dispatchHook)(context);
    input.io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    if (error instanceof HookBlockError) {
      input.io.stderr(error.reason);
      return 2;
    }
    const message =
      error instanceof Error ? error.message : "unknown hook error";
    input.io.stderr(message);
    return 1;
  }
}
