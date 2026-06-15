import Foundation
import XCTest
@testable import RielflowCLI
@testable import RielflowCore

final class CLIWorkflowSessionResolutionTests: XCTestCase {
  func testPersistenceRecordsResolvedSourceScopeWhenAuto() {
    let resolution = WorkflowResolutionOptions(
      workflowName: "cursor-cli-goal",
      scope: .auto,
      workingDirectory: "/tmp/project"
    )
    let persisted = CLIWorkflowSessionResolution.resolutionForPersistence(
      resolution: resolution,
      resolvedSourceScope: .user
    )
    XCTAssertEqual(persisted.scope, .user)
  }

  func testPersistenceKeepsExplicitScope() {
    let resolution = WorkflowResolutionOptions(
      workflowName: "cursor-cli-goal",
      scope: .project,
      workingDirectory: "/tmp/project"
    )
    let persisted = CLIWorkflowSessionResolution.resolutionForPersistence(
      resolution: resolution,
      resolvedSourceScope: .user
    )
    XCTAssertEqual(persisted.scope, .project)
  }

  func testRerunForwardsPersistedScopeWhenAuto() {
    let session = WorkflowSession(
      workflowId: "cursor-cli-goal",
      sessionId: "sess-1",
      entryStepId: "work",
      createdAt: Date(),
      updatedAt: Date()
    )
    let persisted = PersistedCLIWorkflowSession(
      workflowName: "cursor-cli-goal",
      session: session,
      resolution: WorkflowResolutionOptions(
        workflowName: "cursor-cli-goal",
        scope: .user,
        workingDirectory: "/tmp/project"
      )
    )
    let effective = CLIWorkflowSessionResolution.effectiveResolution(
      persisted: persisted,
      scope: .auto,
      workflowDefinitionDir: nil,
      workingDirectory: "/tmp/project"
    )
    XCTAssertEqual(effective.scope, .user)
  }

  func testRerunExplicitScopeOverridesPersistedScope() {
    let session = WorkflowSession(
      workflowId: "cursor-cli-goal",
      sessionId: "sess-1",
      entryStepId: "work",
      createdAt: Date(),
      updatedAt: Date()
    )
    let persisted = PersistedCLIWorkflowSession(
      workflowName: "cursor-cli-goal",
      session: session,
      resolution: WorkflowResolutionOptions(
        workflowName: "cursor-cli-goal",
        scope: .user,
        workingDirectory: "/tmp/project"
      )
    )
    let effective = CLIWorkflowSessionResolution.effectiveResolution(
      persisted: persisted,
      scope: .project,
      workflowDefinitionDir: nil,
      workingDirectory: "/tmp/project"
    )
    XCTAssertEqual(effective.scope, .project)
  }

  func testLoadPersistedSessionFindsUserScopeStoreWhenCallerScopeAuto() throws {
    let base = makeTempDir()
    let projectRoot = base.appendingPathComponent("project", isDirectory: true)
    let userRoot = base.appendingPathComponent("home", isDirectory: true)
    let userSessions = userRoot.appendingPathComponent(".rielflow/sessions", isDirectory: true)
    try FileManager.default.createDirectory(at: userSessions, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: projectRoot, withIntermediateDirectories: true)

    let session = WorkflowSession(
      workflowId: "cursor-cli-goal",
      sessionId: "sess-user-auto",
      entryStepId: "work",
      createdAt: Date(),
      updatedAt: Date()
    )
    let record = PersistedCLIWorkflowSession(
      workflowName: "cursor-cli-goal",
      session: session,
      resolution: WorkflowResolutionOptions(
        workflowName: "cursor-cli-goal",
        scope: .user,
        workingDirectory: projectRoot.path
      )
    )
    try CLIWorkflowSessionStore(rootDirectory: userSessions.path).save(record)

    let loaded = try CLIWorkflowSessionResolution.loadPersistedSession(
      sessionId: session.sessionId,
      sessionStore: nil,
      scope: .auto,
      workingDirectory: projectRoot.path,
      environment: ["HOME": userRoot.path]
    )

    XCTAssertEqual(loaded.storeRoot, userSessions.path)
    XCTAssertEqual(loaded.record.session.sessionId, session.sessionId)
  }

  func testLoadPersistedSessionPrefersProjectStoreWhenBothExist() throws {
    let base = makeTempDir()
    let projectRoot = base.appendingPathComponent("project", isDirectory: true)
    let userRoot = base.appendingPathComponent("home", isDirectory: true)
    let projectSessions = projectRoot.appendingPathComponent(".rielflow/sessions", isDirectory: true)
    let userSessions = userRoot.appendingPathComponent(".rielflow/sessions", isDirectory: true)
    try FileManager.default.createDirectory(at: projectSessions, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: userSessions, withIntermediateDirectories: true)

    let projectSession = WorkflowSession(
      workflowId: "cursor-cli-goal",
      sessionId: "sess-project",
      entryStepId: "work",
      createdAt: Date(),
      updatedAt: Date()
    )
    let userSession = WorkflowSession(
      workflowId: "cursor-cli-goal",
      sessionId: "sess-user",
      entryStepId: "work",
      createdAt: Date(),
      updatedAt: Date()
    )
    try CLIWorkflowSessionStore(rootDirectory: projectSessions.path).save(
      PersistedCLIWorkflowSession(
        workflowName: "cursor-cli-goal",
        session: projectSession,
        resolution: WorkflowResolutionOptions(workflowName: "cursor-cli-goal", scope: .project, workingDirectory: projectRoot.path)
      )
    )
    try CLIWorkflowSessionStore(rootDirectory: userSessions.path).save(
      PersistedCLIWorkflowSession(
        workflowName: "cursor-cli-goal",
        session: userSession,
        resolution: WorkflowResolutionOptions(workflowName: "cursor-cli-goal", scope: .user, workingDirectory: projectRoot.path)
      )
    )

    let loaded = try CLIWorkflowSessionResolution.loadPersistedSession(
      sessionId: projectSession.sessionId,
      sessionStore: nil,
      scope: .auto,
      workingDirectory: projectRoot.path,
      environment: ["HOME": userRoot.path]
    )

    XCTAssertEqual(loaded.storeRoot, projectSessions.path)
    XCTAssertEqual(loaded.record.session.sessionId, projectSession.sessionId)
  }

  private var tempRoots: [URL] = []

  override func tearDown() {
    for root in tempRoots.reversed() {
      try? FileManager.default.removeItem(at: root)
    }
    tempRoots = []
    super.tearDown()
  }

  private func makeTempDir() -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("rielflow-cli-session-resolution-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    tempRoots.append(url)
    return url
  }
}
