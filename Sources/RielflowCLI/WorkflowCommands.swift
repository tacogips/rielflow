import Foundation
import RielflowAdapters
import RielflowAddons
import RielflowCore

public struct CLICommandResult: Equatable, Sendable {
  public var exitCode: CLIExitCode
  public var stdout: String
  public var stderr: String

  public init(exitCode: CLIExitCode, stdout: String = "", stderr: String = "") {
    self.exitCode = exitCode
    self.stdout = stdout
    self.stderr = stderr
  }
}

public struct NodeValidationResult: Codable, Equatable, Sendable {
  public var nodeId: String
  public var backend: String?
  public var valid: Bool
  public var message: String

  public init(nodeId: String, backend: String?, valid: Bool, message: String) {
    self.nodeId = nodeId
    self.backend = backend
    self.valid = valid
    self.message = message
  }
}

public protocol WorkflowExecutablePreflighting: Sendable {
  func preflight(
    _ workflow: WorkflowDefinition,
    nodePayloads: [String: AgentNodePayload],
    packageManifest: WorkflowPackageManifest?,
    sourceScope: WorkflowScope
  ) async throws -> [NodeValidationResult]
}

public struct DeterministicWorkflowExecutablePreflight: WorkflowExecutablePreflighting {
  public init() {}

  public func preflight(
    _ workflow: WorkflowDefinition,
    nodePayloads: [String: AgentNodePayload],
    packageManifest: WorkflowPackageManifest?,
    sourceScope: WorkflowScope
  ) async throws -> [NodeValidationResult] {
    let nativeInspections = nativeBundleAddonInspections(
      workflow: workflow,
      packageManifest: packageManifest,
      sourceScope: sourceScope
    )
    return workflow.nodeRegistry.map { node in
      let payload = nodePayloads[node.id]
      let backend = payload?.executionBackend?.rawValue
      let nativeInspection = nativeInspections.first { $0.nodeId == node.id }
      let valid = payload != nil
      let message: String
      if valid {
        message = "deterministic Swift preflight passed"
      } else if let nativeInspection {
        message = "native-bundle executable preflight helper unavailable for \(nativeInspection.addon); signing=\(nativeInspection.signingRequired ? "required" : "not_required") cache=\(nativeInspection.cacheStatus)"
      } else if node.addon != nil {
        message = "addon-only nodes require an add-on resolver for Swift deterministic execution"
      } else {
        message = "node payload is not loadable"
      }
      return NodeValidationResult(
        nodeId: node.id,
        backend: backend,
        valid: valid,
        message: message
      )
    }
  }
}

public struct WorkflowValidationCommandResult: Codable, Equatable, Sendable {
  public var valid: Bool
  public var workflowId: String
  public var sourceScope: WorkflowScope
  public var workflowDirectory: String
  public var diagnostics: [WorkflowValidationDiagnostic]
  public var nodeValidationResults: [NodeValidationResult]

  public init(
    valid: Bool,
    workflowId: String,
    sourceScope: WorkflowScope,
    workflowDirectory: String,
    diagnostics: [WorkflowValidationDiagnostic],
    nodeValidationResults: [NodeValidationResult]
  ) {
    self.valid = valid
    self.workflowId = workflowId
    self.sourceScope = sourceScope
    self.workflowDirectory = workflowDirectory
    self.diagnostics = diagnostics
    self.nodeValidationResults = nodeValidationResults
  }
}

public struct WorkflowValidationFailureResult: Codable, Equatable, Sendable {
  public var valid: Bool
  public var workflowId: String
  public var sourceScope: WorkflowScope?
  public var workflowDirectory: String?
  public var diagnostics: [WorkflowValidationDiagnostic]
  public var nodeValidationResults: [NodeValidationResult]
  public var error: String
  public var exitCode: Int32

