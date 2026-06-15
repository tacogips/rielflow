import Foundation
import RielflowAdapters
import RielflowCore

public struct SessionRerunOptions: Equatable, Sendable {
  public var sessionId: String
  public var stepId: String
  public var output: WorkflowOutputFormat
  public var scope: WorkflowScope
  public var workflowDefinitionDir: String?
  public var workingDirectory: String
  public var mockScenarioPath: String?
  public var sessionStore: String?
  public var nestedSuperviser: Bool

  public init(
    sessionId: String,
    stepId: String,
    output: WorkflowOutputFormat = .text,
    scope: WorkflowScope = .auto,
    workflowDefinitionDir: String? = nil,
    workingDirectory: String = FileManager.default.currentDirectoryPath,
    mockScenarioPath: String? = nil,
    sessionStore: String? = nil,
    nestedSuperviser: Bool = false
  ) {
    self.sessionId = sessionId
    self.stepId = stepId
    self.output = output
    self.scope = scope
    self.workflowDefinitionDir = workflowDefinitionDir
    self.workingDirectory = workingDirectory
    self.mockScenarioPath = mockScenarioPath
    self.sessionStore = sessionStore
    self.nestedSuperviser = nestedSuperviser
  }
}

public struct SessionResumeOptions: Equatable, Sendable {
  public var sessionId: String
  public var output: WorkflowOutputFormat
  public var scope: WorkflowScope
  public var workflowDefinitionDir: String?
  public var workingDirectory: String
  public var mockScenarioPath: String?
  public var sessionStore: String?

  public init(
    sessionId: String,
    output: WorkflowOutputFormat = .text,
    scope: WorkflowScope = .auto,
    workflowDefinitionDir: String? = nil,
    workingDirectory: String = FileManager.default.currentDirectoryPath,
    mockScenarioPath: String? = nil,
    sessionStore: String? = nil
  ) {
    self.sessionId = sessionId
    self.output = output
    self.scope = scope
    self.workflowDefinitionDir = workflowDefinitionDir
    self.workingDirectory = workingDirectory
    self.mockScenarioPath = mockScenarioPath
    self.sessionStore = sessionStore
  }
}

public struct SessionRerunCommandResult: Codable, Equatable, Sendable {
  public var sourceSessionId: String
  public var sessionId: String
  public var status: WorkflowSessionStatus
  public var rerunFromStepId: String
  public var exitCode: Int32
}

public struct SessionResumeCommandResult: Codable, Equatable, Sendable {
  public var sessionId: String
  public var status: WorkflowSessionStatus
  public var exitCode: Int32
}

public struct SessionCommandFailureResult: Codable, Equatable, Sendable {
  public var sessionId: String
  public var error: String
  public var exitCode: Int32
}

public struct SessionRerunCommand: Sendable {
  public var resolver: any WorkflowBundleResolving
  public var jsonLoader: JSONReferenceLoader

  public init(
    resolver: any WorkflowBundleResolving = FileSystemWorkflowBundleResolver(),
    jsonLoader: JSONReferenceLoader = JSONReferenceLoader()
  ) {
    self.resolver = resolver
    self.jsonLoader = jsonLoader
  }

