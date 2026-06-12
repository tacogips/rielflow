import Foundation

public enum AdapterExecutionErrorCode: String, Codable, Sendable {
  case providerError = "provider_error"
  case policyBlocked = "policy_blocked"
  case timeout
  case invalidOutput = "invalid_output"
}

public struct AdapterExecutionError: Error, Equatable, Sendable {
  public var code: AdapterExecutionErrorCode
  public var message: String

  public init(_ code: AdapterExecutionErrorCode, _ message: String) {
    self.code = code
    self.message = message
  }
}

public struct AdapterExecutionInput: Codable, Equatable, Sendable {
  public var node: AgentNodePayload
  public var promptText: String
  public var systemPromptText: String?
  public var arguments: JSONObject
  public var mergedVariables: JSONObject
  public var executionIndex: Int
  public var output: AdapterOutputAttemptContext?

  public init(
    node: AgentNodePayload,
    promptText: String,
    systemPromptText: String? = nil,
    arguments: JSONObject = [:],
    mergedVariables: JSONObject = [:],
    executionIndex: Int = 1,
    output: AdapterOutputAttemptContext? = nil
  ) {
    self.node = node
    self.promptText = promptText
    self.systemPromptText = systemPromptText
    self.arguments = arguments
    self.mergedVariables = mergedVariables
    self.executionIndex = executionIndex
    self.output = output
  }
}

public struct AdapterExecutionContext: Sendable {
  public var deadline: Date?

  public init(deadline: Date? = nil) {
    self.deadline = deadline
  }
}

public struct AdapterOutputAttemptContext: Codable, Equatable, Sendable {
  public var maxValidationAttempts: Int
  public var attempt: Int

  public init(maxValidationAttempts: Int, attempt: Int) {
    self.maxValidationAttempts = maxValidationAttempts
    self.attempt = attempt
  }
}

public struct AdapterExecutionOutput: Codable, Equatable, Sendable {
  public var provider: String
  public var model: String
  public var promptText: String
  public var completionPassed: Bool
  public var when: [String: Bool]
  public var payload: JSONObject

  public init(
    provider: String,
    model: String,
    promptText: String,
    completionPassed: Bool,
    when: [String: Bool] = ["always": true],
    payload: JSONObject
  ) {
    self.provider = provider
    self.model = model
    self.promptText = promptText
    self.completionPassed = completionPassed
    self.when = when
    self.payload = payload
  }
}

public protocol NodeAdapter: Sendable {
  func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput
}

public func normalizeTextBusinessPayload(_ text: String) -> JSONObject {
  ["text": .string(text)]
}

public struct OutputContractEnvelopeNormalization: Equatable, Sendable {
  public var completionPassed: Bool
  public var when: [String: Bool]
  public var payload: JSONObject
  public var usedEnvelope: Bool

  public init(
    completionPassed: Bool,
    when: [String: Bool],
    payload: JSONObject,
    usedEnvelope: Bool
  ) {
    self.completionPassed = completionPassed
    self.when = when
    self.payload = payload
    self.usedEnvelope = usedEnvelope
  }
}

public func parseJSONObjectCandidate(_ text: String, source: String) throws -> JSONObject {
  let candidate = extractJSONObjectCandidateText(text)
  guard let data = candidate.data(using: .utf8) else {
    throw AdapterExecutionError(.invalidOutput, "\(source) must return a JSON object: text is not UTF-8")
  }

  let decoded: JSONValue
  do {
    decoded = try JSONDecoder().decode(JSONValue.self, from: data)
  } catch {
    throw AdapterExecutionError(.invalidOutput, "\(source) must return a JSON object: \(error.localizedDescription)")
  }

  guard case let .object(object) = decoded else {
    throw AdapterExecutionError(.invalidOutput, "\(source) must return a top-level JSON object")
  }
  return object
}