  public init(
    workflowId: String,
    sourceScope: WorkflowScope? = nil,
    workflowDirectory: String? = nil,
    diagnostics: [WorkflowValidationDiagnostic] = [],
    nodeValidationResults: [NodeValidationResult] = [],
    error: String,
    exitCode: Int32
  ) {
    self.valid = false
    self.workflowId = workflowId
    self.sourceScope = sourceScope
    self.workflowDirectory = workflowDirectory
    self.diagnostics = diagnostics
    self.nodeValidationResults = nodeValidationResults
    self.error = error
    self.exitCode = exitCode
  }
}

public struct WorkflowRunFailureResult: Codable, Equatable, Sendable {
  public var workflowId: String?
  public var target: String
  public var status: WorkflowSessionStatus
  public var exitCode: Int32
  public var error: String

  public init(
    workflowId: String? = nil,
    target: String,
    status: WorkflowSessionStatus = .failed,
    exitCode: Int32,
    error: String
  ) {
    self.workflowId = workflowId
    self.target = target
    self.status = status
    self.exitCode = exitCode
    self.error = error
  }
}

public struct WorkflowValidateCommand: Sendable {
  public var resolver: any WorkflowBundleResolving
  public var patchApplier: any WorkflowNodePatchApplying
  public var jsonLoader: JSONReferenceLoader
  public var preflight: any WorkflowExecutablePreflighting

  public init(
    resolver: any WorkflowBundleResolving = FileSystemWorkflowBundleResolver(),
    patchApplier: any WorkflowNodePatchApplying = DefaultWorkflowNodePatchApplier(),
    jsonLoader: JSONReferenceLoader = JSONReferenceLoader(),
    preflight: any WorkflowExecutablePreflighting = DeterministicWorkflowExecutablePreflight()
  ) {
    self.resolver = resolver
    self.patchApplier = patchApplier
    self.jsonLoader = jsonLoader
    self.preflight = preflight
  }

  public func run(_ options: WorkflowValidateOptions) async -> CLICommandResult {
    do {
      var bundle = try resolver.resolve(options.resolution)
      if let patch = options.nodePatch {
        bundle.nodePayloads = try patchApplier.applyNodePatch(
          jsonLoader.object(from: patch, workingDirectory: options.resolution.workingDirectory),
          to: bundle.nodePayloads
        )
      }
      let diagnostics = bundle.diagnostics + DefaultWorkflowValidator().validate(bundle.workflow)
      let nodeResults = options.executable
        ? try await preflight.preflight(
          bundle.workflow,
          nodePayloads: bundle.nodePayloads,
          packageManifest: bundle.packageManifest,
          sourceScope: bundle.sourceScope
        )
        : []
      let valid = !diagnostics.contains { $0.severity == .error } && !nodeResults.contains { !$0.valid }
      let result = WorkflowValidationCommandResult(
        valid: valid,
        workflowId: bundle.workflow.workflowId,
        sourceScope: bundle.sourceScope,
        workflowDirectory: bundle.workflowDirectory,
        diagnostics: diagnostics,
        nodeValidationResults: nodeResults
      )
      return CLICommandResult(
        exitCode: valid ? .success : .failure,
        stdout: try render(result, output: options.output)
      )
    } catch let error as WorkflowResolutionError {
      let diagnostics: [WorkflowValidationDiagnostic]
      if case let .invalidWorkflow(workflowDiagnostics) = error {
        diagnostics = workflowDiagnostics
      } else {
        diagnostics = []
      }
      return renderFailure(
        options: options,
        exitCode: .failure,
        error: "\(error)",
        diagnostics: diagnostics
      )
    } catch let error as CLIUsageError {
      return renderFailure(options: options, exitCode: .usage, error: error.message)
    } catch {
      return renderFailure(options: options, exitCode: .failure, error: "\(error)")
    }
  }

  private func render(_ result: WorkflowValidationCommandResult, output: WorkflowOutputFormat) throws -> String {
    switch output {
    case .json:
      return try jsonString(result)
    case .text:
      var lines = [
        result.valid ? "valid: \(result.workflowId)" : "invalid: \(result.workflowId)",
        "source: \(result.sourceScope.rawValue) \(result.workflowDirectory)",
      ]
      lines.append(contentsOf: result.diagnostics.map { "\($0.severity.rawValue): \($0.path): \($0.message)" })
      lines.append(contentsOf: result.nodeValidationResults.map { "\($0.valid ? "ok" : "error"): \($0.nodeId): \($0.message)" })
      return lines.joined(separator: "\n") + "\n"
    }
  }

