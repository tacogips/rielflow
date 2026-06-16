import Foundation
import RielflowCore

public enum CodexProcessStatus: String, Equatable, Sendable {
  case running
  case exited
  case killed
}

public struct CodexProcessRecord: Equatable, Sendable {
  public var id: String
  public var pid: Int32
  public var command: String
  public var prompt: String
  public var startedAt: String
  public var status: CodexProcessStatus
  public var exitCode: Int32?
  public var input: [String]

  public init(id: String, pid: Int32, command: String, prompt: String, startedAt: String, status: CodexProcessStatus, exitCode: Int32? = nil, input: [String] = []) {
    self.id = id
    self.pid = pid
    self.command = command
    self.prompt = prompt
    self.startedAt = startedAt
    self.status = status
    self.exitCode = exitCode
    self.input = input
  }
}

public struct CodexProcessExecution: Equatable, Sendable {
  public var stdout: String
  public var stderr: String
  public var exitCode: Int32

  public init(stdout: String = "", stderr: String = "", exitCode: Int32 = 0) {
    self.stdout = stdout
    self.stderr = stderr
    self.exitCode = exitCode
  }
}

public struct CodexExecStreamResult: Equatable, Sendable {
  public var process: CodexProcessRecord
  public var lines: [CodexRolloutLine]
  public var completionExitCode: Int32
}

public final class CodexProcessManager: @unchecked Sendable {
  public typealias Executor = @Sendable ([String], String, [String: String]) -> CodexProcessExecution
  private let lock = NSLock()
  private let executableName: String
  private let executor: Executor
  private var records: [String: CodexProcessRecord] = [:]
  private var nextPid: Int32 = 10_000

  public init(executableName: String = "codex", executor: @escaping Executor = { _, _, _ in CodexProcessExecution() }) {
    self.executableName = executableName
    self.executor = executor
  }

  public func spawnExec(prompt: String, options: CodexProcessOptions = CodexProcessOptions()) -> (process: CodexProcessRecord, result: CodexProcessExecution) {
    run(prompt: prompt, arguments: CodexProcessCommandBuilder.buildExecArguments(prompt: prompt, options: options), options: options)
  }

  public func spawnResume(sessionId: String, prompt: String? = nil, options: CodexProcessOptions = CodexProcessOptions()) -> (process: CodexProcessRecord, result: CodexProcessExecution) {
    run(prompt: prompt ?? "", arguments: CodexProcessCommandBuilder.buildResumeArguments(sessionId: sessionId, prompt: prompt, options: options), options: options)
  }

  public func spawnFork(sessionId: String, nthMessage: Int? = nil, options: CodexProcessOptions = CodexProcessOptions()) -> (process: CodexProcessRecord, result: CodexProcessExecution) {
    run(prompt: "", arguments: CodexProcessCommandBuilder.buildForkArguments(sessionId: sessionId, nthMessage: nthMessage, options: options), options: options)
  }

  public func spawnExecStream(prompt: String, options: CodexProcessOptions = CodexProcessOptions()) -> CodexExecStreamResult {
    let executed = spawnExec(prompt: prompt, options: options)
    return CodexExecStreamResult(process: executed.process, lines: parseStdoutLines(executed.result.stdout), completionExitCode: executed.result.exitCode)
  }

  public func spawnResumeStream(sessionId: String, prompt: String? = nil, options: CodexProcessOptions = CodexProcessOptions()) -> CodexExecStreamResult {
    let executed = spawnResume(sessionId: sessionId, prompt: prompt, options: options)
    return CodexExecStreamResult(process: executed.process, lines: parseStdoutLines(executed.result.stdout), completionExitCode: executed.result.exitCode)
  }

  public func list() -> [CodexProcessRecord] {
    lock.lock()
    defer { lock.unlock() }
    return records.values.sorted { $0.startedAt < $1.startedAt }
  }

  public func get(id: String) -> CodexProcessRecord? {
    lock.lock()
    defer { lock.unlock() }
    return records[id]
  }

  public func kill(id: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var record = records[id], record.status == .running else {
      return false
    }
    record.status = .killed
    records[id] = record
    return true
  }

  public func writeInput(id: String, text: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var record = records[id], record.status == .running else {
      return false
    }
    record.input.append(text)
    records[id] = record
    return true
  }

  public func killAll() {
    lock.lock()
    records = records.mapValues { record in
      var next = record
      if next.status == .running {
        next.status = .killed
      }
      return next
    }
    lock.unlock()
  }

  public func prune() {
    lock.lock()
    records = records.filter { $0.value.status == .running }
    lock.unlock()
  }

  private func run(prompt: String, arguments: [String], options: CodexProcessOptions) -> (process: CodexProcessRecord, result: CodexProcessExecution) {
    let allArguments = [executableName] + arguments
    let environment = CodexProcessCommandBuilder.buildEnvironment(options: options)
    lock.lock()
    let id = UUID().uuidString
    let pid = nextPid
    nextPid += 1
    let startedAt = ISO8601DateFormatter().string(from: Date())
    var record = CodexProcessRecord(id: id, pid: pid, command: allArguments.joined(separator: " "), prompt: prompt, startedAt: startedAt, status: .running)
    records[id] = record
    lock.unlock()

    let result = executor(allArguments, prompt, environment)
    lock.lock()
    record.status = .exited
    record.exitCode = result.exitCode
    records[id] = record
    lock.unlock()
    return (record, result)
  }
}

