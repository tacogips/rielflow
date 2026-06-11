import RielflowCore

public enum HookVendor: String, Codable, CaseIterable, Sendable {
  case claudeCode = "claude-code"
  case codex
  case gemini
}

public struct HookContext: Codable, Equatable, Sendable {
  public var agentSessionId: String
  public var agentBackend: String?

  public init(agentSessionId: String, agentBackend: String? = nil) {
    self.agentSessionId = agentSessionId
    self.agentBackend = agentBackend
  }
}