  private func renderFailure(
    options: WorkflowValidateOptions,
    exitCode: CLIExitCode,
    error: String,
    diagnostics: [WorkflowValidationDiagnostic] = []
  ) -> CLICommandResult {
    guard options.output == .json else {
      return CLICommandResult(exitCode: exitCode, stderr: error)
    }
    let result = WorkflowValidationFailureResult(
      workflowId: options.workflowName,
      sourceScope: options.resolution.scope == .direct ? nil : options.resolution.scope,
      workflowDirectory: options.resolution.workflowDefinitionDir,
      diagnostics: diagnostics,
      error: error,
      exitCode: exitCode.rawValue
    )
    let stdout = (try? jsonString(result)) ?? #"{"diagnostics":[],"error":"failed to encode validate failure","exitCode":1,"nodeValidationResults":[],"valid":false,"workflowId":"workflow validate"}"# + "\n"
    return CLICommandResult(exitCode: exitCode, stdout: stdout)
  }
}

public struct WorkflowInspectionCounts: Codable, Equatable, Sendable {
  public var steps: Int
  public var nodes: Int
  public var crossWorkflowDispatches: Int
}

public struct WorkflowCallableInspection: Codable, Equatable, Sendable {
  public var stepId: String
  public var role: NodeRole
  public var input: NodeInputContract?
  public var output: NodeOutputContract?
}

public struct WorkflowInspectionSummary: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sourceScope: WorkflowScope
  public var workflowDirectory: String
  public var description: String
  public var entryStepId: String
  public var managerStepId: String?
  public var stepIds: [String]
  public var nodeRegistryIds: [String]
  public var crossWorkflowDispatchIds: [String]
  public var counts: WorkflowInspectionCounts
  public var defaults: WorkflowDefaults
  public var callable: WorkflowCallableInspection
  public var addonSourceSummaries: [String]
  public var nativeBundleAddons: [NativeBundleAddonInspection]
  public var runtimeReadinessDescriptors: [String]
}

public struct NativeBundleAddonInspection: Codable, Equatable, Sendable {
  public var nodeId: String
  public var addon: String
  public var sourceKind: String
  public var sourceScope: String
  public var packageName: String?
  public var bundleIdentifier: String
  public var abiVersion: Int
  public var contentDigest: String
  public var dependencyClosureDigest: String
  public var signingRequired: Bool
  public var signingVerified: Bool?
  public var cacheStatus: String
  public var preflightHelperStatus: String?
}

private func nativeBundleAddonInspections(
  workflow: WorkflowDefinition,
  packageManifest: WorkflowPackageManifest?,
  sourceScope: WorkflowScope
) -> [NativeBundleAddonInspection] {
  guard let packageManifest else {
    return []
  }
  let nativeLocks = packageManifest.dependencies.flatMap { dependency in
    dependency.addons.compactMap { lock -> (WorkflowPackageDependency, WorkflowPackageManifestAddonDependencyLock)? in
      lock.executionKind == .nativeBundle ? (dependency, lock) : nil
    }
  }
  guard !nativeLocks.isEmpty else {
    return []
  }

  return workflow.nodeRegistry.compactMap { node in
    guard let addon = node.addon else {
      return nil
    }
    guard let match = nativeLocks.first(where: { dependency, lock in
      let versionMatches = addon.version == nil || lock.version == addon.version
      let nameMatches = lock.name == addon.name || "\(dependency.packageId)/\(lock.name)" == addon.name
      return nameMatches && versionMatches
    }) else {
      return nil
    }
    let dependency = match.0
    let lock = match.1
    return NativeBundleAddonInspection(
      nodeId: node.id,
      addon: addon.name,
      sourceKind: WorkflowPackageAddonExecutionKind.nativeBundle.rawValue,
      sourceScope: lock.sourceScope ?? sourceScope.rawValue,
      packageName: dependency.packageId,
      bundleIdentifier: lock.bundleIdentifier ?? "",
      abiVersion: lock.abiVersion ?? 0,
      contentDigest: lock.contentDigest ?? "",
      dependencyClosureDigest: lock.dependencyClosureDigest ?? "",
      signingRequired: lock.codeSignatureRequirementDigest != nil,
      signingVerified: nil,
      cacheStatus: "not_loaded",
      preflightHelperStatus: nil
    )
  }
}

