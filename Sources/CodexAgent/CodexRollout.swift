import Foundation
import RielflowCore

public enum CodexSessionSource: String, Codable, Equatable, Sendable {
  case cli
  case vscode
  case exec
  case unknown
}

public enum CodexMessageOrigin: String, Codable, Equatable, Sendable {
  case userInput = "user_input"
  case systemInjected = "system_injected"
  case toolGenerated = "tool_generated"
  case frameworkEvent = "framework_event"
}

public struct CodexMessageProvenance: Codable, Equatable, Sendable {
  public var role: String?
  public var origin: CodexMessageOrigin
  public var displayDefault: Bool
  public var sourceTag: String?

  public init(role: String? = nil, origin: CodexMessageOrigin, displayDefault: Bool, sourceTag: String? = nil) {
    self.role = role
    self.origin = origin
    self.displayDefault = displayDefault
    self.sourceTag = sourceTag
  }
}

public struct CodexRolloutLine: Equatable, Sendable {
  public var timestamp: String
  public var type: String
  public var payload: JSONValue
  public var provenance: CodexMessageProvenance?

  public init(timestamp: String, type: String, payload: JSONValue, provenance: CodexMessageProvenance? = nil) {
    self.timestamp = timestamp
    self.type = type
    self.payload = payload
    self.provenance = provenance
  }
}

public struct CodexSessionMeta: Equatable, Sendable {
  public var id: String
  public var timestamp: String
  public var cwd: String
  public var originator: String?
  public var cliVersion: String
  public var source: CodexSessionSource
  public var modelProvider: String?
  public var forkedFromId: String?
  public var git: CodexSessionGit?

  public init(
    id: String,
    timestamp: String,
    cwd: String,
    originator: String? = nil,
    cliVersion: String = "unknown",
    source: CodexSessionSource,
    modelProvider: String? = nil,
    forkedFromId: String? = nil,
    git: CodexSessionGit? = nil
  ) {
    self.id = id
    self.timestamp = timestamp
    self.cwd = cwd
    self.originator = originator
    self.cliVersion = cliVersion
    self.source = source
    self.modelProvider = modelProvider
    self.forkedFromId = forkedFromId
    self.git = git
  }
}

public struct CodexSessionGit: Equatable, Sendable {
  public var sha: String?
  public var branch: String?
  public var originURL: String?

  public init(sha: String? = nil, branch: String? = nil, originURL: String? = nil) {
    self.sha = sha
    self.branch = branch
    self.originURL = originURL
  }
}

public enum CodexSessionMessageCategory: String, Equatable, Sendable {
  case assistantToolResponse = "assistant_tool_response"
  case toolUserResponse = "tool_user_response"
  case otherMessage = "other_message"
}

public struct CodexSessionMessage: Equatable, Sendable {
  public var timestamp: String
  public var category: CodexSessionMessageCategory
  public var role: String
  public var text: String?
  public var sourceType: String
  public var sourceTag: String?
  public var line: CodexRolloutLine

  public init(
    timestamp: String,
    category: CodexSessionMessageCategory,
    role: String,
    text: String?,
    sourceType: String,
    sourceTag: String? = nil,
    line: CodexRolloutLine
  ) {
    self.timestamp = timestamp
    self.category = category
    self.role = role
    self.text = text
    self.sourceType = sourceType
    self.sourceTag = sourceTag
    self.line = line
  }
}

public struct CodexSessionMessageOptions: Equatable, Sendable {
  public var excludeToolRelated: Bool
  public var excludeSystemInjected: Bool

  public init(excludeToolRelated: Bool = false, excludeSystemInjected: Bool = false) {
    self.excludeToolRelated = excludeToolRelated
    self.excludeSystemInjected = excludeSystemInjected
  }
}

public enum CodexRolloutReader {
  public static func parseRolloutLine(_ line: String) -> CodexRolloutLine? {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else {
      return nil
    }
    guard
      let decoded = try? JSONDecoder().decode(JSONValue.self, from: data),
      case let .object(object) = decoded
    else {
      return nil
    }
    guard var normalized = normalizeRolloutLine(object) else {
      return nil
    }
    normalized.provenance = deriveProvenance(normalized)
    return normalized
  }

