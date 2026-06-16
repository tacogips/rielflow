import Foundation
import RielflowCore

struct LoadedPersistedCLIWorkflowSession: Equatable, Sendable {
  var record: PersistedCLIWorkflowSession
  var storeRoot: String
}

enum CLIWorkflowSessionResolution {
  static func resolutionForPersistence(
    resolution: WorkflowResolutionOptions,
    resolvedSourceScope: WorkflowScope
  ) -> WorkflowResolutionOptions {
    var persisted = resolution
    if persisted.workflowDefinitionDir == nil, persisted.scope == .auto {
      persisted.scope = resolvedSourceScope
    }
    return persisted
  }

  static func effectiveResolution(
    persisted: PersistedCLIWorkflowSession,
    scope: WorkflowScope,
    workflowDefinitionDir: String?,
    workingDirectory: String
  ) -> WorkflowResolutionOptions {
    let effectiveScope: WorkflowScope
    if workflowDefinitionDir != nil {
      effectiveScope = .direct
    } else if scope == .auto {
      effectiveScope = persisted.resolution.scope
    } else {
      effectiveScope = scope
    }
    return WorkflowResolutionOptions(
      workflowName: persisted.workflowName,
      scope: effectiveScope,
      workflowDefinitionDir: workflowDefinitionDir ?? persisted.resolution.workflowDefinitionDir,
      workingDirectory: workingDirectory
    )
  }

  static func loadPersistedSession(
    sessionId: String,
    sessionStore: String?,
    scope: WorkflowScope,
    workingDirectory: String,
    environment: [String: String] = CLIRuntimeEnvironment.mergedProcessEnvironment()
  ) throws -> LoadedPersistedCLIWorkflowSession {
    if usesExplicitSessionStoreRoot(sessionStore: sessionStore, environment: environment) {
      let storeRoot = CLIWorkflowSessionStore.resolveRootDirectory(
        sessionStore: sessionStore,
        scope: scope,
        workingDirectory: workingDirectory,
        environment: environment
      )
      let record = try CLIWorkflowSessionStore(rootDirectory: storeRoot).load(sessionId: sessionId)
      return LoadedPersistedCLIWorkflowSession(record: record, storeRoot: storeRoot)
    }

    var lastError: CLIWorkflowSessionStoreError?
    for searchScope in sessionStoreSearchScopes(for: scope) {
      let storeRoot = CLIWorkflowSessionStore.resolveRootDirectory(
        sessionStore: nil,
        scope: searchScope,
        workingDirectory: workingDirectory,
        environment: environment
      )
      do {
        let record = try CLIWorkflowSessionStore(rootDirectory: storeRoot).load(sessionId: sessionId)
        return LoadedPersistedCLIWorkflowSession(record: record, storeRoot: storeRoot)
      } catch let error as CLIWorkflowSessionStoreError {
        if case .notFound = error {
          lastError = error
          continue
        }
        throw error
      }
    }
    throw lastError ?? CLIWorkflowSessionStoreError.notFound("session not found: \(sessionId)")
  }

  static func saveStoreRoot(
    sessionStore: String?,
    scope: WorkflowScope,
    workingDirectory: String,
    loadedFromStoreRoot: String,
    environment: [String: String] = CLIRuntimeEnvironment.mergedProcessEnvironment()
  ) -> String {
    if usesExplicitSessionStoreRoot(sessionStore: sessionStore, environment: environment) {
      return CLIWorkflowSessionStore.resolveRootDirectory(
        sessionStore: sessionStore,
        scope: scope,
        workingDirectory: workingDirectory,
        environment: environment
      )
    }
    return loadedFromStoreRoot
  }

  private static func usesExplicitSessionStoreRoot(
    sessionStore: String?,
    environment: [String: String]
  ) -> Bool {
    if let sessionStore, !sessionStore.isEmpty {
      return true
    }
    if let envRoot = environment["RIEL_SESSION_STORE"], !envRoot.isEmpty {
      return true
    }
    return false
  }

  private static func sessionStoreSearchScopes(for scope: WorkflowScope) -> [WorkflowScope] {
    switch scope {
    case .auto:
      return [.project, .user]
    case .user:
      return [.user]
    case .project, .direct:
      return [.project]
    }
  }
}