public struct WorkflowInspectionFailureResult: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sourceScope: WorkflowScope?
  public var workflowDirectory: String?
  public var diagnostics: [WorkflowValidationDiagnostic]
  public var error: String
  public var exitCode: Int32

  public init(
    workflowId: String,
    sourceScope: WorkflowScope? = nil,
    workflowDirectory: String? = nil,
    diagnostics: [WorkflowValidationDiagnostic] = [],
    error: String,
    exitCode: Int32
  ) {
    self.workflowId = workflowId
    self.sourceScope = sourceScope
    self.workflowDirectory = workflowDirectory
    self.diagnostics = diagnostics
    self.error = error
    self.exitCode = exitCode
  }
}

public struct WorkflowInspectCommand: Sendable {
  public var resolver: any WorkflowBundleResolving

  public init(resolver: any WorkflowBundleResolving = FileSystemWorkflowBundleResolver()) {
    self.resolver = resolver
  }

  public func run(_ options: WorkflowInspectOptions) -> CLICommandResult {
    do {
      let bundle = try resolver.resolve(options.resolution)
      let summary = buildSummary(bundle)
      if options.output == .json {
        return CLICommandResult(exitCode: .success, stdout: try jsonString(summary))
      }
      if options.structure {
        return CLICommandResult(exitCode: .success, stdout: renderStructure(bundle.workflow))
      }
      return CLICommandResult(exitCode: .success, stdout: renderText(summary))
    } catch let error as WorkflowResolutionError {
      let diagnostics: [WorkflowValidationDiagnostic]
      if case let .invalidWorkflow(workflowDiagnostics) = error {
        diagnostics = workflowDiagnostics
      } else {
        diagnostics = []
      }
      return renderFailure(options: options, exitCode: .failure, error: "\(error)", diagnostics: diagnostics)
    } catch {
      return renderFailure(options: options, exitCode: .failure, error: "\(error)")
    }
  }

  private func buildSummary(_ bundle: ResolvedWorkflowBundle) -> WorkflowInspectionSummary {
    let workflow = bundle.workflow
    let crossWorkflowIds = workflow.steps.flatMap { step in
      (step.transitions ?? []).compactMap { transition in
        transition.toWorkflowId.map { "\(step.id)->\($0):\(transition.toStepId)" }
      }
    }
    let addonSummaries = workflow.nodeRegistry.compactMap { node in
      node.addon.map { "\(node.id):\($0.name)" }
    }
    let nativeBundleAddons = nativeBundleAddonInspections(
      workflow: workflow,
      packageManifest: bundle.packageManifest,
      sourceScope: bundle.sourceScope
    )
    let readiness = workflow.nodeRegistry.map { node -> String in
      guard let payload = bundle.nodePayloads[node.id] else {
        return "\(node.id):not_checked"
      }
      return "\(node.id):\(payload.executionBackend?.rawValue ?? "deterministic-local")"
    }
    let callable = buildCallableInspection(workflow, nodePayloads: bundle.nodePayloads)
    return WorkflowInspectionSummary(
      workflowId: workflow.workflowId,
      sourceScope: bundle.sourceScope,
      workflowDirectory: bundle.workflowDirectory,
      description: workflow.description,
      entryStepId: workflow.entryStepId,
      managerStepId: workflow.managerStepId,
      stepIds: workflow.steps.map(\.id),
      nodeRegistryIds: workflow.nodeRegistry.map(\.id),
      crossWorkflowDispatchIds: crossWorkflowIds,
      counts: WorkflowInspectionCounts(
        steps: workflow.steps.count,
        nodes: workflow.nodeRegistry.count,
        crossWorkflowDispatches: crossWorkflowIds.count
      ),
      defaults: workflow.defaults,
      callable: callable,
      addonSourceSummaries: addonSummaries,
      nativeBundleAddons: nativeBundleAddons,
      runtimeReadinessDescriptors: readiness
    )
  }