  public static func readRollout(path: String) throws -> [CodexRolloutLine] {
    let content = try String(contentsOfFile: path, encoding: .utf8)
    return content.split(separator: "\n", omittingEmptySubsequences: false).compactMap { parseRolloutLine(String($0)) }
  }

  public static func parseSessionMeta(path: String) throws -> CodexSessionMeta? {
    let content = try String(contentsOfFile: path, encoding: .utf8)
    for line in content.split(separator: "\n", omittingEmptySubsequences: false) {
      guard let parsed = parseRolloutLine(String(line)) else {
        continue
      }
      guard parsed.type == "session_meta" else {
        return nil
      }
      return parseSessionMeta(from: parsed)
    }
    return nil
  }

  public static func extractFirstUserMessage(path: String) throws -> String? {
    for line in try readRollout(path: path) {
      guard line.type == "event_msg", let payload = objectValue(line.payload) else {
        continue
      }
      guard stringValue(payload["type"]) == "UserMessage", let message = stringValue(payload["message"]) else {
        continue
      }
      if line.provenance?.origin == .userInput || (line.provenance == nil && detectSourceTag(message) == nil) {
        return message
      }
    }
    return nil
  }

  public static func getSessionMessages(path: String, options: CodexSessionMessageOptions = CodexSessionMessageOptions()) throws -> [CodexSessionMessage] {
    try readRollout(path: path).compactMap { line in
      guard let message = toSessionMessage(line) else {
        return nil
      }
      if options.excludeToolRelated, message.category == .assistantToolResponse || message.category == .toolUserResponse {
        return nil
      }
      if options.excludeSystemInjected, message.line.provenance?.origin == .systemInjected {
        return nil
      }
      return message
    }
  }

  public static func parseSessionMeta(from line: CodexRolloutLine) -> CodexSessionMeta? {
    guard line.type == "session_meta", let payload = objectValue(line.payload), let meta = objectValue(payload["meta"]) else {
      return nil
    }
    guard
      let id = stringValue(meta["id"]),
      let timestamp = stringValue(meta["timestamp"]),
      let cwd = stringValue(meta["cwd"])
    else {
      return nil
    }
    let source = CodexSessionSource(rawValue: stringValue(meta["source"]) ?? "") ?? .unknown
    let git = objectValue(payload["git"]).map {
      CodexSessionGit(
        sha: stringValue($0["sha"]),
        branch: stringValue($0["branch"]),
        originURL: stringValue($0["origin_url"])
      )
    }
    return CodexSessionMeta(
      id: id,
      timestamp: timestamp,
      cwd: cwd,
      originator: stringValue(meta["originator"]),
      cliVersion: stringValue(meta["cli_version"]) ?? "unknown",
      source: source,
      modelProvider: stringValue(meta["model_provider"]),
      forkedFromId: stringValue(meta["forked_from_id"]),
      git: git
    )
  }
}

public func parseRolloutLine(_ line: String) -> CodexRolloutLine? {
  CodexRolloutReader.parseRolloutLine(line)
}

public func readRollout(path: String) throws -> [CodexRolloutLine] {
  try CodexRolloutReader.readRollout(path: path)
}

public func parseSessionMeta(path: String) throws -> CodexSessionMeta? {
  try CodexRolloutReader.parseSessionMeta(path: path)
}

public func extractFirstUserMessage(path: String) throws -> String? {
  try CodexRolloutReader.extractFirstUserMessage(path: path)
}

public func getSessionMessages(path: String, options: CodexSessionMessageOptions = CodexSessionMessageOptions()) throws -> [CodexSessionMessage] {
  try CodexRolloutReader.getSessionMessages(path: path, options: options)
}

