import Darwin
import Foundation
import RielflowCore

public struct LocalAgentProcessConfiguration: Equatable, Sendable {
  public var executableURL: URL
  public var arguments: [String]
  public var environment: [String: String]
  public var workingDirectoryURL: URL?

  public init(
    executableURL: URL,
    arguments: [String] = [],
    environment: [String: String] = [:],
    workingDirectoryURL: URL? = nil
  ) {
    self.executableURL = executableURL
    self.arguments = arguments
    self.environment = environment
    self.workingDirectoryURL = workingDirectoryURL
  }
}

public struct LocalAgentProcessResult: Equatable, Sendable {
  public var stdout: String
  public var stderr: String
  public var terminationStatus: Int32

  public init(stdout: String, stderr: String, terminationStatus: Int32) {
    self.stdout = stdout
    self.stderr = stderr
    self.terminationStatus = terminationStatus
  }
}

public protocol LocalAgentProcessRunning: Sendable {
  func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date?) async throws -> LocalAgentProcessResult
}

private final class LockedProcessData: @unchecked Sendable {
  private let lock = NSLock()
  private var data = Data()

  func store(_ value: Data) {
    lock.lock()
    data = value
    lock.unlock()
  }

  func load() -> Data {
    lock.lock()
    defer { lock.unlock() }
    return data
  }
}

private final class LocalProcessPipeReader: @unchecked Sendable {
  private let fileHandle: FileHandle

  init(fileHandle: FileHandle) {
    self.fileHandle = fileHandle
  }

  func readToEnd() -> Data {
    fileHandle.readDataToEndOfFile()
  }
}

private final class LocalProcessPipes: @unchecked Sendable {
  private let inputPipe: Pipe
  private let outputPipe: Pipe
  private let errorPipe: Pipe
  private let lock = NSLock()

  init(inputPipe: Pipe, outputPipe: Pipe, errorPipe: Pipe) {
    self.inputPipe = inputPipe
    self.outputPipe = outputPipe
    self.errorPipe = errorPipe
  }

  func closeParentOutputWriters() {
    lock.lock()
    defer { lock.unlock() }
    try? outputPipe.fileHandleForWriting.close()
    try? errorPipe.fileHandleForWriting.close()
  }

  func closeForFailureOrTimeout() {
    lock.lock()
    defer { lock.unlock() }
    try? inputPipe.fileHandleForWriting.close()
    try? outputPipe.fileHandleForWriting.close()
    try? outputPipe.fileHandleForReading.close()
    try? errorPipe.fileHandleForWriting.close()
    try? errorPipe.fileHandleForReading.close()
  }
}

private final class LocalProcessCompletion: @unchecked Sendable {
  private let lock = NSLock()
  private var didResume = false
  private var didTimeout = false
  private var deadlineWorkItem: DispatchWorkItem?
  private let continuation: CheckedContinuation<LocalAgentProcessResult, Error>

  init(continuation: CheckedContinuation<LocalAgentProcessResult, Error>) {
    self.continuation = continuation
  }

  func setDeadlineWorkItem(_ workItem: DispatchWorkItem) {
    lock.lock()
    deadlineWorkItem = workItem
    lock.unlock()
  }

  func markTimedOut() {
    lock.lock()
    didTimeout = true
    lock.unlock()
  }

  func timedOut() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return didTimeout
  }

  func cancelDeadline() {
    lock.lock()
    let workItem = deadlineWorkItem
    lock.unlock()
    workItem?.cancel()
  }

  func resume(_ result: Result<LocalAgentProcessResult, Error>) {
    lock.lock()
    guard !didResume else {
      lock.unlock()
      return
    }
    didResume = true
    let workItem = deadlineWorkItem
    lock.unlock()

    workItem?.cancel()
    switch result {
    case let .success(value):
      continuation.resume(returning: value)
    case let .failure(error):
      continuation.resume(throwing: error)
    }
  }
}

private final class CStringArray {
  private var pointers: [UnsafeMutablePointer<CChar>?]

  init(_ strings: [String]) {
    pointers = strings.map { strdup($0) }
    pointers.append(nil)
  }

  deinit {
    for pointer in pointers where pointer != nil {
      free(pointer)
    }
  }

  func withUnsafeMutableBufferPointer<Result>(
    _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>?) throws -> Result
  ) rethrows -> Result {
    try pointers.withUnsafeMutableBufferPointer { buffer in
      try body(buffer.baseAddress)
    }
  }
}

typealias LocalProcessSignal = @Sendable (pid_t, Int32) -> Int32

final class LocalProcessHandle: @unchecked Sendable {
  private let lock = NSLock()
  private var processId: pid_t?
  private var processGroupId: pid_t?
  private var didExit = false
  private var killWorkItem: DispatchWorkItem?
  private let signalProcess: LocalProcessSignal

