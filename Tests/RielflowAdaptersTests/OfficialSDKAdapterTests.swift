import Foundation
import XCTest
@testable import RielflowAdapters
@testable import RielflowCore

private final class RecordingOfficialSDKExecutor: OfficialSDKRequestExecuting, @unchecked Sendable {
  private let queue = DispatchQueue(label: "rielflow.official-sdk-test-executor")
  private var outcomes: [Result<OfficialSDKResponse, Error>]
  private var capturedRequests: [OfficialSDKRequest] = []
  private let delay: Duration?

  init(outcomes: [Result<OfficialSDKResponse, Error>], delay: Duration? = nil) {
    self.outcomes = outcomes
    self.delay = delay
  }

  func executeSDKRequest(_ request: OfficialSDKRequest, context: AdapterExecutionContext) async throws -> OfficialSDKResponse {
    if let delay {
      try await Task.sleep(for: delay)
    }
    let outcome = queue.sync {
      capturedRequests.append(request)
      return outcomes.isEmpty ? outcomes.last : outcomes.removeFirst()
    }

    switch outcome {
    case let .success(response):
      return response
    case let .failure(error):
      throw error
    case .none:
      throw AdapterExecutionError(.providerError, "missing test response")
    }
  }

  func requests() -> [OfficialSDKRequest] {
    queue.sync {
      capturedRequests
    }
  }
}

private final class RecordingOfficialSDKHTTPTransport: OfficialSDKHTTPTransporting, @unchecked Sendable {
  private let queue = DispatchQueue(label: "rielflow.official-sdk-http-test-transport")
  private var capturedRequests: [URLRequest] = []
  private var responses: [OfficialSDKHTTPResponse]

  init(responses: [OfficialSDKHTTPResponse]) {
    self.responses = responses
  }

  func data(for request: URLRequest) async throws -> OfficialSDKHTTPResponse {
    queue.sync {
      capturedRequests.append(request)
    }
    return queue.sync {
      responses.isEmpty ? OfficialSDKHTTPResponse(statusCode: 500, body: Data()) : responses.removeFirst()
    }
  }

  func requests() -> [URLRequest] {
    queue.sync {
      capturedRequests
    }
  }
}