private func normalizeRolloutLine(_ object: JSONObject) -> CodexRolloutLine? {
  if let timestamp = stringValue(object["timestamp"]), let type = stringValue(object["type"]), let payload = object["payload"] {
    return CodexRolloutLine(timestamp: timestamp, type: type, payload: payload)
  }

  guard let eventType = stringValue(object["type"]) else {
    return nil
  }
  let timestamp = stringValue(object["timestamp"]) ?? ISO8601DateFormatter().string(from: Date())

  switch eventType {
  case "thread.started":
    let sessionId = stringValue(object["thread_id"]).flatMap { $0.isEmpty ? nil : $0 } ?? "unknown-session"
    return CodexRolloutLine(
      timestamp: timestamp,
      type: "session_meta",
      payload: .object([
        "meta": .object([
          "id": .string(sessionId),
          "timestamp": .string(timestamp),
          "cwd": .string(""),
          "originator": .string("codex"),
          "cli_version": .string("unknown"),
          "source": .string("exec"),
        ])
      ])
    )
  case "item.completed":
    guard let item = objectValue(object["item"]), let itemType = stringValue(item["type"]) else {
      return nil
    }
    if itemType == "agent_message", let text = stringValue(item["text"]) {
      return CodexRolloutLine(timestamp: timestamp, type: "event_msg", payload: .object(["type": .string("AgentMessage"), "message": .string(text)]))
    }
    return CodexRolloutLine(timestamp: timestamp, type: "response_item", payload: .object(item))
  case "turn.started":
    return CodexRolloutLine(timestamp: timestamp, type: "event_msg", payload: .object(compactObject(["type": .string("TurnStarted"), "turn_id": object["turn_id"]])))
  case "turn.completed":
    return CodexRolloutLine(timestamp: timestamp, type: "event_msg", payload: .object(compactObject(["type": .string("TurnComplete"), "turn_id": object["turn_id"], "usage": object["usage"]])))
  case "error":
    return CodexRolloutLine(timestamp: timestamp, type: "event_msg", payload: .object(compactObject(["type": .string("Error"), "message": object["message"]])))
  default:
    return nil
  }
}

private func deriveProvenance(_ line: CodexRolloutLine) -> CodexMessageProvenance? {
  switch line.type {
  case "session_meta", "turn_context", "compacted":
    return CodexMessageProvenance(origin: .frameworkEvent, displayDefault: false, sourceTag: line.type)
  case "event_msg":
    guard let payload = objectValue(line.payload) else {
      return CodexMessageProvenance(origin: .frameworkEvent, displayDefault: false, sourceTag: "event_msg_unknown")
    }
    switch stringValue(payload["type"]) {
    case "UserMessage":
      let message = stringValue(payload["message"]) ?? ""
      if let sourceTag = detectSourceTag(message) {
        return CodexMessageProvenance(role: "user", origin: .systemInjected, displayDefault: false, sourceTag: sourceTag)
      }
      return CodexMessageProvenance(role: "user", origin: .userInput, displayDefault: true)
    case "AgentMessage":
      return CodexMessageProvenance(role: "assistant", origin: .userInput, displayDefault: true)
    case "ExecCommandBegin", "ExecCommandEnd":
      return CodexMessageProvenance(origin: .toolGenerated, displayDefault: false, sourceTag: "local_shell")
    default:
      return CodexMessageProvenance(origin: .frameworkEvent, displayDefault: false, sourceTag: stringValue(payload["type"]) ?? "event_msg")
    }
  case "response_item":
    guard let payload = objectValue(line.payload) else {
      return CodexMessageProvenance(origin: .frameworkEvent, displayDefault: false, sourceTag: "response_item_unknown")
    }
    switch stringValue(payload["type"]) {
    case "message":
      return CodexMessageProvenance(role: stringValue(payload["role"]), origin: .userInput, displayDefault: true)
    case "function_call":
      return CodexMessageProvenance(role: "assistant", origin: .toolGenerated, displayDefault: false, sourceTag: stringValue(payload["name"]) ?? "function_call")
    case "function_call_output":
      return CodexMessageProvenance(role: "user", origin: .toolGenerated, displayDefault: false, sourceTag: "function_call_output")
    case "local_shell_call":
      return CodexMessageProvenance(origin: .toolGenerated, displayDefault: false, sourceTag: "local_shell")
    default:
      return CodexMessageProvenance(origin: .frameworkEvent, displayDefault: false, sourceTag: stringValue(payload["type"]) ?? "response_item")
    }
  default:
    return nil
  }
}