  init(signalProcess: @escaping LocalProcessSignal = { processId, signal in kill(processId, signal) }) {
    self.signalProcess = signalProcess
  }

  func store(processId: pid_t) {
    lock.lock()
    guard !didExit else {
      lock.unlock()
      return
    }
    self.processId = processId
    self.processGroupId = processId
    lock.unlock()
  }

  @discardableResult
  func terminateGroupOrProcess() -> Bool {
    signalGroupOrProcess(SIGTERM)
  }

  @discardableResult
  func killGroupOrProcess() -> Bool {
    signalGroupOrProcess(SIGKILL)
  }

  @discardableResult
  func scheduleKillIfRunning(after delay: TimeInterval) -> Bool {
    let workItem = DispatchWorkItem {
      self.killScheduledProcessGroup()
    }
    lock.lock()
    guard processGroupId != nil else {
      lock.unlock()
      workItem.cancel()
      return false
    }
    killWorkItem?.cancel()
    killWorkItem = workItem
    lock.unlock()

    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay, execute: workItem)
    return true
  }

  func markExited(afterTimeout: Bool = false) {
    lock.lock()
    didExit = true
    processId = nil
    let groupId = processGroupId
    let workItem = killWorkItem
    lock.unlock()

    if afterTimeout, let groupId, processGroupIsLive(groupId) {
      return
    }

    lock.lock()
    processGroupId = nil
    killWorkItem = nil
    lock.unlock()
    workItem?.cancel()
  }

  private func killScheduledProcessGroup() {
    lock.lock()
    let groupId = processGroupId
    lock.unlock()
    guard let groupId else {
      return
    }
    guard processGroupIsLive(groupId) else {
      clearScheduledProcessGroup(groupId)
      return
    }
    clearScheduledProcessGroup(groupId)
    _ = signalProcess(-groupId, SIGKILL)
  }

  private func clearScheduledProcessGroup(_ groupId: pid_t) {
    lock.lock()
    if processGroupId == groupId {
      processGroupId = nil
      killWorkItem = nil
    }
    lock.unlock()
  }

  private func processGroupIsLive(_ groupId: pid_t) -> Bool {
    signalProcess(-groupId, 0) == 0
  }

  private func signalGroupOrProcess(_ signal: Int32) -> Bool {
    lock.lock()
    let groupId = processGroupId
    let pid = didExit ? nil : processId
    lock.unlock()
    guard let groupId else {
      return false
    }
    if signalProcess(-groupId, signal) == 0 {
      return true
    }
    guard let pid else {
      return false
    }
    return signalProcess(pid, signal) == 0
  }
}

private func localProcessTimeoutError() -> AdapterExecutionError {
  AdapterExecutionError(.timeout, "local agent process exceeded deadline and was terminated")
}

private func spawnProcess(
  configuration: LocalAgentProcessConfiguration,
  inputReadDescriptor: Int32,
  inputWriteDescriptor: Int32,
  outputReadDescriptor: Int32,
  outputWriteDescriptor: Int32,
  errorReadDescriptor: Int32,
  errorWriteDescriptor: Int32
) throws -> pid_t {
  var fileActions: posix_spawn_file_actions_t?
  var attributes: posix_spawnattr_t?
  posix_spawn_file_actions_init(&fileActions)
  posix_spawnattr_init(&attributes)
  defer {
    posix_spawn_file_actions_destroy(&fileActions)
    posix_spawnattr_destroy(&attributes)
  }

  try checkPosixSpawn(posix_spawn_file_actions_adddup2(&fileActions, inputReadDescriptor, STDIN_FILENO), operation: "dup stdin")
  try checkPosixSpawn(posix_spawn_file_actions_adddup2(&fileActions, outputWriteDescriptor, STDOUT_FILENO), operation: "dup stdout")
  try checkPosixSpawn(posix_spawn_file_actions_adddup2(&fileActions, errorWriteDescriptor, STDERR_FILENO), operation: "dup stderr")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, inputReadDescriptor), operation: "close child stdin pipe")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, inputWriteDescriptor), operation: "close child stdin writer")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, outputReadDescriptor), operation: "close child stdout reader")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, outputWriteDescriptor), operation: "close child stdout pipe")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, errorReadDescriptor), operation: "close child stderr reader")
  try checkPosixSpawn(posix_spawn_file_actions_addclose(&fileActions, errorWriteDescriptor), operation: "close child stderr pipe")
  if let workingDirectoryURL = configuration.workingDirectoryURL {
    try workingDirectoryURL.path.withCString { path in
      try checkPosixSpawn(posix_spawn_file_actions_addchdir_np(&fileActions, path), operation: "set working directory")
    }
  }

  try checkPosixSpawn(
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETPGROUP)),
    operation: "set process-group flag"
  )
  try checkPosixSpawn(posix_spawnattr_setpgroup(&attributes, 0), operation: "set child process group")

  let arguments = [configuration.executableURL.path] + configuration.arguments
  let environment = ProcessInfo.processInfo.environment
    .merging(configuration.environment) { _, new in new }
    .map { "\($0.key)=\($0.value)" }
  let argv = CStringArray(arguments)
  let envp = CStringArray(environment)
  var processId = pid_t()

  let spawnResult = configuration.executableURL.path.withCString { executablePath in
    argv.withUnsafeMutableBufferPointer { argvPointer in
      envp.withUnsafeMutableBufferPointer { envPointer in
        posix_spawn(&processId, executablePath, &fileActions, &attributes, argvPointer, envPointer)
      }
    }
  }
  try checkPosixSpawn(spawnResult, operation: "spawn \(configuration.executableURL.path)")
  return processId
}

