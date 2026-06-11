import XCTest
@testable import RielflowCore

final class RuntimeOutputCandidateTests: XCTestCase {
  func testCandidatePathStagingClearsStaleFileAndFinalizesDirectory() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let staging = FileSystemRuntimeCandidatePathStaging(
      rootDirectory: root,
      clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 200))
    )

    let first = try await staging.prepareCandidatePath(sessionId: "session", stepExecutionId: "exec", attempt: 1)
    try Data("{}".utf8).write(to: first.candidatePath)
    let second = try await staging.prepareCandidatePath(sessionId: "session", stepExecutionId: "exec", attempt: 1)

    XCTAssertEqual(first.candidatePath, second.candidatePath)
    XCTAssertFalse(FileManager.default.fileExists(atPath: second.candidatePath.path))

    try Data(#"{"payload":{"ok":true},"when":{"done":true}}"#.utf8).write(to: second.candidatePath)
    let candidate = try await DefaultCandidatePathReader().readCandidate(
      from: second.candidatePath,
      stagingDirectory: second.stagingDirectory,
      attemptStartedAt: Date(timeIntervalSince1970: 100),
      requiresObjectPayload: true
    )
    XCTAssertEqual(candidate.payload, ["ok": .bool(true)])
    XCTAssertEqual(candidate.when, ["done": true])

    try await staging.finalizeCandidatePath(second)
    XCTAssertFalse(FileManager.default.fileExists(atPath: second.stagingDirectory.path))
  }

  func testCandidatePathStagingRejectsUnsafeIdsAndFinalizeOutsideRoot() async throws {
    let root = temporaryDirectory()
    let outside = temporaryDirectory()
    defer {
      try? FileManager.default.removeItem(at: root)
      try? FileManager.default.removeItem(at: outside)
    }
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root)

    do {
      _ = try await staging.prepareCandidatePath(sessionId: "../escape", stepExecutionId: "exec", attempt: 1)
      XCTFail("expected unsafe session id rejection")
    } catch RuntimeCandidatePathStagingError.unsafePathComponent(let value) {
      XCTAssertEqual(value, "../escape")
    }

    do {
      _ = try await staging.prepareCandidatePath(sessionId: "session", stepExecutionId: "exec/escape", attempt: 1)
      XCTFail("expected unsafe step execution id rejection")
    } catch RuntimeCandidatePathStagingError.unsafePathComponent(let value) {
      XCTAssertEqual(value, "exec/escape")
    }

    do {
      _ = try await staging.prepareCandidatePath(sessionId: "session", stepExecutionId: "exec", attempt: 0)
      XCTFail("expected invalid attempt rejection")
    } catch RuntimeCandidatePathStagingError.invalidAttempt(let attempt) {
      XCTAssertEqual(attempt, 0)
    }

    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    let unsafeReservation = RuntimeCandidatePathReservation(
      stagingDirectory: outside,
      candidatePath: outside.appendingPathComponent("candidate.json"),
      attemptStartedAt: Date(timeIntervalSince1970: 1)
    )
    do {
      try await staging.finalizeCandidatePath(unsafeReservation)
      XCTFail("expected outside-root finalization rejection")
    } catch RuntimeCandidatePathStagingError.stagingPathEscapesRoot(let path) {
      XCTAssertEqual(path, outside.standardizedFileURL.resolvingSymlinksInPath().path)
    }
    XCTAssertTrue(FileManager.default.fileExists(atPath: outside.path))
  }

  func testCandidatePathStagingRejectsSymlinkEscapeUnderSafeComponent() async throws {
    let root = temporaryDirectory()
    let outside = temporaryDirectory()
    defer {
      try? FileManager.default.removeItem(at: root)
      try? FileManager.default.removeItem(at: outside)
    }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(
      at: root.appendingPathComponent("session", isDirectory: true),
      withDestinationURL: outside
    )
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root)

    do {
      _ = try await staging.prepareCandidatePath(sessionId: "session", stepExecutionId: "exec", attempt: 1)
      XCTFail("expected symlink escape rejection")
    } catch RuntimeCandidatePathStagingError.stagingPathEscapesRoot(let path) {
      XCTAssertTrue(path.hasPrefix(outside.standardizedFileURL.resolvingSymlinksInPath().path))
    }
    XCTAssertTrue(FileManager.default.fileExists(atPath: outside.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: outside.appendingPathComponent("exec").path))
  }

  func testCandidatePathReaderRejectsInvalidSubmissions() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let stagingDirectory = root.appendingPathComponent("stage", isDirectory: true)
    try FileManager.default.createDirectory(at: stagingDirectory, withIntermediateDirectories: true)
    let reader = DefaultCandidatePathReader()

    do {
      _ = try await reader.readCandidate(
        from: root.appendingPathComponent("outside.json"),
        stagingDirectory: stagingDirectory,
        attemptStartedAt: Date(timeIntervalSince1970: 100),
        requiresObjectPayload: true
      )
      XCTFail("expected outside-staging rejection")
    } catch RuntimeOutputCandidateError.candidatePathOutsideStaging {}

    let missing = stagingDirectory.appendingPathComponent("missing.json")
    do {
      _ = try await reader.readCandidate(
        from: missing,
        stagingDirectory: stagingDirectory,
        attemptStartedAt: Date(timeIntervalSince1970: 100),
        requiresObjectPayload: true
      )
      XCTFail("expected missing rejection")
    } catch RuntimeOutputCandidateError.missingCandidatePath {}

    let malformed = stagingDirectory.appendingPathComponent("malformed.json")
    try Data("{".utf8).write(to: malformed)
    do {
      _ = try await reader.readCandidate(
        from: malformed,
        stagingDirectory: stagingDirectory,
        attemptStartedAt: Date(timeIntervalSince1970: 100),
        requiresObjectPayload: true
      )
      XCTFail("expected malformed rejection")
    } catch RuntimeOutputCandidateError.malformedCandidateJSON {}

    let nonObject = stagingDirectory.appendingPathComponent("array.json")
    try Data("[]".utf8).write(to: nonObject)
    do {
      _ = try await reader.readCandidate(
        from: nonObject,
        stagingDirectory: stagingDirectory,
        attemptStartedAt: Date(timeIntervalSince1970: 100),
        requiresObjectPayload: true
      )
      XCTFail("expected non-object rejection")
    } catch RuntimeOutputCandidateError.nonObjectCandidate {}

    let stale = stagingDirectory.appendingPathComponent("stale.json")
    try Data(#"{"ok":true}"#.utf8).write(to: stale)
    try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1)], ofItemAtPath: stale.path)
    do {
      _ = try await reader.readCandidate(
        from: stale,
        stagingDirectory: stagingDirectory,
        attemptStartedAt: Date(timeIntervalSince1970: 100),
        requiresObjectPayload: true
      )
      XCTFail("expected stale rejection")
    } catch RuntimeOutputCandidateError.staleCandidatePath {}
  }

  func testPublicationRejectsCandidatePathThatDoesNotMatchReservation() async throws {
    let root = temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = InMemoryWorkflowRuntimeStore(clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let session = try await store.createSession(WorkflowSessionCreateInput(workflowId: "wf", entryStepId: "start"))
    let staging = FileSystemRuntimeCandidatePathStaging(rootDirectory: root, clock: FixedWorkflowRuntimeClock(Date(timeIntervalSince1970: 300)))
    let reservation = try await staging.prepareCandidatePath(sessionId: session.sessionId, stepExecutionId: "exec", attempt: 1)
    let alternatePath = reservation.stagingDirectory.appendingPathComponent("alternate.json")
    try Data(#"{"ok":true}"#.utf8).write(to: alternatePath)
    let publisher = InMemoryWorkflowOutputPublisher(store: store)

    do {
      _ = try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: session.sessionId,
          stepId: "start",
          nodeId: "node-start",
          attempt: 1,
          candidatePath: alternatePath,
          candidatePathReservation: reservation,
          transitions: [WorkflowStepTransition(toStepId: "next")]
        )
      )
      XCTFail("expected non-reserved candidate path rejection")
    } catch RuntimeOutputCandidateError.candidatePathDoesNotMatchReservation(let path) {
      XCTAssertEqual(path, alternatePath.path)
    }

    let loadedSession = try await store.loadSession(id: session.sessionId)
    let listedMessages = try await store.listMessages(for: session.sessionId, toStepId: nil)
    XCTAssertEqual(loadedSession?.executions.first?.status, .failed)
    XCTAssertEqual(listedMessages, [])
  }

  private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
  }
}