private func toSessionMessage(_ line: CodexRolloutLine) -> CodexSessionMessage? {
  guard let payload = objectValue(line.payload) else {
    return nil
  }
  if line.type == "event_msg" {
    switch stringValue(payload["type"]) {
    case "UserMessage":
      return CodexSessionMessage(timestamp: line.timestamp, category: .otherMessage, role: "user", text: stringValue(payload["message"]), sourceType: line.type, sourceTag: line.provenance?.sourceTag, line: line)
    case "AgentMessage":
      return CodexSessionMessage(timestamp: line.timestamp, category: .otherMessage, role: "assistant", text: stringValue(payload["message"]), sourceType: line.type, sourceTag: line.provenance?.sourceTag, line: line)
    case "ExecCommandEnd":
      let text = stringValue(payload["aggregated_output"]) ?? stringArray(payload["command"])?.joined(separator: " ")
      return CodexSessionMessage(timestamp: line.timestamp, category: .toolUserResponse, role: "user", text: text, sourceType: line.type, sourceTag: "local_shell", line: line)
    default:
      return nil
    }
  }
  if line.type == "response_item" {
    switch stringValue(payload["type"]) {
    case "message":
      return CodexSessionMessage(timestamp: line.timestamp, category: .otherMessage, role: stringValue(payload["role"]) ?? "unknown", text: outputText(from: payload["content"]), sourceType: line.type, sourceTag: line.provenance?.sourceTag, line: line)
    case "function_call":
      return CodexSessionMessage(timestamp: line.timestamp, category: .assistantToolResponse, role: "assistant", text: stringValue(payload["arguments"]), sourceType: line.type, sourceTag: stringValue(payload["name"]), line: line)
    case "function_call_output":
      return CodexSessionMessage(timestamp: line.timestamp, category: .toolUserResponse, role: "user", text: stringValue(payload["output"]) ?? jsonString(payload["output"]), sourceType: line.type, sourceTag: "function_call_output", line: line)
    default:
      return nil
    }
  }
  return nil
}

private func detectSourceTag(_ message: String) -> String? {
  if message.hasPrefix("# AGENTS.md instructions") {
    return "agents_instructions"
  }
  if message.contains("<environment_context>") {
    return "environment_context"
  }
  return nil
}

private func compactObject(_ object: [String: JSONValue?]) -> JSONObject {
  object.reduce(into: JSONObject()) { partial, entry in
    if let value = entry.value {
      partial[entry.key] = value
    }
  }
}

private func outputText(from value: JSONValue?) -> String? {
  guard let value else {
    return nil
  }
  switch value {
  case let .string(text):
    return text
  case let .array(values):
    let text = values.compactMap { entry -> String? in
      guard let object = objectValue(entry) else {
        return nil
      }
      if ["output_text", "text"].contains(stringValue(object["type"]) ?? ""), let text = stringValue(object["text"]) {
        return text
      }
      return outputText(from: object["content"])
    }.joined()
    return text.isEmpty ? nil : text
  case let .object(object):
    return outputText(from: object["content"])
  case .null, .bool, .number:
    return nil
  }
}

private func jsonString(_ value: JSONValue?) -> String? {
  guard let value, let data = try? JSONEncoder().encode(value) else {
    return nil
  }
  return String(data: data, encoding: .utf8)
}

private func stringArray(_ value: JSONValue?) -> [String]? {
  guard case let .array(values) = value else {
    return nil
  }
  return values.compactMap(stringValue)
}

private func stringValue(_ value: JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}

private func objectValue(_ value: JSONValue?) -> JSONObject? {
  guard case let .object(object) = value else {
    return nil
  }
  return object
}