private func checkPosixSpawn(_ result: Int32, operation: String) throws {
  guard result == 0 else {
    throw AdapterExecutionError(.providerError, "local agent process failed to \(operation): \(String(cString: strerror(result)))")
  }
}

private func terminationStatus(fromWaitStatus status: Int32) -> Int32 {
  if status & 0x7f == 0 {
    return (status >> 8) & 0xff
  }
  return -(status & 0x7f)
}

public struct FoundationLocalAgentProcessRunner: LocalAgentProcessRunning {
  public init() {}

  public func run(configuration: LocalAgentProcessConfiguration, stdin: String, deadline: Date? = nil) async throws -> LocalAgentProcessResult {
    try await withCheckedThrowingContinuation { continuation in
      let inputPipe = Pipe()
      let outputPipe = Pipe()
      let errorPipe = Pipe()
      let processHandle = LocalProcessHandle()
      let pipes = LocalProcessPipes(inputPipe: inputPipe, outputPipe: outputPipe, errorPipe: errorPipe)

      let outputGroup = DispatchGroup()
      let outputData = LockedProcessData()
      let errorData = LockedProcessData()
      let outputReader = LocalProcessPipeReader(fileHandle: outputPipe.fileHandleForReading)
      let errorReader = LocalProcessPipeReader(fileHandle: errorPipe.fileHandleForReading)

      outputGroup.enter()
      DispatchQueue.global(qos: .utility).async {
        outputData.store(outputReader.readToEnd())
        outputGroup.leave()
      }

      outputGroup.enter()
      DispatchQueue.global(qos: .utility).async {
        errorData.store(errorReader.readToEnd())
        outputGroup.leave()
      }

      let completion = LocalProcessCompletion(continuation: continuation)

      do {
        let processId = try spawnProcess(
          configuration: configuration,
          inputReadDescriptor: inputPipe.fileHandleForReading.fileDescriptor,
          inputWriteDescriptor: inputPipe.fileHandleForWriting.fileDescriptor,
          outputReadDescriptor: outputPipe.fileHandleForReading.fileDescriptor,
          outputWriteDescriptor: outputPipe.fileHandleForWriting.fileDescriptor,
          errorReadDescriptor: errorPipe.fileHandleForReading.fileDescriptor,
          errorWriteDescriptor: errorPipe.fileHandleForWriting.fileDescriptor
        )
        processHandle.store(processId: processId)
        try? inputPipe.fileHandleForReading.close()
        pipes.closeParentOutputWriters()

        DispatchQueue.global(qos: .utility).async {
          var status: Int32 = 0
          _ = waitpid(processId, &status, 0)
          processHandle.markExited(afterTimeout: completion.timedOut())
          completion.cancelDeadline()
          outputGroup.notify(queue: .global(qos: .utility)) {
            if completion.timedOut() {
              return
            }

            let output = String(data: outputData.load(), encoding: .utf8) ?? ""
            let error = String(data: errorData.load(), encoding: .utf8) ?? ""
            completion.resume(
              .success(
                LocalAgentProcessResult(
                  stdout: output,
                  stderr: error,
                  terminationStatus: terminationStatus(fromWaitStatus: status)
                )
              )
            )
          }
        }

        if let deadline {
          let delay = max(0, deadline.timeIntervalSinceNow)
          let workItem = DispatchWorkItem {
            completion.markTimedOut()
            pipes.closeForFailureOrTimeout()
            if processHandle.terminateGroupOrProcess() {
              processHandle.scheduleKillIfRunning(after: 1)
            }
            completion.resume(.failure(localProcessTimeoutError()))
          }
          completion.setDeadlineWorkItem(workItem)
          DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + delay, execute: workItem)
        }
        inputPipe.fileHandleForWriting.write(Data(stdin.utf8))
        try inputPipe.fileHandleForWriting.close()
      } catch {
        pipes.closeForFailureOrTimeout()
        processHandle.terminateGroupOrProcess()
        if completion.timedOut() {
          completion.resume(.failure(localProcessTimeoutError()))
        } else {
          completion.resume(.failure(error))
        }
      }
    }
  }
}

