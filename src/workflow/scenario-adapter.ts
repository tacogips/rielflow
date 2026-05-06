import {
  DeterministicNodeAdapter,
  type AdapterBackendSessionOutput,
  type AdapterExecutionInput,
  type AdapterExecutionOutput,
  type AdapterExecutionContext,
  type NodeAdapter,
} from "./adapter";

export interface MockNodeResponse {
  readonly provider?: string;
  readonly model?: string;
  readonly promptText?: string;
  readonly completionPassed?: boolean;
  readonly when?: Readonly<Record<string, boolean>>;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly backendSession?: AdapterBackendSessionOutput;
  readonly fail?: boolean;
}

export type MockNodeScenarioEntry =
  | MockNodeResponse
  | readonly MockNodeResponse[];
export type MockNodeScenario = Readonly<Record<string, MockNodeScenarioEntry>>;

function resolveScenarioEntry(
  entry: MockNodeScenarioEntry,
  attemptIndex: number,
): MockNodeResponse {
  if (Array.isArray(entry)) {
    if (entry.length === 0) {
      return {};
    }
    const selected = entry[Math.min(attemptIndex - 1, entry.length - 1)];
    return selected ?? {};
  }
  return entry as MockNodeResponse;
}

function resolveScenarioSequenceIndex(input: AdapterExecutionInput): number {
  if (input.output === undefined) {
    return input.executionIndex;
  }
  return (
    (input.executionIndex - 1) * input.output.maxValidationAttempts +
    input.output.attempt
  );
}

export class ScenarioNodeAdapter implements NodeAdapter {
  readonly #fallback: NodeAdapter;
  readonly #scenario: MockNodeScenario;

  constructor(
    scenario: MockNodeScenario,
    fallback: NodeAdapter = new DeterministicNodeAdapter(),
  ) {
    this.#scenario = scenario;
    this.#fallback = fallback;
  }

  async execute(
    input: AdapterExecutionInput,
    context: AdapterExecutionContext,
  ): Promise<AdapterExecutionOutput> {
    const scenarioEntry = this.#scenario[input.nodeId];
    if (scenarioEntry === undefined) {
      return this.#fallback.execute(input, context);
    }

    const sequenceIndex = resolveScenarioSequenceIndex(input);
    const response = resolveScenarioEntry(scenarioEntry, sequenceIndex);
    if (response.fail === true) {
      throw new Error(`scenario forced failure for node '${input.nodeId}'`);
    }

    return {
      provider: response.provider ?? "scenario-mock",
      model: response.model ?? input.node.model,
      promptText: response.promptText ?? input.promptText,
      completionPassed: response.completionPassed ?? true,
      when: response.when ?? { always: true },
      payload: response.payload ?? {},
      ...(response.backendSession === undefined
        ? {}
        : { backendSession: response.backendSession }),
    };
  }
}