public enum CodexAgentSDK {
  public enum StreamMode: String, Equatable, Sendable {
    case raw
    case normalized
  }

  public struct Request: Equatable, Sendable {
    public var prompt: String?
    public var sessionId: String?
    public var options: CodexProcessOptions
    public var streamMode: StreamMode

    public init(prompt: String? = nil, sessionId: String? = nil, options: CodexProcessOptions = CodexProcessOptions(), streamMode: StreamMode = .raw) {
      self.prompt = prompt
      self.sessionId = sessionId
      self.options = options
      self.streamMode = streamMode
    }
  }

  public static func runAgent<Runner: CodexSessionRunner>(request: Request, runner: Runner) throws -> [CodexAgentNormalizedEvent] {
    let session: Runner.Session
    if let sessionId = request.sessionId {
      session = try runner.resumeSession(sessionId: sessionId, prompt: request.prompt, options: request.options)
    } else {
      session = try runner.startSession(config: CodexSessionConfig(prompt: request.prompt ?? "", options: request.options))
    }
    var normalizer = CodexAgentEventNormalizer()
    let normalized = session.messages().flatMap { line -> [CodexAgentNormalizedEvent] in
      var chunk: JSONObject = ["type": .string(line.type), "payload": line.payload]
      if line.type == "assistant.snapshot", let content = line.payloadObject?["content"] {
        chunk["content"] = content
      }
      return normalizer.normalize(chunk, fallbackSessionId: session.sessionId, includeSessionStarted: true)
    }
    _ = session.waitForCompletion()
    return normalized
  }
}

public final class CodexProcessRunningSession: CodexRunningSession, @unchecked Sendable {
  private let lock = NSLock()
  public let sessionId: String
  private let processRecord: CodexProcessRecord
  private let streamResult: CodexExecStreamResult
  private var closed = false

  public init(sessionId: String, processRecord: CodexProcessRecord, streamResult: CodexExecStreamResult) {
    self.sessionId = sessionId
    self.processRecord = processRecord
    self.streamResult = streamResult
  }

  public func getState() -> [String: String] {
    lock.lock()
    defer { lock.unlock() }
    return [
      "sessionId": sessionId,
      "processId": processRecord.id,
      "status": closed ? "completed" : "running",
    ]
  }

  public func pushMessage(_ message: CodexRolloutLine) throws {
    throw CodexProcessSessionError.readOnlySession
  }

  public func messages() -> [CodexRolloutLine] {
    streamResult.lines
  }

  public func waitForCompletion() -> CodexSessionResult {
    lock.lock()
    closed = true
    lock.unlock()
    let now = ISO8601DateFormatter().string(from: Date())
    return CodexSessionResult(success: streamResult.completionExitCode == 0, exitCode: streamResult.completionExitCode, startedAt: processRecord.startedAt, completedAt: now, messageCount: streamResult.lines.count)
  }

  public func cancel() -> CodexSessionResult {
    lock.lock()
    closed = true
    lock.unlock()
    let now = ISO8601DateFormatter().string(from: Date())
    return CodexSessionResult(success: false, exitCode: 130, startedAt: processRecord.startedAt, completedAt: now, messageCount: streamResult.lines.count)
  }
}

public final class CodexProcessSessionRunner: CodexSessionRunner, @unchecked Sendable {
  public typealias Session = CodexProcessRunningSession
  private let processManager: CodexProcessManager

  public init(processManager: CodexProcessManager = CodexProcessManager()) {
    self.processManager = processManager
  }

  public func startSession(config: CodexSessionConfig) throws -> CodexProcessRunningSession {
    let result = processManager.spawnExecStream(prompt: config.prompt, options: config.options)
    return CodexProcessRunningSession(sessionId: sessionId(from: result.lines) ?? result.process.id, processRecord: result.process, streamResult: result)
  }

  public func resumeSession(sessionId: String, prompt: String?, options: CodexProcessOptions) throws -> CodexProcessRunningSession {
    let result = processManager.spawnResumeStream(sessionId: sessionId, prompt: prompt, options: options)
    return CodexProcessRunningSession(sessionId: sessionId, processRecord: result.process, streamResult: result)
  }

  private func sessionId(from lines: [CodexRolloutLine]) -> String? {
    for line in lines where line.type == "session_meta" {
      guard let object = line.payloadObject else {
        continue
      }
      if case let .object(meta)? = object["meta"], case let .string(id)? = meta["id"] {
        return id
      }
      if case let .string(id)? = object["session_id"] ?? object["sessionId"] ?? object["id"] {
        return id
      }
    }
    return nil
  }
}

public enum CodexProcessSessionError: Error, Equatable {
  case readOnlySession
}

private func parseStdoutLines(_ stdout: String) -> [CodexRolloutLine] {
  stdout.split(separator: "\n", omittingEmptySubsequences: true).compactMap { CodexRolloutReader.parseRolloutLine(String($0)) }
}

private extension CodexRolloutLine {
  var payloadObject: JSONObject? {
    guard case let .object(object) = payload else {
      return nil
    }
    return object
  }
}
