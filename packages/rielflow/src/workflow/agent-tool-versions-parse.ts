export interface AgentToolVersionsParseResult {
  readonly available: boolean;
  readonly commandSummary: string;
}

export function parseAgentToolVersionsOutput(input: {
  readonly stdout: string;
  readonly requiredTool: string;
  readonly agentLabel: string;
}): AgentToolVersionsParseResult {
  try {
    const parsed = JSON.parse(input.stdout) as {
      readonly agent?: string;
      readonly tools?: Readonly<
        Record<string, { version: string | null; error: string | null }>
      >;
    };
    const requiredTool = parsed.tools?.[input.requiredTool];
    const available =
      requiredTool?.version !== null && requiredTool?.version !== undefined;
    const toolSummary = Object.entries(parsed.tools ?? {})
      .map(([name, value]) =>
        value.version === null
          ? `${name}=${value.error ?? "unavailable"}`
          : `${name}=${value.version}`,
      )
      .join(", ");
    return {
      available,
      commandSummary:
        `agent=${parsed.agent ?? "unknown"}` +
        (toolSummary.length === 0 ? "" : `, ${toolSummary}`),
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "unknown JSON parse error";
    return {
      available: false,
      commandSummary: `${input.agentLabel} version output was invalid JSON: ${message}`,
    };
  }
}
