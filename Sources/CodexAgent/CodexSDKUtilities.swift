import Foundation
import RielflowCore

public struct CodexSessionConfig: Equatable, Sendable {
  public var prompt: String
  public var resumeSessionId: String?
  public var options: CodexProcessOptions

  public init(prompt: String, resumeSessionId: String? = nil, options: CodexProcessOptions = CodexProcessOptions()) {
    self.prompt = prompt
    self.resumeSessionId = resumeSessionId
    self.options = options
  }
}

public struct CodexSessionResult: Equatable, Sendable {
  public var success: Bool
  public var exitCode: Int32
  public var startedAt: String
  public var completedAt: String
  public var messageCount: Int

  public init(success: Bool, exitCode: Int32, startedAt: String, completedAt: String, messageCount: Int) {
    self.success = success
    self.exitCode = exitCode
    self.startedAt = startedAt
    self.completedAt = completedAt
    self.messageCount = messageCount
  }
}

public protocol CodexRunningSession: AnyObject, Sendable {
  var sessionId: String { get }
  func getState() -> [String: String]
  func pushMessage(_ message: CodexRolloutLine) throws
  func messages() -> [CodexRolloutLine]
  func waitForCompletion() -> CodexSessionResult
  func cancel() -> CodexSessionResult
}

public protocol CodexSessionRunner: AnyObject, Sendable {
  associatedtype Session: CodexRunningSession

  func startSession(config: CodexSessionConfig) throws -> Session
  func resumeSession(sessionId: String, prompt: String?, options: CodexProcessOptions) throws -> Session
}

public struct CodexMockStartSessionCall: Equatable, Sendable {
  public var config: CodexSessionConfig
}

public struct CodexMockResumeSessionCall: Equatable, Sendable {
  public var sessionId: String
  public var prompt: String?
  public var options: CodexProcessOptions
}

public final class MockCodexRunningSession: CodexRunningSession, @unchecked Sendable {
  private let lock = NSLock()
  public let sessionId: String
  private var queue: [CodexRolloutLine]
  private var closed: Bool
  private let autoComplete: Bool
  private let resultTemplate: CodexSessionResult?

  public init(sessionId: String, messages: [CodexRolloutLine] = [], result: CodexSessionResult? = nil, autoComplete: Bool = true) {
    self.sessionId = sessionId
    self.queue = messages
    self.closed = false
    self.autoComplete = autoComplete
    self.resultTemplate = result
  }

  public func getState() -> [String: String] {
    lock.lock()
    defer { lock.unlock() }
    return ["status": closed ? "completed" : "running"]
  }

  public func pushMessage(_ message: CodexRolloutLine) throws {
    lock.lock()
    defer { lock.unlock() }
    if closed {
      throw CodexMockSessionError.closed(sessionId)
    }
    queue.append(message)
  }

  public func messages() -> [CodexRolloutLine] {
    lock.lock()
    defer { lock.unlock() }
    if autoComplete {
      closed = true
    }
    return queue
  }

  public func waitForCompletion() -> CodexSessionResult {
    lock.lock()
    let messageCount = queue.count
    closed = true
    lock.unlock()
    if let resultTemplate {
      return resultTemplate
    }
    let now = ISO8601DateFormatter().string(from: Date())
    return CodexSessionResult(success: true, exitCode: 0, startedAt: now, completedAt: now, messageCount: messageCount)
  }

  public func cancel() -> CodexSessionResult {
    lock.lock()
    let messageCount = queue.count
    closed = true
    lock.unlock()
    let now = ISO8601DateFormatter().string(from: Date())
    return CodexSessionResult(success: false, exitCode: 130, startedAt: now, completedAt: now, messageCount: messageCount)
  }
}

public final class MockCodexSessionRunner: CodexSessionRunner, @unchecked Sendable {
  public typealias Session = MockCodexRunningSession
  private let lock = NSLock()
  private var startSessions: [MockCodexRunningSession] = []
  private var resumeSessions: [MockCodexRunningSession] = []
  private var storedStartSessionCalls: [CodexMockStartSessionCall] = []
  private var storedResumeSessionCalls: [CodexMockResumeSessionCall] = []

  public init() {}

  public var startSessionCalls: [CodexMockStartSessionCall] {
    lock.lock()
    defer { lock.unlock() }
    return storedStartSessionCalls
  }

  public var resumeSessionCalls: [CodexMockResumeSessionCall] {
    lock.lock()
    defer { lock.unlock() }
    return storedResumeSessionCalls
  }

  public func enqueueStartSession(_ session: MockCodexRunningSession) {
    lock.lock()
    startSessions.append(session)
    lock.unlock()
  }

