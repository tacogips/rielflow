import Foundation
import RielflowCore

public struct OfficialSDKAdapterConfiguration: Sendable {
  public var apiKeyEnv: String?
  public var baseURL: URL?
  public var retryPolicy: RetryPolicy
  public var environment: [String: String]?
  public var requestExecutor: (any OfficialSDKRequestExecuting)?
  public var httpTransport: (any OfficialSDKHTTPTransporting)?

  public init(
    apiKeyEnv: String? = nil,
    baseURL: URL? = nil,
    retryPolicy: RetryPolicy = RetryPolicy(),
    environment: [String: String]? = nil,
    requestExecutor: (any OfficialSDKRequestExecuting)? = nil,
    httpTransport: (any OfficialSDKHTTPTransporting)? = nil
  ) {
    self.apiKeyEnv = apiKeyEnv
    self.baseURL = baseURL
    self.retryPolicy = retryPolicy
    self.environment = environment
    self.requestExecutor = requestExecutor
    self.httpTransport = httpTransport
  }
}

public struct AnthropicSDKAdapterConfiguration: Sendable {
  public var officialSDK: OfficialSDKAdapterConfiguration
  public var maxTokens: Int

  public init(
    officialSDK: OfficialSDKAdapterConfiguration = OfficialSDKAdapterConfiguration(),
    maxTokens: Int = 1024
  ) {
    self.officialSDK = officialSDK
    self.maxTokens = max(1, maxTokens)
  }
}

public protocol OfficialSDKRequestExecuting: Sendable {
  func executeSDKRequest(_ request: OfficialSDKRequest, context: AdapterExecutionContext) async throws -> OfficialSDKResponse
}

public protocol OfficialSDKHTTPTransporting: Sendable {
  func data(for request: URLRequest) async throws -> OfficialSDKHTTPResponse
}

public struct OfficialSDKRequest: Equatable, Sendable {
  public var provider: String
  public var apiKey: String
  public var baseURL: URL?
  public var body: OfficialSDKRequestBody

  public init(provider: String, apiKey: String, baseURL: URL? = nil, body: OfficialSDKRequestBody) {
    self.provider = provider
    self.apiKey = apiKey
    self.baseURL = baseURL
    self.body = body
  }
}

public enum OfficialSDKRequestBody: Equatable, Sendable {
  case openAIResponses(OpenAIResponsesRequest)
  case anthropicMessages(AnthropicMessagesRequest)
}

public struct OpenAIResponsesRequest: Equatable, Sendable {
  public var model: String
  public var input: String
  public var instructions: String?

  public init(model: String, input: String, instructions: String? = nil) {
    self.model = model
    self.input = input
    self.instructions = instructions
  }
}

public struct AnthropicMessagesRequest: Equatable, Sendable {
  public var model: String
  public var maxTokens: Int
  public var system: String?
  public var messages: [AnthropicMessage]

  public init(model: String, maxTokens: Int, system: String? = nil, messages: [AnthropicMessage]) {
    self.model = model
    self.maxTokens = max(1, maxTokens)
    self.system = system
    self.messages = messages
  }
}

public struct AnthropicMessage: Equatable, Sendable {
  public var role: String
  public var content: String

  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}

public struct OfficialSDKResponse: Equatable, Sendable {
  public var body: JSONValue

  public init(body: JSONValue) {
    self.body = body
  }
}

public struct OfficialSDKHTTPResponse: Equatable, Sendable {
  public var statusCode: Int
  public var body: Data

  public init(statusCode: Int, body: Data) {
    self.statusCode = statusCode
    self.body = body
  }
}

public struct URLSessionOfficialSDKHTTPTransport: OfficialSDKHTTPTransporting {
  public init() {}

  public func data(for request: URLRequest) async throws -> OfficialSDKHTTPResponse {
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw AdapterExecutionError(.providerError, "official SDK request did not return an HTTP response")
    }
    return OfficialSDKHTTPResponse(statusCode: httpResponse.statusCode, body: data)
  }
}

public struct URLSessionOfficialSDKRequestExecutor: OfficialSDKRequestExecuting {
  public var transport: any OfficialSDKHTTPTransporting

  public init(transport: any OfficialSDKHTTPTransporting = URLSessionOfficialSDKHTTPTransport()) {
    self.transport = transport
  }