public struct LocalAgentCommandAdapter: NodeAdapter {
  public var provider: String
  public var executableName: String
  public var baseArguments: [String]
  public var runner: any LocalAgentProcessRunning

  public init(
    provider: String,
    executableName: String,
    baseArguments: [String],
    runner: any LocalAgentProcessRunning = FoundationLocalAgentProcessRunner()
  ) {
    self.provider = provider
    self.executableName = executableName
    self.baseArguments = baseArguments
    self.runner = runner
  }

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    let prompt = buildCombinedPromptText(promptText: input.promptText, systemPromptText: input.systemPromptText)
    let executableURL = URL(fileURLWithPath: "/usr/bin/env")
    let workingDirectory = input.node.workingDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
    let configuration = LocalAgentProcessConfiguration(
      executableURL: executableURL,
      arguments: [executableName] + baseArguments + ["--model", input.node.model],
      environment: ["RIEL_AGENT_BACKEND": provider],
      workingDirectoryURL: workingDirectory
    )

    let result = try await runner.run(configuration: configuration, stdin: prompt, deadline: context.deadline)
    guard result.terminationStatus == 0 else {
      let detail = redactSensitiveText(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
      throw AdapterExecutionError(.providerError, "\(provider) failed with exit code \(result.terminationStatus): \(detail)")
    }

    let responseText = normalizeProviderStdout(result.stdout, provider: provider)
    let normalized = try normalizeAgentOutput(responseText, source: provider, requiresOutputContract: input.node.output != nil)
    return AdapterExecutionOutput(
      provider: provider,
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: normalized.completionPassed,
      when: normalized.when,
      payload: normalized.payload
    )
  }

  private func normalizeAgentOutput(
    _ text: String,
    source: String,
    requiresOutputContract: Bool
  ) throws -> OutputContractEnvelopeNormalization {
    guard requiresOutputContract else {
      return OutputContractEnvelopeNormalization(
        completionPassed: true,
        when: ["always": true],
        payload: normalizeTextBusinessPayload(text),
        usedEnvelope: false
      )
    }

    let parsed = try parseJSONObjectCandidate(text, source: source)
    return try normalizeOutputContractEnvelope(parsed, source: source)
  }
}

private func normalizeProviderStdout(_ text: String, provider: String) -> String {
  guard provider == CliAgentBackend.codexAgent.rawValue else {
    return text
  }
  return normalizeCodexExecJSONStdout(text)
}

private func normalizeCodexExecJSONStdout(_ text: String) -> String {
  let lines = text
    .split(whereSeparator: \.isNewline)
    .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
  guard !lines.isEmpty else {
    return text
  }

  var parsedObjects: [JSONObject] = []
  var containsCodexEvent = false
  for line in lines {
    guard
      let data = line.data(using: .utf8),
      let decoded = try? JSONDecoder().decode(JSONValue.self, from: data),
      case let .object(object) = decoded
    else {
      return text
    }
    if isCodexJSONEvent(object) {
      containsCodexEvent = true
    }
    parsedObjects.append(object)
  }
  guard containsCodexEvent else {
    return text
  }

  var finalAssistantContent: String?
  for object in parsedObjects {
    if let content = codexAssistantContent(from: object) {
      finalAssistantContent = content
    }
  }

  return finalAssistantContent ?? ""
}

private func isCodexJSONEvent(_ object: JSONObject) -> Bool {
  switch stringValue(object["type"]) {
  case "session_meta", "response_item", "assistant.snapshot", "session.started", "session.error":
    return true
  default:
    return false
  }
}

private func codexAssistantContent(from object: JSONObject) -> String? {
  if stringValue(object["type"]) == "assistant.snapshot", let content = stringValue(object["content"]) {
    return content
  }

  if stringValue(object["role"]) == "assistant", let content = outputText(from: object["content"]) {
    return content
  }

  for key in ["payload", "item", "message"] {
    if let nested = objectValue(object[key]), let content = codexAssistantContent(from: nested) {
      return content
    }
  }

  return nil
}

private func outputText(from value: JSONValue?) -> String? {
  guard let value else {
    return nil
  }
  switch value {
  case let .string(text):
    return text
  case let .array(entries):
    let text = entries.compactMap { entry -> String? in
      guard case let .object(object) = entry else {
        return nil
      }
      let type = stringValue(object["type"])
      if (type == "output_text" || type == "text"), let text = stringValue(object["text"]) {
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

private func redactSensitiveText(_ text: String) -> String {
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