  private func buildCallableInspection(
    _ workflow: WorkflowDefinition,
    nodePayloads: [String: AgentNodePayload]
  ) -> WorkflowCallableInspection {
    let stepId = workflow.managerStepId ?? workflow.entryStepId
    let step = workflow.steps.first { $0.id == stepId }
    let role = step?.role ?? (workflow.managerStepId == stepId ? .manager : .worker)
    let payload = nodePayload(for: step, stepId: stepId, nodePayloads: nodePayloads)
    return WorkflowCallableInspection(
      stepId: stepId,
      role: role,
      input: payload?.input,
      output: payload?.output
    )
  }

  private func nodePayload(
    for step: WorkflowStepRef?,
    stepId: String,
    nodePayloads: [String: AgentNodePayload]
  ) -> AgentNodePayload? {
    if let payload = nodePayloads[stepId] {
      return payload
    }
    if let nodeId = step?.nodeId, let payload = nodePayloads[nodeId] {
      return payload
    }
    return nil
  }

  private func renderStructure(_ workflow: WorkflowDefinition) -> String {
    workflow.steps.map { step in
      "\(step.id)\n  \(step.description ?? "-")"
    }.joined(separator: "\n") + "\n"
  }

  private func renderText(_ summary: WorkflowInspectionSummary) -> String {
    var lines = [
      "workflow: \(summary.workflowId)",
      "source: \(summary.sourceScope.rawValue) \(summary.workflowDirectory)",
      "entryStepId: \(summary.entryStepId)",
      "steps: \(summary.stepIds.joined(separator: ", "))",
      "nodes: \(summary.nodeRegistryIds.joined(separator: ", "))",
      "counts: steps=\(summary.counts.steps) nodes=\(summary.counts.nodes) crossWorkflowDispatches=\(summary.counts.crossWorkflowDispatches)",
    ]
    if let manager = summary.managerStepId {
      lines.append("managerStepId: \(manager)")
    }
    lines.append("callableStepId: \(summary.callable.stepId)")
    lines.append("callableRole: \(summary.callable.role.rawValue)")
    if let input = summary.callable.input {
      lines.append("callableInput: \(contractDescription(input.description))")
    }
    if let output = summary.callable.output {
      lines.append("callableOutput: \(contractDescription(output.description))")
    }
    if summary.callable.input != nil {
      lines.append("variables: --variables '{...}'")
    }
    if !summary.addonSourceSummaries.isEmpty {
      lines.append("addons: \(summary.addonSourceSummaries.joined(separator: ", "))")
    }
    if !summary.nativeBundleAddons.isEmpty {
      lines.append(contentsOf: summary.nativeBundleAddons.map {
        "nativeBundle: \($0.nodeId): \($0.addon) \($0.bundleIdentifier) abi=\($0.abiVersion) cache=\($0.cacheStatus)"
      })
    }
    return lines.joined(separator: "\n") + "\n"
  }

  private func contractDescription(_ description: String?) -> String {
    guard let description, !description.isEmpty else {
      return "(not declared)"
    }
    return description
  }

  private func renderFailure(
    options: WorkflowInspectOptions,
    exitCode: CLIExitCode,
    error: String,
    diagnostics: [WorkflowValidationDiagnostic] = []
  ) -> CLICommandResult {
    guard options.output == .json else {
      return CLICommandResult(exitCode: exitCode, stderr: error)
    }
    let result = WorkflowInspectionFailureResult(
      workflowId: options.workflowName,
      sourceScope: options.resolution.scope,
      workflowDirectory: options.resolution.workflowDefinitionDir,
      diagnostics: diagnostics,
      error: error,
      exitCode: exitCode.rawValue
    )
    let stdout = (try? jsonString(result)) ?? #"{"diagnostics":[],"error":"failed to encode inspect failure","exitCode":1,"workflowId":"workflow inspect"}"# + "\n"
    return CLICommandResult(exitCode: exitCode, stdout: stdout)
  }
}