  public func executeSDKRequest(_ request: OfficialSDKRequest, context: AdapterExecutionContext) async throws -> OfficialSDKResponse {
    let urlRequest = try makeURLRequest(for: request)
    let response = try await transport.data(for: urlRequest)
    guard (200...299).contains(response.statusCode) else {
      let detail = String(data: response.body, encoding: .utf8) ?? ""
      throw AdapterExecutionError(
        .providerError,
        "\(request.provider) request failed with HTTP \(response.statusCode): \(redactOfficialSDKSensitiveText(detail, sensitiveValues: [request.apiKey]))"
      )
    }

    let decoded = try JSONDecoder().decode(JSONValue.self, from: response.body)
    return OfficialSDKResponse(body: decoded)
  }
}

public struct OpenAiSDKAdapter: NodeAdapter {
  public static let provider = "official-openai-sdk"
  private static let defaultApiKeyEnv = "OPENAI_API_KEY"

  public var configuration: OfficialSDKAdapterConfiguration

  public init(configuration: OfficialSDKAdapterConfiguration = OfficialSDKAdapterConfiguration()) {
    self.configuration = configuration
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    let request = try makeOfficialSDKRequest(
      provider: Self.provider,
      configuration: configuration,
      defaultApiKeyEnv: Self.defaultApiKeyEnv,
      missingApiKeyMessage: "missing OpenAI API key",
      body: .openAIResponses(
        OpenAIResponsesRequest(
          model: input.node.model,
          input: input.promptText,
          instructions: input.systemPromptText
        )
      )
    )

    return try await executeOfficialSDKRequest(
      adapterInput: input,
      context: context,
      configuration: configuration,
      request: request,
      responseLabel: "official OpenAI SDK response",
      timeoutMessage: "official OpenAI SDK request aborted",
      fallbackFailureMessage: "unknown OpenAI SDK failure",
      extractText: extractOpenAIText
    )
  }
}

public struct AnthropicSDKAdapter: NodeAdapter {
  public static let provider = "official-anthropic-sdk"
  private static let defaultApiKeyEnv = "ANTHROPIC_API_KEY"

  public var configuration: AnthropicSDKAdapterConfiguration

  public init(configuration: AnthropicSDKAdapterConfiguration = AnthropicSDKAdapterConfiguration()) {
    self.configuration = configuration
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    let request = try makeOfficialSDKRequest(
      provider: Self.provider,
      configuration: configuration.officialSDK,
      defaultApiKeyEnv: Self.defaultApiKeyEnv,
      missingApiKeyMessage: "missing Anthropic API key",
      body: .anthropicMessages(
        AnthropicMessagesRequest(
          model: input.node.model,
          maxTokens: configuration.maxTokens,
          system: input.systemPromptText,
          messages: [AnthropicMessage(role: "user", content: input.promptText)]
        )
      )
    )

    return try await executeOfficialSDKRequest(
      adapterInput: input,
      context: context,
      configuration: configuration.officialSDK,
      request: request,
      responseLabel: "official Anthropic SDK response",
      timeoutMessage: "official Anthropic SDK request aborted",
      fallbackFailureMessage: "unknown Anthropic SDK failure",
      extractText: extractAnthropicText
    )
  }
}

private func makeOfficialSDKRequest(
  provider: String,
  configuration: OfficialSDKAdapterConfiguration,
  defaultApiKeyEnv: String,
  missingApiKeyMessage: String,
  body: OfficialSDKRequestBody
) throws -> OfficialSDKRequest {
  let environment = configuration.environment ?? ProcessInfo.processInfo.environment
  let envName = configuration.apiKeyEnv ?? defaultApiKeyEnv
  guard let apiKey = environment[envName], !apiKey.isEmpty else {
    throw AdapterExecutionError(.policyBlocked, missingApiKeyMessage)
  }

  return OfficialSDKRequest(
    provider: provider,
    apiKey: apiKey,
    baseURL: configuration.baseURL,
    body: body
  )
}

