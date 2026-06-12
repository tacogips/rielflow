import Foundation
import RielflowCore

public struct WorkflowMockScenario: Equatable, Sendable {
  public var responses: [String: [MockNodeResponse]]

  public init(responses: [String: [MockNodeResponse]]) {
    self.responses = responses
  }
}

public struct MockNodeResponse: Codable, Equatable, Sendable {
  public var provider: String?
  public var model: String?
  public var promptText: String?
  public var completionPassed: Bool?
  public var when: [String: Bool]?
  public var payload: JSONObject?
  public var fail: Bool?

  public init(
    provider: String? = nil,
    model: String? = nil,
    promptText: String? = nil,
    completionPassed: Bool? = nil,
    when: [String: Bool]? = nil,
    payload: JSONObject? = nil,
    fail: Bool? = nil
  ) {
    self.provider = provider
    self.model = model
    self.promptText = promptText
    self.completionPassed = completionPassed
    self.when = when
    self.payload = payload
    self.fail = fail
  }
}

public protocol MockScenarioLoading: Sendable {
  func loadScenario(at path: String) throws -> WorkflowMockScenario
}

public struct WorkflowMockScenarioLoader: MockScenarioLoading {
  public init() {}

  public func loadScenario(at path: String) throws -> WorkflowMockScenario {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    let decoded = try JSONDecoder().decode(DecodableWorkflowMockScenario.self, from: data)
    return decoded.scenario
  }
}

public actor ScenarioNodeAdapter: NodeAdapter {
  private let scenario: WorkflowMockScenario
  private let fallback: any NodeAdapter

  public init(scenario: WorkflowMockScenario, fallback: any NodeAdapter = DeterministicLocalNodeAdapter()) {
    self.scenario = scenario
    self.fallback = fallback
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    guard let sequence = scenario.responses[input.node.id] else {
      return try await fallback.execute(input, context: context)
    }
    let sequenceIndex = scenarioSequenceIndex(for: input)
    let response = sequence.isEmpty ? MockNodeResponse() : sequence[min(sequenceIndex - 1, sequence.count - 1)]
    if response.fail == true {
      throw AdapterExecutionError(.providerError, "scenario forced failure for node '\(input.node.id)'")
    }
    return AdapterExecutionOutput(
      provider: response.provider ?? "scenario-mock",
      model: response.model ?? input.node.model,
      promptText: response.promptText ?? input.promptText,
      completionPassed: response.completionPassed ?? true,
      when: response.when ?? ["always": true],
      payload: response.payload ?? [:]
    )
  }

  private func scenarioSequenceIndex(for input: AdapterExecutionInput) -> Int {
    guard let output = input.output else {
      return max(1, input.executionIndex)
    }
    return max(1, (input.executionIndex - 1) * output.maxValidationAttempts + output.attempt)
  }
}

private struct DecodableWorkflowMockScenario: Decodable {
  var scenario: WorkflowMockScenario

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    let raw = try container.decode([String: ScenarioEntry].self)
    var responses: [String: [MockNodeResponse]] = [:]
    for (key, entry) in raw {
      switch entry {
      case let .single(response):
        responses[key] = [response]
      case let .sequence(sequence):
        responses[key] = sequence
      }
    }
    scenario = WorkflowMockScenario(responses: responses)
  }
}

private enum ScenarioEntry: Decodable {
  case single(MockNodeResponse)
  case sequence([MockNodeResponse])

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let sequence = try? container.decode([MockNodeResponse].self) {
      self = .sequence(sequence)
      return
    }
    self = .single(try container.decode(MockNodeResponse.self))
  }
}