public struct WorkflowRunCommand: Sendable {
  public var resolver: any WorkflowBundleResolving
  public var patchApplier: any WorkflowNodePatchApplying
  public var jsonLoader: JSONReferenceLoader

  public init(
    resolver: any WorkflowBundleResolving = FileSystemWorkflowBundleResolver(),
    patchApplier: any WorkflowNodePatchApplying = DefaultWorkflowNodePatchApplier(),
    jsonLoader: JSONReferenceLoader = JSONReferenceLoader()
  ) {
    self.resolver = resolver
    self.patchApplier = patchApplier
    self.jsonLoader = jsonLoader
  }

  public func run(_ options: WorkflowRunOptions) async -> CLICommandResult {
    do {
      try rejectUnsupportedRunOptions(options)
      let resolution = options.resolution ?? WorkflowResolutionOptions(
        workflowName: options.target,
        workingDirectory: options.workingDirectory
      )
      var bundle = try resolveRunBundle(options: options, resolution: resolution)
      if let patch = options.nodePatch {
        bundle.nodePayloads = try patchApplier.applyNodePatch(
          jsonLoader.object(from: patch, workingDirectory: options.workingDirectory),
          to: bundle.nodePayloads
        )
      }
      let variables = try parseVariables(options.variables, workingDirectory: options.workingDirectory)
      let fallback = DeterministicLocalNodeAdapter()
      let adapter: any NodeAdapter
      if let scenarioPath = options.mockScenarioPath {
        adapter = try ScenarioNodeAdapter(
          scenario: WorkflowMockScenarioLoader().loadScenario(at: absoluteURL(
            scenarioPath,
            relativeTo: URL(fileURLWithPath: options.workingDirectory)
          ).path),
          fallback: fallback
        )
      } else {
        adapter = fallback
      }
      let runner = DeterministicWorkflowRunner(
        adapter: adapter,
        stdioNodeExecutor: LocalWorkflowStdioNodeExecutor()
      )
      let result = try await runner.run(
        DeterministicWorkflowRunRequest(
          workflow: bundle.workflow,
          nodePayloads: bundle.nodePayloads,
          variables: variables,
          maxSteps: options.maxSteps,
          maxConcurrency: options.maxConcurrency,
          maxLoopIterations: options.maxLoopIterations,
          defaultTimeoutMs: options.defaultTimeoutMs,
          timeoutMs: options.timeoutMs
        )
      )
      return CLICommandResult(
        exitCode: CLIExitCode(rawValue: result.exitCode) ?? .failure,
        stdout: try renderRunResult(result, output: options.output)
      )
    } catch let error as CLIUsageError {
      return renderRunFailure(options: options, exitCode: .usage, error: error.message)
    } catch {
      return renderRunFailure(options: options, exitCode: .failure, error: "\(error)")
    }
  }

  private func parseVariables(_ reference: String?, workingDirectory: String) throws -> JSONObject {
    guard let reference else {
      return [:]
    }
    return try jsonLoader.object(from: reference, workingDirectory: workingDirectory)
  }

  private func rejectUnsupportedRunOptions(_ options: WorkflowRunOptions) throws {
    if options.artifactRoot != nil {
      throw CLIUsageError("--artifact-root is not supported by the Swift TASK-007 in-memory runner")
    }
    if options.sessionStore != nil {
      throw CLIUsageError("--session-store is not supported by the Swift TASK-007 in-memory runner")
    }
    if options.maxConcurrency != nil {
      throw CLIUsageError("--max-concurrency is not supported by the Swift TASK-007 sequential runner")
    }
  }