private func executeOfficialSDKRequest(
  adapterInput: AdapterExecutionInput,
  context: AdapterExecutionContext,
  configuration: OfficialSDKAdapterConfiguration,
  request: OfficialSDKRequest,
  responseLabel: String,
  timeoutMessage: String,
  fallbackFailureMessage: String,
  extractText: @Sendable @escaping (JSONValue) -> String
) async throws -> AdapterExecutionOutput {
  let executor = configuration.requestExecutor ?? URLSessionOfficialSDKRequestExecutor(
    transport: configuration.httpTransport ?? URLSessionOfficialSDKHTTPTransport()
  )
  let response = try await retryOfficialSDKRequest(
    policy: configuration.retryPolicy,
    deadline: context.deadline,
    timeoutMessage: timeoutMessage,
    fallbackFailureMessage: fallbackFailureMessage,
    sensitiveValues: [request.apiKey]
  ) {
    try await executor.executeSDKRequest(request, context: context)
  }

  let text = extractText(response.body)
  let normalized: OutputContractEnvelopeNormalization
  if adapterInput.node.output == nil {
    normalized = OutputContractEnvelopeNormalization(
      completionPassed: true,
      when: ["always": true],
      payload: normalizeTextBusinessPayload(text),
      usedEnvelope: false
    )
  } else {
    normalized = try normalizeOutputContractEnvelope(
      parseJSONObjectCandidate(text, source: responseLabel),
      source: responseLabel
    )
  }

  return AdapterExecutionOutput(
    provider: request.provider,
    model: adapterInput.node.model,
    promptText: adapterInput.promptText,
    completionPassed: normalized.completionPassed,
    when: normalized.when,
    payload: normalized.payload
  )
}

private func retryOfficialSDKRequest<T: Sendable>(
  policy: RetryPolicy,
  deadline: Date?,
  timeoutMessage: String,
  fallbackFailureMessage: String,
  sensitiveValues: [String],
  operation: @Sendable @escaping () async throws -> T
) async throws -> T {
  var attempt = 1
  while true {
    do {
      return try await runWithDeadline(deadline, timeoutMessage: timeoutMessage, operation: operation)
    } catch {
      let normalized = normalizeOfficialSDKFailure(
        error,
        timeoutMessage: timeoutMessage,
        fallbackFailureMessage: fallbackFailureMessage,
        sensitiveValues: sensitiveValues
      )
      if attempt >= policy.maxAttempts || !isRetryableOfficialSDKFailure(normalized) || deadlineHasPassed(deadline) {
        throw normalized
      }
    }

    attempt += 1
    do {
      try await runWithDeadline(deadline, timeoutMessage: timeoutMessage) {
        try await Task.sleep(for: policy.retryDelay)
      }
    } catch {
      throw normalizeOfficialSDKFailure(
        error,
        timeoutMessage: timeoutMessage,
        fallbackFailureMessage: fallbackFailureMessage,
        sensitiveValues: sensitiveValues
      )
    }
  }
}

private func runWithDeadline<T: Sendable>(
  _ deadline: Date?,
  timeoutMessage: String,
  operation: @Sendable @escaping () async throws -> T
) async throws -> T {
  guard let deadline else {
    return try await operation()
  }

  let interval = deadline.timeIntervalSinceNow
  guard interval > 0 else {
    throw AdapterExecutionError(.timeout, timeoutMessage)
  }

  return try await withThrowingTaskGroup(of: T.self) { group in
    group.addTask {
      try await operation()
    }
    group.addTask {
      try await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
      throw AdapterExecutionError(.timeout, timeoutMessage)
    }

    guard let result = try await group.next() else {
      throw AdapterExecutionError(.timeout, timeoutMessage)
    }
    group.cancelAll()
    return result
  }
}

private func normalizeOfficialSDKFailure(
  _ error: Error,
  timeoutMessage: String,
  fallbackFailureMessage: String,
  sensitiveValues: [String]
) -> AdapterExecutionError {
  if let adapterError = error as? AdapterExecutionError {
    let message = adapterError.code == .timeout ? timeoutMessage : adapterError.message
    return AdapterExecutionError(adapterError.code, redactOfficialSDKSensitiveText(message, sensitiveValues: sensitiveValues))
  }
  if error is CancellationError {
    return AdapterExecutionError(.timeout, timeoutMessage)
  }
  let normalized = normalizeAdapterFailure(error, fallbackMessage: fallbackFailureMessage)
  return AdapterExecutionError(
    normalized.code,
    redactOfficialSDKSensitiveText(normalized.message, sensitiveValues: sensitiveValues)
  )
}

