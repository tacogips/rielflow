import Foundation

public struct RuntimeCandidatePathReservation: Equatable, Sendable {
  public var stagingDirectory: URL
  public var candidatePath: URL
  public var attemptStartedAt: Date
  public var finalizationRootDirectory: URL?

  public init(
    stagingDirectory: URL,
    candidatePath: URL,
    attemptStartedAt: Date,
    finalizationRootDirectory: URL? = nil
  ) {
    self.stagingDirectory = stagingDirectory
    self.candidatePath = candidatePath
    self.attemptStartedAt = attemptStartedAt
    self.finalizationRootDirectory = finalizationRootDirectory
  }
}

public protocol RuntimeCandidatePathStaging: Sendable {
  func prepareCandidatePath(
    sessionId: String,
    stepExecutionId: String,
    attempt: Int
  ) async throws -> RuntimeCandidatePathReservation

  func finalizeCandidatePath(_ reservation: RuntimeCandidatePathReservation) async throws
}

public enum RuntimeCandidatePathStagingError: Error, Equatable, Sendable {
  case unsafePathComponent(String)
  case invalidAttempt(Int)
  case stagingPathEscapesRoot(String)
}

public struct FileSystemRuntimeCandidatePathStaging: RuntimeCandidatePathStaging {
  public var rootDirectory: URL
  public var clock: any WorkflowRuntimeClock

  public init(rootDirectory: URL, clock: any WorkflowRuntimeClock = SystemWorkflowRuntimeClock()) {
    self.rootDirectory = rootDirectory
    self.clock = clock
  }

  public func prepareCandidatePath(
    sessionId: String,
    stepExecutionId: String,
    attempt: Int
  ) async throws -> RuntimeCandidatePathReservation {
    let safeSessionId = try safePathComponent(sessionId)
    let safeStepExecutionId = try safePathComponent(stepExecutionId)
    guard attempt > 0 else {
      throw RuntimeCandidatePathStagingError.invalidAttempt(attempt)
    }

    try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
    let root = rootDirectory.standardizedFileURL.resolvingSymlinksInPath()
    let sessionDirectory = root.appendingPathComponent(safeSessionId, isDirectory: true)
    let executionDirectory = sessionDirectory.appendingPathComponent(safeStepExecutionId, isDirectory: true)
    let stagingDirectory = executionDirectory
      .appendingPathComponent("attempt-\(attempt)", isDirectory: true)
      .standardizedFileURL
    try validateExistingPathIfPresent(sessionDirectory, inside: root)
    try validateExistingPathIfPresent(executionDirectory, inside: root)
    try validateExistingPathIfPresent(stagingDirectory, inside: root)
    guard isFileURL(stagingDirectory, inside: root) else {
      throw RuntimeCandidatePathStagingError.stagingPathEscapesRoot(stagingDirectory.path)
    }
    try FileManager.default.createDirectory(at: stagingDirectory, withIntermediateDirectories: true)
    let resolvedStagingDirectory = stagingDirectory.standardizedFileURL.resolvingSymlinksInPath()
    guard isFileURL(resolvedStagingDirectory, inside: root) else {
      throw RuntimeCandidatePathStagingError.stagingPathEscapesRoot(resolvedStagingDirectory.path)
    }
    let candidatePath = resolvedStagingDirectory.appendingPathComponent("candidate.json", isDirectory: false)
    if FileManager.default.fileExists(atPath: candidatePath.path) {
      try FileManager.default.removeItem(at: candidatePath)
    }
    return RuntimeCandidatePathReservation(
      stagingDirectory: resolvedStagingDirectory,
      candidatePath: candidatePath,
      attemptStartedAt: clock.now(),
      finalizationRootDirectory: root
    )
  }

  public func finalizeCandidatePath(_ reservation: RuntimeCandidatePathReservation) async throws {
    try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
    let root = rootDirectory.standardizedFileURL.resolvingSymlinksInPath()
    let stagingDirectory = reservation.stagingDirectory.standardizedFileURL.resolvingSymlinksInPath()
    guard isFileURL(stagingDirectory, inside: root) else {
      throw RuntimeCandidatePathStagingError.stagingPathEscapesRoot(stagingDirectory.path)
    }
    if FileManager.default.fileExists(atPath: reservation.stagingDirectory.path) {
      try FileManager.default.removeItem(at: reservation.stagingDirectory)
    }
  }
}

private func safePathComponent(_ value: String) throws -> String {
  let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
  guard !value.isEmpty, value != ".", value != "..", value.rangeOfCharacter(from: allowed.inverted) == nil else {
    throw RuntimeCandidatePathStagingError.unsafePathComponent(value)
  }
  return value
}

private func isFileURL(_ url: URL, inside directory: URL) -> Bool {
  let path = url.path
  let directoryPath = directory.path
  return path == directoryPath || path.hasPrefix(directoryPath + "/")
}

private func validateExistingPathIfPresent(_ url: URL, inside root: URL) throws {
  if FileManager.default.fileExists(atPath: url.path) {
    let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
    guard isFileURL(resolved, inside: root) else {
      throw RuntimeCandidatePathStagingError.stagingPathEscapesRoot(resolved.path)
    }
  }
}