final class OfficialSDKAdapterTests: XCTestCase {
  func testOpenAIAdapterBuildsResponsesRequestAndExtractsOutputText() async throws {
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .success(OfficialSDKResponse(body: .object(["output_text": .string("hello from openai")])))
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        baseURL: URL(string: "https://openai.test/v1"),
        environment: ["TEST_OPENAI_KEY": openAITestKey()],
        requestExecutor: executor
      )
    )

    let output = try await adapter.execute(openAIInput(systemPromptText: "system"), context: AdapterExecutionContext())

    XCTAssertEqual(output.provider, "official-openai-sdk")
    XCTAssertEqual(output.payload["text"], .string("hello from openai"))
    let request = try XCTUnwrap(executor.requests().first)
    XCTAssertEqual(request.apiKey, openAITestKey())
    XCTAssertEqual(request.baseURL?.absoluteString, "https://openai.test/v1")
    guard case let .openAIResponses(body) = request.body else {
      return XCTFail("Expected OpenAI Responses request")
    }
    XCTAssertEqual(body.model, "gpt-5")
    XCTAssertEqual(body.input, "hello")
    XCTAssertEqual(body.instructions, "system")
  }

  func testOpenAIAdapterExtractsSegmentedOutputTextAndNormalizesEnvelope() async throws {
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .success(
        OfficialSDKResponse(
          body: .object([
            "output": .array([
              .object([
                "content": .array([
                  .object(["type": .string("output_text"), "text": .string(#"{"completionPassed":false,"when":{"needs_revision":true},"payload":{"status":"review"}}"#)]),
                  .object(["type": .string("ignored"), "text": .string("no")]),
                ])
              ])
            ])
          ])
        )
      )
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        environment: ["TEST_OPENAI_KEY": openAITestKey()],
        requestExecutor: executor
      )
    )

    let output = try await adapter.execute(
      openAIInput(output: NodeOutputContract(description: "business JSON")),
      context: AdapterExecutionContext()
    )

    XCTAssertEqual(output.completionPassed, false)
    XCTAssertEqual(output.when, ["needs_revision": true])
    XCTAssertEqual(output.payload["status"], .string("review"))
  }

  func testAnthropicAdapterBuildsMessagesRequestAndExtractsTextSegments() async throws {
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .success(
        OfficialSDKResponse(
          body: .object([
            "content": .array([
              .object(["type": .string("text"), "text": .string("first")]),
              .object(["type": .string("tool_use"), "text": .string("ignored")]),
              .object(["type": .string("text"), "text": .string("second")]),
            ])
          ])
        )
      )
    ])
    let adapter = AnthropicSDKAdapter(
      configuration: AnthropicSDKAdapterConfiguration(
        officialSDK: OfficialSDKAdapterConfiguration(
          apiKeyEnv: "TEST_ANTHROPIC_KEY",
          baseURL: URL(string: "https://anthropic.test"),
          environment: ["TEST_ANTHROPIC_KEY": anthropicTestKey()],
          requestExecutor: executor
        ),
        maxTokens: 0
      )
    )

    let output = try await adapter.execute(anthropicInput(systemPromptText: "system"), context: AdapterExecutionContext())

    XCTAssertEqual(output.provider, "official-anthropic-sdk")
    XCTAssertEqual(output.payload["text"], .string("first\nsecond"))
    let request = try XCTUnwrap(executor.requests().first)
    XCTAssertEqual(request.baseURL?.absoluteString, "https://anthropic.test")
    guard case let .anthropicMessages(body) = request.body else {
      return XCTFail("Expected Anthropic Messages request")
    }
    XCTAssertEqual(body.model, "claude-sonnet-4-5")
    XCTAssertEqual(body.maxTokens, 1)
    XCTAssertEqual(body.system, "system")
    XCTAssertEqual(body.messages, [AnthropicMessage(role: "user", content: "hello")])
  }

  func testOfficialSDKAdapterRetriesAndRedactsProviderFailures() async throws {
    let secret = openAITestKey()
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .failure(AdapterExecutionError(.providerError, "Authorization: Bearer \(secret)")),
      .success(OfficialSDKResponse(body: .object(["output_text": .string("ok")]))),
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        retryPolicy: RetryPolicy(maxAttempts: 2, retryDelay: .zero),
        environment: ["TEST_OPENAI_KEY": secret],
        requestExecutor: executor
      )
    )

    let output = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())

    XCTAssertEqual(output.payload["text"], .string("ok"))
    XCTAssertEqual(executor.requests().count, 2)
  }

  func testOfficialSDKAdapterRedactsTerminalProviderFailure() async throws {
    let secret = openAITestKey()
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .failure(AdapterExecutionError(.providerError, "OPENAI_API_KEY=\(secret)"))
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        retryPolicy: RetryPolicy(maxAttempts: 1, retryDelay: .zero),
        environment: ["TEST_OPENAI_KEY": secret],
        requestExecutor: executor
      )
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
      XCTFail("Expected provider error")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(secret))
      XCTAssertTrue(error.message.contains("<redacted"))
    }
  }

  func testOfficialSDKAdapterReportsMissingAPIKeyAsPolicyBlocked() async throws {
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_MISSING_OPENAI_KEY",
        environment: [:],
        requestExecutor: RecordingOfficialSDKExecutor(outcomes: [])
      )
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
      XCTFail("Expected policy blocked")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .policyBlocked)
      XCTAssertEqual(error.message, "missing OpenAI API key")
    }
  }

  func testOfficialSDKAdapterHonorsDeadlineTimeout() async throws {
    let executor = RecordingOfficialSDKExecutor(
      outcomes: [.success(OfficialSDKResponse(body: .object(["output_text": .string("late")])) )],
      delay: .milliseconds(250)
    )
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        retryPolicy: RetryPolicy(maxAttempts: 1, retryDelay: .zero),
        environment: ["TEST_OPENAI_KEY": openAITestKey()],
        requestExecutor: executor
      )
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext(deadline: Date(timeIntervalSinceNow: 0.05)))
      XCTFail("Expected timeout")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .timeout)
      XCTAssertEqual(error.message, "official OpenAI SDK request aborted")
    }
  }

  func testDefaultOpenAIHTTPExecutorBuildsResponsesRequestWithoutInjectedRequestExecutor() async throws {
    let transport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["output_text": .string("default openai")])
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        baseURL: URL(string: "https://openai.test/v1"),
        environment: ["TEST_OPENAI_KEY": openAITestKey()],
        httpTransport: transport
      )
    )

    let output = try await adapter.execute(openAIInput(systemPromptText: "system"), context: AdapterExecutionContext())

    XCTAssertEqual(output.payload["text"], .string("default openai"))
    let request = try XCTUnwrap(transport.requests().first)
    XCTAssertEqual(request.url?.absoluteString, "https://openai.test/v1/responses")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(openAITestKey())")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    let body = try requestJSONObject(request)
    XCTAssertEqual(body["model"], .string("gpt-5"))
    XCTAssertEqual(body["input"], .string("hello"))
    XCTAssertEqual(body["instructions"], .string("system"))
  }

  func testDefaultAnthropicHTTPExecutorBuildsMessagesRequestWithoutInjectedRequestExecutor() async throws {
    let transport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["content": .array([.object(["type": .string("text"), "text": .string("default anthropic")])])])
    ])
    let adapter = AnthropicSDKAdapter(
      configuration: AnthropicSDKAdapterConfiguration(
        officialSDK: OfficialSDKAdapterConfiguration(
          apiKeyEnv: "TEST_ANTHROPIC_KEY",
          baseURL: URL(string: "https://anthropic.test/v1"),
          environment: ["TEST_ANTHROPIC_KEY": anthropicTestKey()],
          httpTransport: transport
        ),
        maxTokens: 2048
      )
    )

    let output = try await adapter.execute(anthropicInput(systemPromptText: "system"), context: AdapterExecutionContext())

    XCTAssertEqual(output.payload["text"], .string("default anthropic"))
    let request = try XCTUnwrap(transport.requests().first)
    XCTAssertEqual(request.url?.absoluteString, "https://anthropic.test/v1/messages")
    XCTAssertEqual(request.httpMethod, "POST")
    XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), anthropicTestKey())
    XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
    let body = try requestJSONObject(request)
    XCTAssertEqual(body["model"], .string("claude-sonnet-4-5"))
    XCTAssertEqual(body["max_tokens"], .number(2048))
    XCTAssertEqual(body["system"], .string("system"))
    XCTAssertEqual(body["messages"], .array([.object(["role": .string("user"), "content": .string("hello")])]))
  }

  func testDefaultHTTPExecutorNormalizesProviderHTTPFailures() async throws {
    let secret = openAITestKey()
    let transport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["error": .string("OPENAI_API_KEY=\(secret)")], statusCode: 401)
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "TEST_OPENAI_KEY",
        retryPolicy: RetryPolicy(maxAttempts: 1, retryDelay: .zero),
        environment: ["TEST_OPENAI_KEY": secret],
        httpTransport: transport
      )
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
      XCTFail("Expected HTTP provider error")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(secret))
      XCTAssertTrue(error.message.contains("<redacted"))
    }
  }

  func testDefaultHTTPExecutorRedactsConfiguredAPIKeyValueFromProviderFailures() async throws {
    let secret = "prod-secret-value"
    let transport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["error": .string("proxy echoed \(secret)")], statusCode: 502)
    ])
    let adapter = OpenAiSDKAdapter(
      configuration: OfficialSDKAdapterConfiguration(
        apiKeyEnv: "PROXY_TOKEN",
        retryPolicy: RetryPolicy(maxAttempts: 1, retryDelay: .zero),
        environment: ["PROXY_TOKEN": secret],
        httpTransport: transport
      )
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
      XCTFail("Expected HTTP provider error")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(secret))
      XCTAssertTrue(error.message.contains("<redacted>"))
    }
  }

  func testURLSessionOfficialSDKRequestExecutorRedactsDirectHTTPFailures() async throws {
    let secret = "direct-secret-value"
    let transport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["error": .string("direct echo \(secret)")], statusCode: 500)
    ])
    let executor = URLSessionOfficialSDKRequestExecutor(transport: transport)

    do {
      _ = try await executor.executeSDKRequest(
        OfficialSDKRequest(
          provider: "official-openai-sdk",
          apiKey: secret,
          body: .openAIResponses(OpenAIResponsesRequest(model: "gpt-5", input: "hello"))
        ),
        context: AdapterExecutionContext()
      )
      XCTFail("Expected direct HTTP provider error")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(secret))
      XCTAssertTrue(error.message.contains("<redacted>"))
    }
  }

  func testInjectedExecutorFailureRedactsConfiguredAPIKeyValue() async throws {
    let secret = "anthropic-prod-secret-value"
    let executor = RecordingOfficialSDKExecutor(outcomes: [
      .failure(AdapterExecutionError(.providerError, "upstream echoed \(secret)"))
    ])
    let adapter = AnthropicSDKAdapter(
      configuration: AnthropicSDKAdapterConfiguration(
        officialSDK: OfficialSDKAdapterConfiguration(
          apiKeyEnv: "ANTHROPIC_PROXY_TOKEN",
          retryPolicy: RetryPolicy(maxAttempts: 1, retryDelay: .zero),
          environment: ["ANTHROPIC_PROXY_TOKEN": secret],
          requestExecutor: executor
        )
      )
    )

    do {
      _ = try await adapter.execute(anthropicInput(), context: AdapterExecutionContext())
      XCTFail("Expected injected executor provider error")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertFalse(error.message.contains(secret))
      XCTAssertTrue(error.message.contains("<redacted>"))
    }
  }

  func testDispatchingNodeAdapterRegistersOfficialSDKBackendsAndDefersCursorSDK() async throws {
    let openAIExecutor = RecordingOfficialSDKExecutor(outcomes: [
      .success(OfficialSDKResponse(body: .object(["output_text": .string("openai")])) )
    ])
    let anthropicExecutor = RecordingOfficialSDKExecutor(outcomes: [
      .success(OfficialSDKResponse(body: .object(["content": .array([.object(["type": .string("text"), "text": .string("anthropic")])])])) )
    ])
    let adapter = DispatchingNodeAdapter(
      configuration: DispatchingNodeAdapterConfiguration(
        openAISDK: OfficialSDKAdapterConfiguration(
          apiKeyEnv: "TEST_OPENAI_KEY",
          environment: ["TEST_OPENAI_KEY": openAITestKey()],
          requestExecutor: openAIExecutor
        ),
        anthropicSDK: AnthropicSDKAdapterConfiguration(
          officialSDK: OfficialSDKAdapterConfiguration(
            apiKeyEnv: "TEST_ANTHROPIC_KEY",
            environment: ["TEST_ANTHROPIC_KEY": anthropicTestKey()],
            requestExecutor: anthropicExecutor
          )
        )
      )
    )

    let openAIOutput = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
    let anthropicOutput = try await adapter.execute(anthropicInput(), context: AdapterExecutionContext())

    XCTAssertEqual(openAIOutput.payload["text"], .string("openai"))
    XCTAssertEqual(anthropicOutput.payload["text"], .string("anthropic"))

    do {
      _ = try await adapter.execute(cursorSDKInput(), context: AdapterExecutionContext())
      XCTFail("Expected missing cursor SDK adapter")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertEqual(error.message, "node execution backend 'official/cursor-sdk' has no registered adapter")
    }
  }

  func testDispatchingNodeAdapterCanStillReportMissingRegistrationDeterministically() async throws {
    let adapter = DispatchingNodeAdapter(
      configuration: DispatchingNodeAdapterConfiguration(includeDefaultOfficialSDKAdapters: false)
    )

    do {
      _ = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
      XCTFail("Expected missing OpenAI adapter")
    } catch let error as AdapterExecutionError {
      XCTAssertEqual(error.code, .providerError)
      XCTAssertEqual(error.message, "node execution backend 'official/openai-sdk' has no registered adapter")
    }
  }

  func testDispatchingNodeAdapterDefaultOfficialFactoriesUseHTTPExecutors() async throws {
    let openAITransport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["output_text": .string("openai default")])
    ])
    let anthropicTransport = RecordingOfficialSDKHTTPTransport(responses: [
      httpResponse(["content": .array([.object(["type": .string("text"), "text": .string("anthropic default")])])])
    ])
    let adapter = DispatchingNodeAdapter(
      configuration: DispatchingNodeAdapterConfiguration(
        openAISDK: OfficialSDKAdapterConfiguration(
          apiKeyEnv: "TEST_OPENAI_KEY",
          environment: ["TEST_OPENAI_KEY": openAITestKey()],
          httpTransport: openAITransport
        ),
        anthropicSDK: AnthropicSDKAdapterConfiguration(
          officialSDK: OfficialSDKAdapterConfiguration(
            apiKeyEnv: "TEST_ANTHROPIC_KEY",
            environment: ["TEST_ANTHROPIC_KEY": anthropicTestKey()],
            httpTransport: anthropicTransport
          )
        )
      )
    )

    let openAIOutput = try await adapter.execute(openAIInput(), context: AdapterExecutionContext())
    let anthropicOutput = try await adapter.execute(anthropicInput(), context: AdapterExecutionContext())

    XCTAssertEqual(openAIOutput.payload["text"], .string("openai default"))
    XCTAssertEqual(anthropicOutput.payload["text"], .string("anthropic default"))
    XCTAssertEqual(openAITransport.requests().count, 1)
    XCTAssertEqual(anthropicTransport.requests().count, 1)
  }

  private func openAIInput(
    systemPromptText: String? = nil,
    output: NodeOutputContract? = nil
  ) -> AdapterExecutionInput {
    AdapterExecutionInput(
      node: AgentNodePayload(id: "worker", executionBackend: .officialOpenAISDK, model: "gpt-5", output: output),
      promptText: "hello",
      systemPromptText: systemPromptText
    )
  }

  private func anthropicInput(systemPromptText: String? = nil) -> AdapterExecutionInput {
    AdapterExecutionInput(
      node: AgentNodePayload(id: "worker", executionBackend: .officialAnthropicSDK, model: "claude-sonnet-4-5"),
      promptText: "hello",
      systemPromptText: systemPromptText
    )
  }

  private func cursorSDKInput() -> AdapterExecutionInput {
    AdapterExecutionInput(
      node: AgentNodePayload(id: "worker", executionBackend: .officialCursorSDK, model: "composer-2"),
      promptText: "hello"
    )
  }

  private func openAITestKey() -> String {
    ["sk", "test", "123456"].joined(separator: "-")
  }

  private func anthropicTestKey() -> String {
    ["anthropic", "test", "123456"].joined(separator: "-")
  }

  private func httpResponse(_ object: JSONObject, statusCode: Int = 200) -> OfficialSDKHTTPResponse {
    let body = try! JSONEncoder().encode(JSONValue.object(object))
    return OfficialSDKHTTPResponse(statusCode: statusCode, body: body)
  }

  private func requestJSONObject(_ request: URLRequest) throws -> JSONObject {
    let data = try XCTUnwrap(request.httpBody)
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    guard case let .object(object) = value else {
      XCTFail("Expected JSON object request body")
      return [:]
    }
    return object
  }
}
