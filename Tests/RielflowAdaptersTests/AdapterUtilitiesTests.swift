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
}
