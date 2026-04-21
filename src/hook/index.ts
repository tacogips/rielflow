import { detectHookVendor } from "./detect-vendor";
import { dispatchHook } from "./dispatch";
import {
  resolveDivedraHookContext,
  resolveHookRecordingControls,
  type HookRecordingControls,
} from "./context";
import { HookBlockError } from "./handler";
import { parseHookPayload } from "./parse";
import { recordHookEvent, recordHookFailure } from "./recorder";
import type { HookResponse, HookVendor, ParsedHookContext } from "./types";
import type { LoadOptions } from "../workflow/types";

export interface HookCommandIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

export interface HookCommandDependencies {
  readonly readStdin: () => Promise<string>;
  readonly dispatchHook?: (ctx: ParsedHookContext) => Promise<HookResponse>;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly rootDataDir?: string;
  readonly artifactRoot?: string;
  readonly recordHookEvent?: typeof recordHookEvent;
  readonly recordHookFailure?: typeof recordHookFailure;
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

function hookRuntimeOptions(deps: HookCommandDependencies): LoadOptions & {
  readonly captureMode: HookRecordingControls["captureMode"];
} {
  const env = deps.env ?? process.env;
  const controls = resolveHookRecordingControls(env);
  return {
    env,
    cwd: deps.cwd ?? process.cwd(),
    ...(deps.rootDataDir === undefined
      ? {}
      : { rootDataDir: deps.rootDataDir }),
    ...(deps.artifactRoot === undefined
      ? {}
      : { artifactRoot: deps.artifactRoot }),
    captureMode: controls.captureMode,
  };
}

function recordingErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "unknown hook recording error";
}

async function recordSuccess(input: {
  readonly deps: HookCommandDependencies;
  readonly context: ParsedHookContext;
  readonly response: HookResponse;
  readonly controls: HookRecordingControls;
  readonly io: HookCommandIo;
}): Promise<number | undefined> {
  try {
    await (input.deps.recordHookEvent ?? recordHookEvent)(
      { ctx: input.context, response: input.response },
      hookRuntimeOptions(input.deps),
    );
    return undefined;
  } catch (error: unknown) {
    if (input.controls.strict) {
      input.io.stderr(recordingErrorMessage(error));
      return 1;
    }
    input.io.stderr(`hook recording failed: ${recordingErrorMessage(error)}`);
    return undefined;
  }
}

async function recordFailure(input: {
  readonly deps: HookCommandDependencies;
  readonly context: ParsedHookContext;
  readonly error: unknown;
  readonly controls: HookRecordingControls;
  readonly io: HookCommandIo;
}): Promise<number | undefined> {
  try {
    await (input.deps.recordHookFailure ?? recordHookFailure)(
      input.context,
      input.error,
      hookRuntimeOptions(input.deps),
    );
    return undefined;
  } catch (recordError: unknown) {
    if (input.controls.strict) {
      input.io.stderr(recordingErrorMessage(recordError));
      return 1;
    }
    input.io.stderr(
      `hook recording failed: ${recordingErrorMessage(recordError)}`,
    );
    return undefined;
  }
}

export async function runHookCommand(input: {
  readonly deps: HookCommandDependencies;
  readonly explicitVendor?: HookVendor;
  readonly io: HookCommandIo;
}): Promise<number> {
  let context: ParsedHookContext | undefined;
  let controls: HookRecordingControls | undefined;
  try {
    const rawStdin = await input.deps.readStdin();
    const parsed = parseHookPayload(rawStdin);
    const env = input.deps.env ?? process.env;
    controls = resolveHookRecordingControls(env);
    const vendor = detectHookVendor({
      payload: parsed.payload,
      eventName: parsed.eventName,
      ...(input.explicitVendor === undefined
        ? {}
        : { explicitVendor: input.explicitVendor }),
    });
    const divedra = resolveDivedraHookContext({
      payload: parsed.payload,
      env,
      controls,
    });
    context = {
      vendor,
      eventName: parsed.eventName,
      rawEventName: parsed.rawEventName,
      payload: parsed.payload,
      ...(divedra === undefined ? {} : { divedra }),
    } satisfies ParsedHookContext;
    const response = await (input.deps.dispatchHook ?? dispatchHook)(context);
    const recordingExit = await recordSuccess({
      deps: input.deps,
      context,
      response,
      controls,
      io: input.io,
    });
    if (recordingExit !== undefined) {
      return recordingExit;
    }
    input.io.stdout(JSON.stringify(response));
    return 0;
  } catch (error: unknown) {
    if (context !== undefined && controls !== undefined) {
      const recordingExit = await recordFailure({
        deps: input.deps,
        context,
        error,
        controls,
        io: input.io,
      });
      if (recordingExit !== undefined) {
        return recordingExit;
      }
    }
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