  public func run(_ options: SessionRerunOptions) async -> CLICommandResult {
    if options.nestedSuperviser {
      return failure(
        options: options,
        exitCode: .usage,
        error: "--nested-supervisor / --nested-superviser is not supported for session rerun; use workflow run or session resume with --auto-improve instead"
      )
    }
    do {
      let loaded = try CLIWorkflowSessionResolution.loadPersistedSession(
        sessionId: options.sessionId,
        sessionStore: options.sessionStore,
        scope: options.scope,
        workingDirectory: options.workingDirectory
      )
      let persisted = loaded.record
      let storeRoot = CLIWorkflowSessionResolution.saveStoreRoot(
        sessionStore: options.sessionStore,
        scope: options.scope,
        workingDirectory: options.workingDirectory,
        loadedFromStoreRoot: loaded.storeRoot
      )
      let resolution = mergedResolution(persisted: persisted, options: options)
      let bundle = try resolver.resolve(resolution)
      let adapter = try makeAdapter(
        mockScenarioPath: options.mockScenarioPath ?? persisted.mockScenarioPath,
        workingDirectory: options.workingDirectory
      )
      let runtimeStore = InMemoryWorkflowRuntimeStore()
      await runtimeStore.seedSession(persisted.session)
      let runner = DeterministicWorkflowRunner(store: runtimeStore, adapter: adapter, stdioNodeExecutor: LocalWorkflowStdioNodeExecutor())
      let result = try await runner.run(
        DeterministicWorkflowRunRequest(
          workflow: bundle.workflow,
          nodePayloads: bundle.nodePayloads,
          rerunFromSessionId: persisted.session.sessionId,
          rerunFromStepId: options.stepId
        )
      )
      try CLIWorkflowSessionStore(rootDirectory: storeRoot).save(
        PersistedCLIWorkflowSession(
          workflowName: persisted.workflowName,
          session: result.session,
          resolution: resolution,
          mockScenarioPath: options.mockScenarioPath ?? persisted.mockScenarioPath
        )
      )
      return renderRerunSuccess(options: options, result: result)
    } catch let error as CLIWorkflowSessionStoreError {
      return failure(options: options, exitCode: .failure, error: "\(error)")
    } catch let error as DeterministicWorkflowRunnerError {
      return failure(options: options, exitCode: .failure, error: "\(error)")
    } catch {
      return failure(options: options, exitCode: .failure, error: "\(error)")
    }
  }

  private func renderRerunSuccess(options: SessionRerunOptions, result: WorkflowRunResult) -> CLICommandResult {
    let exitCode = CLIExitCode(rawValue: result.exitCode) ?? .failure
    switch options.output {
    case .json:
      let payload = SessionRerunCommandResult(
        sourceSessionId: options.sessionId,
        sessionId: result.session.sessionId,
        status: result.session.status,
        rerunFromStepId: options.stepId,
        exitCode: result.exitCode
      )
      let stdout = (try? jsonString(payload)) ?? ""
      return CLICommandResult(exitCode: exitCode, stdout: stdout + (stdout.hasSuffix("\n") ? "" : "\n"))
    case .text:
      return CLICommandResult(
        exitCode: exitCode,
        stdout: """
        sourceSessionId: \(options.sessionId)
        rerun session: \(result.session.sessionId)
        rerunFromStepId: \(options.stepId)
        status: \(result.session.status.rawValue)

        """
      )
    }
  }

  private func failure(options: SessionRerunOptions, exitCode: CLIExitCode, error: String) -> CLICommandResult {
    guard options.output == .json else {
      return CLICommandResult(exitCode: exitCode, stderr: error)
    }
    let payload = SessionCommandFailureResult(sessionId: options.sessionId, error: error, exitCode: exitCode.rawValue)
    let stdout = (try? jsonString(payload)) ?? ""
    return CLICommandResult(exitCode: exitCode, stdout: stdout + (stdout.hasSuffix("\n") ? "" : "\n"))
  }

  private func mergedResolution(persisted: PersistedCLIWorkflowSession, options: SessionRerunOptions) -> WorkflowResolutionOptions {
    CLIWorkflowSessionResolution.effectiveResolution(
      persisted: persisted,
      scope: options.scope,
      workflowDefinitionDir: options.workflowDefinitionDir,
      workingDirectory: options.workingDirectory
    )
  }

  private func makeAdapter(mockScenarioPath: String?, workingDirectory: String) throws -> any NodeAdapter {
    try makeSessionNodeAdapter(mockScenarioPath: mockScenarioPath, workingDirectory: workingDirectory)
  }
}

public struct SessionResumeCommand: Sendable {
  public var resolver: any WorkflowBundleResolving

  public init(resolver: any WorkflowBundleResolving = FileSystemWorkflowBundleResolver()) {
    self.resolver = resolver
  }