private func isRetryableOfficialSDKFailure(_ error: AdapterExecutionError) -> Bool {
  error.code == .providerError || error.code == .timeout
}

private func deadlineHasPassed(_ deadline: Date?) -> Bool {
  guard let deadline else {
    return false
  }
  return deadline <= Date()
}

private func redactOfficialSDKSensitiveText(_ text: String, sensitiveValues: [String]) -> String {
  var redacted = redactAdapterSensitiveText(text)
  for value in sensitiveValues where !value.isEmpty {
    redacted = redacted.replacingOccurrences(of: value, with: "<redacted>")
  }
  return redacted
}

private func makeURLRequest(for request: OfficialSDKRequest) throws -> URLRequest {
  let endpoint: URL
  var body: JSONObject
  var headers: [String: String]

  switch request.body {
  case let .openAIResponses(openAIRequest):
    endpoint = officialSDKEndpoint(baseURL: request.baseURL, defaultBaseURL: "https://api.openai.com/v1", pathComponents: ["responses"])
    body = [
      "model": .string(openAIRequest.model),
      "input": .string(openAIRequest.input),
    ]
    if let instructions = openAIRequest.instructions {
      body["instructions"] = .string(instructions)
    }
    headers = [
      "Authorization": "Bearer \(request.apiKey)",
      "Content-Type": "application/json",
    ]
  case let .anthropicMessages(anthropicRequest):
    endpoint = officialSDKEndpoint(baseURL: request.baseURL, defaultBaseURL: "https://api.anthropic.com", pathComponents: ["v1", "messages"])
    body = [
      "model": .string(anthropicRequest.model),
      "max_tokens": .number(Double(anthropicRequest.maxTokens)),
      "messages": .array(anthropicRequest.messages.map { message in
        .object([
          "role": .string(message.role),
          "content": .string(message.content),
        ])
      }),
    ]
    if let system = anthropicRequest.system {
      body["system"] = .string(system)
    }
    headers = [
      "x-api-key": request.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    ]
  }

  var urlRequest = URLRequest(url: endpoint)
  urlRequest.httpMethod = "POST"
  for (key, value) in headers {
    urlRequest.setValue(value, forHTTPHeaderField: key)
  }
  urlRequest.httpBody = try JSONEncoder().encode(JSONValue.object(body))
  return urlRequest
}

private func officialSDKEndpoint(baseURL: URL?, defaultBaseURL: String, pathComponents: [String]) -> URL {
  let base = baseURL ?? URL(string: defaultBaseURL)!
  let existingPathComponents = base.pathComponents.filter { $0 != "/" }
  if existingPathComponents.suffix(pathComponents.count) == pathComponents {
    return base
  }
  let missingPathComponents: ArraySlice<String>
  if pathComponents.count > 1,
     existingPathComponents.suffix(pathComponents.count - 1) == pathComponents.dropLast()
  {
    missingPathComponents = pathComponents.suffix(1)
  } else {
    missingPathComponents = pathComponents[...]
  }
  return missingPathComponents.reduce(base) { url, component in
    url.appendingPathComponent(component)
  }
}

private func extractOpenAIText(_ response: JSONValue) -> String {
  guard case let .object(object) = response else {
    return ""
  }
  if let outputText = stringValue(object["output_text"]) {
    return outputText
  }
  guard case let .array(output) = object["output"] else {
    return ""
  }

  let segments = output.flatMap { item -> [String] in
    guard case let .object(itemObject) = item, case let .array(content) = itemObject["content"] else {
      return []
    }
    return content.compactMap { entry -> String? in
      guard
        case let .object(entryObject) = entry,
        stringValue(entryObject["type"]) == "output_text",
        let text = stringValue(entryObject["text"]),
        !text.isEmpty
      else {
        return nil
      }
      return text
    }
  }

  return segments.joined(separator: "\n")
}

private func extractAnthropicText(_ response: JSONValue) -> String {
  guard case let .object(object) = response, case let .array(content) = object["content"] else {
    return ""
  }

  let segments = content.compactMap { entry -> String? in
    guard
      case let .object(entryObject) = entry,
      stringValue(entryObject["type"]) == "text",
      let text = stringValue(entryObject["text"]),
      !text.isEmpty
    else {
      return nil
    }
    return text
  }

  return segments.joined(separator: "\n")
}

private func stringValue(_ value: JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}
