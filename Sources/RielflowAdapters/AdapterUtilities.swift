import Foundation
import RielflowCore

public struct RetryPolicy: Equatable, Sendable {
  public var maxAttempts: Int
  public var retryDelay: Duration

  public init(maxAttempts: Int = 2, retryDelay: Duration = .milliseconds(50)) {
    self.maxAttempts = max(1, maxAttempts)
    self.retryDelay = retryDelay
  }
}

public func buildCombinedPromptText(promptText: String, systemPromptText: String?) -> String {
  guard let systemPromptText, !systemPromptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    return promptText
  }
  return "\(systemPromptText)\n\n\(promptText)"
}

public func resolveNodeExecutionBackend(_ node: AgentNodePayload) throws -> NodeExecutionBackend {
  guard let executionBackend = node.executionBackend else {
    throw AdapterExecutionError(.providerError, "node '\(node.id)' requires explicit executionBackend")
  }
  return executionBackend
}

public func executeWithRetry<T: Sendable>(
  policy: RetryPolicy,
  operation: @Sendable () async throws -> T,
  normalizeError: @Sendable (Error) -> AdapterExecutionError
) async throws -> T {
  var attempt = 1
  while true {
    do {
      return try await operation()
    } catch let error as AdapterExecutionError {
      if attempt >= policy.maxAttempts || (error.code != .providerError && error.code != .timeout) {
        throw error
      }
    } catch {
      let normalized = normalizeError(error)
      if attempt >= policy.maxAttempts || (normalized.code != .providerError && normalized.code != .timeout) {
        throw normalized
      }
    }

    attempt += 1
    try await Task.sleep(for: policy.retryDelay)
  }
}

public func normalizeAdapterFailure(_ error: Error, fallbackMessage: String) -> AdapterExecutionError {
  if let error = error as? AdapterExecutionError {
    return error
  }
  let message = error.localizedDescription.isEmpty ? fallbackMessage : error.localizedDescription
  return AdapterExecutionError(.providerError, message)
}