  public func run(_ options: SessionResumeOptions) async -> CLICommandResult {
    do {
      let loaded = try CLIWorkflowSessionResolution.loadPersistedSession(
        sessionId: options.sessionId,
        sessionStore: options.sessionStore,
        scope: options.scope,
        workingDirectory: options.workingDirectory
      )
      let persisted = loaded.record
      let storeRoot = CLIWorkflowSessionResolution.saveStoreRoot(
        sessionStore: options.sessionStore,
        scope: options.scope,
        workingDirectory: options.workingDirectory,
        loadedFromStoreRoot: loaded.storeRoot
      )
      let resolution = CLIWorkflowSessionResolution.effectiveResolution(
        persisted: persisted,
        scope: options.scope,
        workflowDefinitionDir: options.workflowDefinitionDir,
        workingDirectory: options.workingDirectory
      )
      let bundle = try resolver.resolve(resolution)
      let adapter = try makeSessionNodeAdapter(
        mockScenarioPath: options.mockScenarioPath ?? persisted.mockScenarioPath,
        workingDirectory: options.workingDirectory
      )
      let runtimeStore = InMemoryWorkflowRuntimeStore()
      await runtimeStore.seedSession(persisted.session)
      let runner = DeterministicWorkflowRunner(store: runtimeStore, adapter: adapter, stdioNodeExecutor: LocalWorkflowStdioNodeExecutor())
      let result = try await runner.run(
        DeterministicWorkflowRunRequest(
          workflow: bundle.workflow,
          nodePayloads: bundle.nodePayloads,
          resumeSessionId: persisted.session.sessionId
        )
      )
      try CLIWorkflowSessionStore(rootDirectory: storeRoot).save(
        PersistedCLIWorkflowSession(
          workflowName: persisted.workflowName,
          session: result.session,
          resolution: resolution,
          mockScenarioPath: options.mockScenarioPath ?? persisted.mockScenarioPath
        )
      )
      return renderResumeSuccess(options: options, result: result)
    } catch let error as CLIWorkflowSessionStoreError {
      return resumeFailure(options: options, exitCode: .failure, error: "\(error)")
    } catch let error as DeterministicWorkflowRunnerError {
      return resumeFailure(options: options, exitCode: .failure, error: "\(error)")
    } catch {
      return resumeFailure(options: options, exitCode: .failure, error: "\(error)")
    }
  }

  private func renderResumeSuccess(options: SessionResumeOptions, result: WorkflowRunResult) -> CLICommandResult {
    let exitCode = CLIExitCode(rawValue: result.exitCode) ?? .failure
    switch options.output {
    case .json:
      let payload = SessionResumeCommandResult(
        sessionId: result.session.sessionId,
        status: result.session.status,
        exitCode: result.exitCode
      )
      let stdout = (try? jsonString(payload)) ?? ""
      return CLICommandResult(exitCode: exitCode, stdout: stdout + (stdout.hasSuffix("\n") ? "" : "\n"))
    case .text:
      return CLICommandResult(
        exitCode: exitCode,
        stdout: """
        session resumed: \(result.session.sessionId)
        status: \(result.session.status.rawValue)

        """
      )
    }
  }

  private func resumeFailure(options: SessionResumeOptions, exitCode: CLIExitCode, error: String) -> CLICommandResult {
    guard options.output == .json else {
      return CLICommandResult(exitCode: exitCode, stderr: error)
    }
    let payload = SessionCommandFailureResult(sessionId: options.sessionId, error: error, exitCode: exitCode.rawValue)
    let stdout = (try? jsonString(payload)) ?? ""
    return CLICommandResult(exitCode: exitCode, stdout: stdout + (stdout.hasSuffix("\n") ? "" : "\n"))
  }
}

private func makeSessionNodeAdapter(mockScenarioPath: String?, workingDirectory: String) throws -> any NodeAdapter {
  let fallback = DeterministicLocalNodeAdapter()
  guard let mockScenarioPath else {
    return fallback
  }
  return try ScenarioNodeAdapter(
    scenario: WorkflowMockScenarioLoader().loadScenario(at: absoluteURL(
      mockScenarioPath,
      relativeTo: URL(fileURLWithPath: workingDirectory)
    ).path),
    fallback: fallback
  )
}