  private func resolveRunBundle(options: WorkflowRunOptions, resolution: WorkflowResolutionOptions) throws -> ResolvedWorkflowBundle {
    if let temporary = try loadTemporaryWorkflowIfPresent(options.target, workingDirectory: options.workingDirectory) {
      return temporary
    }
    return try resolver.resolve(resolution)
  }

  private func loadTemporaryWorkflowIfPresent(_ target: String, workingDirectory: String) throws -> ResolvedWorkflowBundle? {
    let trimmed = target.trimmingCharacters(in: .whitespacesAndNewlines)
    let data: Data
    let directory: URL
    if trimmed.hasPrefix("{") {
      guard let inlineData = trimmed.data(using: .utf8) else {
        throw CLIUsageError("temporary workflow JSON target must be UTF-8")
      }
      data = inlineData
      directory = URL(fileURLWithPath: workingDirectory)
    } else {
      let url = absoluteURL(target, relativeTo: URL(fileURLWithPath: workingDirectory))
      guard FileManager.default.fileExists(atPath: url.path), url.pathExtension == "json" else {
        return nil
      }
      data = try Data(contentsOf: url)
      directory = url.deletingLastPathComponent()
    }

    if let payload = try? JSONDecoder().decode(TemporaryWorkflowPayload.self, from: data) {
      let authoredData = try JSONEncoder().encode(payload.workflow)
      let validation = validateAuthoredWorkflowData(authoredData)
      guard let workflow = validation.workflow else {
        throw WorkflowResolutionError.invalidWorkflow(validation.diagnostics)
      }
      return ResolvedWorkflowBundle(
        workflow: workflow,
        nodePayloads: nodePayloads(from: payload, workflow: workflow),
        sourceScope: .direct,
        workflowDirectory: directory.path,
        diagnostics: validation.diagnostics
      )
    }

    let validation = validateAuthoredWorkflowData(data)
    guard let workflow = validation.workflow else {
      throw WorkflowResolutionError.invalidWorkflow(validation.diagnostics)
    }
    return ResolvedWorkflowBundle(
      workflow: workflow,
      nodePayloads: [:],
      sourceScope: .direct,
      workflowDirectory: directory.path,
      diagnostics: validation.diagnostics
    )
  }

  private func nodePayloads(from payload: TemporaryWorkflowPayload, workflow: WorkflowDefinition) -> [String: AgentNodePayload] {
    var byNodeId: [String: AgentNodePayload] = [:]
    for registryNode in workflow.nodeRegistry {
      if let nodeFile = registryNode.nodeFile, let nodePayload = payload.nodePayloads[nodeFile] {
        byNodeId[registryNode.id] = nodePayload
      } else if let nodePayload = payload.nodePayloads[registryNode.id] {
        byNodeId[registryNode.id] = nodePayload
      }
    }
    return byNodeId
  }

  private func renderRunResult(_ result: WorkflowRunResult, output: WorkflowOutputFormat) throws -> String {
    switch output {
    case .json:
      return try jsonString(result)
    case .text:
      return "status: \(result.session.status.rawValue)\nworkflowId: \(result.workflowId)\nnodeExecutions: \(result.session.executions.count)\n"
    }
  }

  private func renderRunFailure(options: WorkflowRunOptions, exitCode: CLIExitCode, error: String) -> CLICommandResult {
    guard options.output == .json else {
      return CLICommandResult(exitCode: exitCode, stderr: error)
    }
    let result = WorkflowRunFailureResult(target: options.target, exitCode: exitCode.rawValue, error: error)
    let stdout = (try? jsonString(result)) ?? #"{"error":"failed to encode run failure","exitCode":1,"status":"failed","target":"workflow run"}"# + "\n"
    return CLICommandResult(exitCode: exitCode, stdout: stdout)
  }
}

private struct TemporaryWorkflowPayload: Codable {
  var workflow: AuthoredWorkflowJSON
  var nodePayloads: [String: AgentNodePayload]
}

public struct RielflowCLIApplication: Sendable {
  public var parser: any CLIArgumentParsing
  public var validateCommand: WorkflowValidateCommand
  public var inspectCommand: WorkflowInspectCommand
  public var runCommand: WorkflowRunCommand