  public func enqueueResumeSession(_ session: MockCodexRunningSession) {
    lock.lock()
    resumeSessions.append(session)
    lock.unlock()
  }

  public func startSession(config: CodexSessionConfig) throws -> MockCodexRunningSession {
    lock.lock()
    storedStartSessionCalls.append(CodexMockStartSessionCall(config: config))
    guard !startSessions.isEmpty else {
      lock.unlock()
      throw CodexMockSessionError.noQueuedSession("start")
    }
    let session = startSessions.removeFirst()
    lock.unlock()
    return session
  }

  public func resumeSession(sessionId: String, prompt: String? = nil, options: CodexProcessOptions = CodexProcessOptions()) throws -> MockCodexRunningSession {
    lock.lock()
    storedResumeSessionCalls.append(CodexMockResumeSessionCall(sessionId: sessionId, prompt: prompt, options: options))
    guard !resumeSessions.isEmpty else {
      lock.unlock()
      throw CodexMockSessionError.noQueuedSession("resume")
    }
    let session = resumeSessions.removeFirst()
    lock.unlock()
    return session
  }
}

public enum CodexMockSessionError: Error, Equatable {
  case closed(String)
  case noQueuedSession(String)
}

public func createMockCodexSessionRunner(startSessions: [MockCodexRunningSession] = [], resumeSessions: [MockCodexRunningSession] = []) -> MockCodexSessionRunner {
  let runner = MockCodexSessionRunner()
  startSessions.forEach { runner.enqueueStartSession($0) }
  resumeSessions.forEach { runner.enqueueResumeSession($0) }
  return runner
}

public enum CodexSDKEventType: String, Hashable, Sendable {
  case sessionStarted = "session.started"
  case sessionUpdated = "session.updated"
  case sessionCompleted = "session.completed"
  case error
}

public final class BasicCodexSDKEventEmitter: @unchecked Sendable {
  public typealias Handler = (JSONObject) -> Void
  private let lock = NSLock()
  private var handlers: [CodexSDKEventType: [UUID: Handler]] = [:]

  public init() {}

  @discardableResult
  public func on(_ event: CodexSDKEventType, handler: @escaping Handler) -> UUID {
    let id = UUID()
    lock.lock()
    var eventHandlers = handlers[event] ?? [:]
    eventHandlers[id] = handler
    handlers[event] = eventHandlers
    lock.unlock()
    return id
  }

  public func off(_ event: CodexSDKEventType, id: UUID) {
    lock.lock()
    handlers[event]?[id] = nil
    lock.unlock()
  }

  public func emit(_ event: CodexSDKEventType, payload: JSONObject) {
    lock.lock()
    let eventHandlers = Array((handlers[event] ?? [:]).values)
    lock.unlock()
    for handler in eventHandlers {
      handler(payload)
    }
  }
}

public struct CodexToolRegistry: Equatable, Sendable {
  private var tools: [String: JSONObject]

  public init(tools: [String: JSONObject] = [:]) {
    self.tools = tools
  }

  public mutating func register(name: String, definition: JSONObject) {
    tools[name] = definition
  }

  public func get(_ name: String) -> JSONObject? {
    tools[name]
  }

  public func listNames() -> [String] {
    tools.keys.sorted()
  }
}

public enum CodexAttachmentKind: Equatable, Sendable {
  case path(String)
  case base64(data: String, mediaType: String?, filename: String?)
}

public enum CodexAgentAttachments {
  public static func imagePathArguments(from attachments: [CodexAttachmentKind], tempDirectory: URL) throws -> [String] {
    try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
    return try attachments.map { attachment in
      switch attachment {
      case let .path(path):
        return path
      case let .base64(data, mediaType, filename):
        let decoded = Data(base64Encoded: data) ?? Data()
        let safeName = sanitizedFilename(filename) ?? "attachment.\(extensionForMediaType(mediaType))"
        let url = tempDirectory.appendingPathComponent(safeName)
        try decoded.write(to: url)
        return url.path
      }
    }
  }

  public static func cleanup(paths: [String]) {
    for path in paths {
      try? FileManager.default.removeItem(atPath: path)
    }
  }

  private static func sanitizedFilename(_ filename: String?) -> String? {
    guard let filename, !filename.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return nil
    }
    let allowed = filename.map { character -> Character in
      character.isLetter || character.isNumber || [".", "-", "_"].contains(character) ? character : "_"
    }
    return String(allowed).split(separator: "/").last.map(String.init)
  }

  private static func extensionForMediaType(_ mediaType: String?) -> String {
    switch mediaType?.lowercased() {
    case "image/png":
      return "png"
    case "image/jpeg", "image/jpg":
      return "jpg"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "bin"
    }
  }
}
