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

public func resolveAdapterImagePaths(_ input: AdapterExecutionInput) -> [String] {
  if case .bool(false) = input.node.variables["forwardImageAttachments"] {
    return []
  }

  var paths: [String] = []
  collectImagePathCandidates(value: .object(input.mergedVariables), paths: &paths)
  collectImagePathCandidates(value: .object(input.arguments), paths: &paths)

  var seen = Set<String>()
  return paths.filter { path in
    guard !path.isEmpty, !seen.contains(path) else {
      return false
    }
    seen.insert(path)
    return true
  }
}

public func resolveNodeExecutionBackend(_ node: AgentNodePayload) throws -> NodeExecutionBackend {
  guard let executionBackend = node.executionBackend else {
    throw AdapterExecutionError(.providerError, "node '\(node.id)' requires explicit executionBackend")
  }
  return executionBackend
}

public func defaultAgentPreflightDeadline(existingDeadline: Date?, timeout: TimeInterval, now: Date = Date()) -> Date {
  let timeoutDeadline = now.addingTimeInterval(max(0, timeout))
  guard let existingDeadline else {
    return timeoutDeadline
  }
  return existingDeadline < timeoutDeadline ? existingDeadline : timeoutDeadline
}

public func agentPreflightErrorDetail(
  _ error: Error,
  fallback: String,
  additionalSensitiveValues: [String] = []
) -> String {
  if let error = error as? AdapterExecutionError {
    return redactAdapterSensitiveText(
      error.message.isEmpty ? fallback : error.message,
      additionalSensitiveValues: additionalSensitiveValues
    )
  }
  let message = error.localizedDescription.isEmpty ? fallback : error.localizedDescription
  return redactAdapterSensitiveText(message, additionalSensitiveValues: additionalSensitiveValues)
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

private func collectImagePathCandidates(
  value: JSONValue,
  paths: inout [String],
  depth: Int = 0,
  key: String? = nil
) {
  guard depth <= 8 else {
    return
  }

  switch value {
  case let .array(entries):
    if key == "imagePaths" {
      for entry in entries {
        if case let .string(path) = entry, !path.isEmpty {
          paths.append(path)
        }
      }
    }
    for entry in entries {
      collectImagePathCandidates(value: entry, paths: &paths, depth: depth + 1)
    }

  case let .object(object):
    if let imagePaths = object["imagePaths"] {
      collectImagePathCandidates(value: imagePaths, paths: &paths, depth: depth + 1, key: "imagePaths")
    }
    if isImageDescriptor(object) {
      appendImageDescriptorPaths(object, paths: &paths)
    }
    for key in object.keys.sorted() where key != "imagePaths" {
      if let child = object[key] {
        collectImagePathCandidates(value: child, paths: &paths, depth: depth + 1, key: key)
      }
    }

  case .null, .bool, .number, .string:
    return
  }
}

private func isImageDescriptor(_ object: JSONObject) -> Bool {
  if case let .string(kind) = object["kind"], kind == "image" {
    return true
  }
  return ["mediaType", "contentType", "mimetype"].contains { key in
    guard case let .string(value) = object[key] else {
      return false
    }
    return value.hasPrefix("image/")
  }
}

private func appendImageDescriptorPaths(_ object: JSONObject, paths: inout [String]) {
  for key in ["localPath", "imagePath", "downloadPath"] {
    if case let .string(path) = object[key], !path.isEmpty {
      paths.append(path)
    }
  }
  guard case let .object(source) = object["source"] else {
    return
  }
  for key in ["localPath", "imagePath", "downloadPath"] {
    if case let .string(path) = source[key], !path.isEmpty {
      paths.append(path)
    }
  }
}

public func redactAdapterSensitiveText(_ text: String, additionalSensitiveValues: [String] = []) -> String {
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
  for value in additionalSensitiveValues.filter({ $0.count >= 4 }).sorted(by: { $0.count > $1.count }) {
    redacted = redacted.replacingOccurrences(of: value, with: "<redacted>")
  }

  return redacted
}

public func sensitiveAdapterEnvironmentValues(_ environment: [String: String]) -> [String] {
  environment.compactMap { key, value in
    guard isSensitiveAdapterEnvironmentKey(key), value.count >= 4 else {
      return nil
    }
    return value
  }
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

private func isSensitiveAdapterEnvironmentKey(_ key: String) -> Bool {
  let normalized = key.uppercased()
  if isSensitiveEnvironmentKey(normalized) {
    return true
  }
  return ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "CURSOR_CONFIG_DIR"].contains(normalized)
    || normalized.hasSuffix("_CONFIG_DIR")
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