  public init(
    parser: any CLIArgumentParsing = RielflowArgumentParser(),
    validateCommand: WorkflowValidateCommand = WorkflowValidateCommand(),
    inspectCommand: WorkflowInspectCommand = WorkflowInspectCommand(),
    runCommand: WorkflowRunCommand = WorkflowRunCommand()
  ) {
    self.parser = parser
    self.validateCommand = validateCommand
    self.inspectCommand = inspectCommand
    self.runCommand = runCommand
  }

  public func run(_ arguments: [String]) async -> CLICommandResult {
    do {
      switch try parser.parse(arguments) {
      case .help:
        return CLICommandResult(exitCode: .success, stdout: rielflowCLIHelpText)
      case .version:
        return CLICommandResult(exitCode: .success, stdout: "\(rielflowSwiftMigrationVersion)\n")
      case let .workflow(.validate(options)):
        return await validateCommand.run(options)
      case let .workflow(.inspect(options)):
        return inspectCommand.run(options)
      case let .workflow(.usage(options)):
        return inspectCommand.run(options)
      case let .workflow(.run(options)):
        return await runCommand.run(options)
      }
    } catch let error as CLIUsageError {
      return renderParserFailure(arguments: arguments, error: error)
    } catch {
      return CLICommandResult(exitCode: .failure, stderr: "\(error)")
    }
  }

  private func renderParserFailure(arguments: [String], error: CLIUsageError) -> CLICommandResult {
    guard arguments.first == "workflow", requestsJSONOutput(arguments) else {
      return CLICommandResult(exitCode: .usage, stderr: error.message)
    }
    let subcommand = arguments.count > 1 ? arguments[1] : "workflow"
    let target = parserFailureTarget(arguments: arguments, subcommand: subcommand)
    let exitCode = CLIExitCode.usage.rawValue
    let stdout: String?
    switch subcommand {
    case "validate":
      stdout = try? jsonString(WorkflowValidationFailureResult(
        workflowId: target,
        error: error.message,
        exitCode: exitCode
      ))
    case "inspect":
      stdout = try? jsonString(WorkflowInspectionFailureResult(
        workflowId: target,
        error: error.message,
        exitCode: exitCode
      ))
    case "run":
      stdout = try? jsonString(WorkflowRunFailureResult(
        target: target,
        exitCode: exitCode,
        error: error.message
      ))
    default:
      stdout = try? jsonString(WorkflowRunFailureResult(
        target: target,
        exitCode: exitCode,
        error: error.message
      ))
    }
    return CLICommandResult(
      exitCode: .usage,
      stdout: stdout ?? #"{"error":"failed to encode parser failure","exitCode":2}"# + "\n"
    )
  }

  private func requestsJSONOutput(_ arguments: [String]) -> Bool {
    for index in arguments.indices {
      if arguments[index] == "--output", index + 1 < arguments.count, arguments[index + 1] == "json" {
        return true
      }
      if arguments[index] == "--output=json" {
        return true
      }
    }
    return false
  }

  private func parserFailureTarget(arguments: [String], subcommand: String) -> String {
    guard arguments.count > 2, !arguments[2].hasPrefix("--") else {
      return "workflow \(subcommand)"
    }
    return arguments[2]
  }
}

public let rielflowCLIHelpText = """
Rielflow CLI

Usage:
  rielflow --version
  rielflow workflow validate <workflow> [--scope project|user|auto] [--output json]
  rielflow workflow inspect <workflow> [--scope project|user|auto] [--output json]
  rielflow workflow usage <workflow> [--scope project|user|auto] [--output json]
  rielflow workflow run <workflow> --mock-scenario <path> [--output json]

The Swift CLI is the production Homebrew runtime. Linux Homebrew archives remain unsupported until a reviewed Swift Linux build contract exists.

"""

func jsonString<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  encoder.dateEncodingStrategy = .iso8601
  return String(decoding: try encoder.encode(value), as: UTF8.self) + "\n"
}