public func normalizeOutputContractEnvelope(
  _ value: JSONObject,
  source: String,
  defaults: (completionPassed: Bool, when: [String: Bool]) = (true, ["always": true])
) throws -> OutputContractEnvelopeNormalization {
  guard let whenValue = value["when"] else {
    return OutputContractEnvelopeNormalization(
      completionPassed: defaults.completionPassed,
      when: defaults.when,
      payload: value,
      usedEnvelope: false
    )
  }

  guard let when = booleanMap(from: whenValue) else {
    throw AdapterExecutionError(.invalidOutput, "\(source).when must be an object<boolean> when provided")
  }

  guard let payloadValue = value["payload"], case let .object(payload) = payloadValue else {
    throw AdapterExecutionError(.invalidOutput, "\(source).payload must be an object when when is provided")
  }

  let completionPassed: Bool
  if let completionPassedValue = value["completionPassed"] {
    guard case let .bool(value) = completionPassedValue else {
      throw AdapterExecutionError(.invalidOutput, "\(source).completionPassed must be a boolean when provided")
    }
    completionPassed = value
  } else {
    completionPassed = defaults.completionPassed
  }

  return OutputContractEnvelopeNormalization(
    completionPassed: completionPassed,
    when: when,
    payload: payload,
    usedEnvelope: true
  )
}

private func booleanMap(from value: JSONValue) -> [String: Bool]? {
  guard case let .object(object) = value else {
    return nil
  }
  var map: [String: Bool] = [:]
  for (key, entry) in object {
    guard case let .bool(boolValue) = entry else {
      return nil
    }
    map[key] = boolValue
  }
  return map
}

private func extractJSONObjectCandidateText(_ text: String) -> String {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty {
    return trimmed
  }
  if isCompleteJSON(trimmed) {
    return trimmed
  }
  if trimmed.hasPrefix("{"), let candidate = extractBalancedJSONObject(from: trimmed, start: trimmed.startIndex) {
    return candidate
  }
  if let fenced = extractFirstFencedJSONBlock(from: trimmed) {
    return fenced
  }
  if let embedded = findFirstJSONObjectCandidate(in: trimmed) {
    return embedded
  }
  return trimmed
}

private func isCompleteJSON(_ text: String) -> Bool {
  guard let data = text.data(using: .utf8) else {
    return false
  }
  return (try? JSONSerialization.jsonObject(with: data)) != nil
}

private func extractFirstFencedJSONBlock(from text: String) -> String? {
  let pattern = #"```(?:json)?\s*([\s\S]*?)\s*```"#
  guard let regex = try? NSRegularExpression(pattern: pattern) else {
    return nil
  }
  let range = NSRange(text.startIndex..<text.endIndex, in: text)
  guard
    let match = regex.firstMatch(in: text, range: range),
    let contentRange = Range(match.range(at: 1), in: text)
  else {
    return nil
  }
  return String(text[contentRange]).trimmingCharacters(in: .whitespacesAndNewlines)
}

private func findFirstJSONObjectCandidate(in text: String) -> String? {
  var searchIndex = text.startIndex
  while searchIndex < text.endIndex {
    guard let objectStart = text[searchIndex...].firstIndex(of: "{") else {
      return nil
    }
    if let candidate = extractBalancedJSONObject(from: text, start: objectStart), isJSONObjectText(candidate) {
      return candidate
    }
    searchIndex = text.index(after: objectStart)
  }
  return nil
}

private func isJSONObjectText(_ text: String) -> Bool {
  guard let data = text.data(using: .utf8) else {
    return false
  }
  guard let value = try? JSONSerialization.jsonObject(with: data) else {
    return false
  }
  return value is [String: Any]
}

private func extractBalancedJSONObject(from text: String, start: String.Index) -> String? {
  var depth = 0
  var inString = false
  var escaped = false
  var index = start

  while index < text.endIndex {
    let character = text[index]

    if inString {
      if escaped {
        escaped = false
      } else if character == "\\" {
        escaped = true
      } else if character == "\"" {
        inString = false
      }
      index = text.index(after: index)
      continue
    }

    if character == "\"" {
      inString = true
    } else if character == "{" {
      depth += 1
    } else if character == "}" {
      depth -= 1
      if depth == 0 {
        return String(text[start...index])
      }
    }
    index = text.index(after: index)
  }

  return nil
}
