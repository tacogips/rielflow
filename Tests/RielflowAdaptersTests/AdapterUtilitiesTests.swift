import XCTest
@testable import RielflowAdapters
@testable import RielflowCore

final class AdapterUtilitiesTests: XCTestCase {
  func testRetryPolicyClampsAttemptsAndDelay() {
    let policy = RetryPolicy(maxAttempts: 0, retryDelay: .milliseconds(-50))

    XCTAssertEqual(policy.maxAttempts, 1)
    XCTAssertEqual(policy.retryDelay, .zero)
  }

  func testBuildCombinedPromptTextPreservesSystemPromptBoundary() {
    XCTAssertEqual(
      buildCombinedPromptText(promptText: "Do work", systemPromptText: "Be concise"),
      "Be concise\n\nDo work"
    )
    XCTAssertEqual(buildCombinedPromptText(promptText: "Do work", systemPromptText: "  "), "Do work")
  }

  func testResolveBackendRequiresExplicitBackend() throws {
    let node = AgentNodePayload(id: "worker", model: "gpt-5")

    XCTAssertThrowsError(try resolveNodeExecutionBackend(node)) { error in
      let adapterError = error as? AdapterExecutionError
      XCTAssertEqual(adapterError?.code, .providerError)
    }
  }

  func testOutputContractEnvelopeDefaultsAndBusinessPayloadFallback() throws {
    let envelope = try normalizeOutputContractEnvelope(
      ["when": .object(["accepted": .bool(true)]), "payload": .object(["status": .string("ok")])],
      source: "adapterOutput"
    )

    XCTAssertTrue(envelope.usedEnvelope)
    XCTAssertTrue(envelope.completionPassed)
    XCTAssertEqual(envelope.when, ["accepted": true])
    XCTAssertEqual(envelope.payload, ["status": .string("ok")])

    let businessPayload = try normalizeOutputContractEnvelope(
      ["status": .string("ok")],
      source: "adapterOutput",
      defaults: (false, ["retry": true])
    )

    XCTAssertFalse(businessPayload.usedEnvelope)
    XCTAssertFalse(businessPayload.completionPassed)
    XCTAssertEqual(businessPayload.when, ["retry": true])
    XCTAssertEqual(businessPayload.payload, ["status": .string("ok")])
  }

  func testOutputContractEnvelopeRequiresBooleanWhenObjectPayloadAndBooleanCompletionPassed() {
    XCTAssertThrowsError(
      try normalizeOutputContractEnvelope(
        ["when": .object(["accepted": .string("yes")]), "payload": .object([:])],
        source: "adapterOutput"
      )
    ) { error in
      XCTAssertEqual((error as? AdapterExecutionError)?.code, .invalidOutput)
    }

    XCTAssertThrowsError(
      try normalizeOutputContractEnvelope(
        ["when": .object(["accepted": .bool(true)]), "payload": .array([])],
        source: "adapterOutput"
      )
    ) { error in
      XCTAssertEqual((error as? AdapterExecutionError)?.code, .invalidOutput)
    }

    XCTAssertThrowsError(
      try normalizeOutputContractEnvelope(
        [
          "completionPassed": .string("false"),
          "when": .object(["accepted": .bool(true)]),
          "payload": .object([:]),
        ],
        source: "adapterOutput"
      )
    ) { error in
      XCTAssertEqual((error as? AdapterExecutionError)?.code, .invalidOutput)
    }
  }

  func testParseJSONCandidateIgnoresEscapedQuotedBracesBeforeBalancedObject() throws {
    let object = try parseJSONObjectCandidate(
      #"prefix "{ \"ignored\": { not json } }" {"payload":{"text":"brace } and escaped quote \" still string"},"when":{"done":true}} suffix"#,
      source: "adapterOutput"
    )

    XCTAssertEqual(object["payload"], .object(["text": .string(#"brace } and escaped quote " still string"#)]))
    XCTAssertEqual(object["when"], .object(["done": .bool(true)]))
  }
}
