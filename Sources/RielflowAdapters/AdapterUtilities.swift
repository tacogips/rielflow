import Foundation
import RielflowCore

public struct RetryPolicy: Equatable, Sendable {
  public var maxAttempts: Int
  public var retryDelay: Duration

  public init(maxAttempts: Int = 2, retryDelay: Duration = .milliseconds(50)) {
    self.maxAttempts = max(1, maxAttempts)
    self.retryDelay = retryDelay < .zero ? .zero : retryDelay
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
    return AdapterExecutionError(error.code, redactAdapterSensitiveText(error.message))
  }
  let message = error.localizedDescription.isEmpty ? fallbackMessage : error.localizedDescription
  return AdapterExecutionError(.providerError, redactAdapterSensitiveText(message))
}

public func redactAdapterSensitiveText(_ text: String) -> String {
  var redacted = text

  redacted = replacingRegexMatches(
    in: redacted,
    pattern: #"\b([A-Za-z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE[_-]?KEY|ACCESS[_-]?KEY)[A-Za-z0-9_]*)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)"#,
    options: [.caseInsensitive],
    replacement: #"$1=<redacted>"#
  )
  redacted = replacingRegexMatches(
    in: redacted,
    pattern: #"\bsk-[A-Za-z0-9_-]{8,}\b"#,
    replacement: "<redacted-token>"
  )
  redacted = replacingRegexMatches(
    in: redacted,
    pattern: #"\b(?:Bearer|Token)\s+[A-Za-z0-9._~+/=-]{16,}\b"#,
    replacement: "<redacted-token>"
  )

  for (key, value) in ProcessInfo.processInfo.environment where isSensitiveEnvironmentKey(key) && value.count >= 8 {
    redacted = redacted.replacingOccurrences(of: value, with: "<redacted>")
  }

  return redacted
}

private func isSensitiveEnvironmentKey(_ key: String) -> Bool {
  let normalized = key.uppercased()
  return [
    "API_KEY",
    "APIKEY",
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE_KEY",
    "ACCESS_KEY"
  ].contains { normalized.contains($0) }
}

private func replacingRegexMatches(
  in text: String,
  pattern: String,
  options: NSRegularExpression.Options = [],
  replacement: String
) -> String {
  guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
    return text
  }
  let range = NSRange(text.startIndex..<text.endIndex, in: text)
  return regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: replacement)
}
