import Foundation

public struct WorkflowPublicationRequest: Sendable {
  public var sessionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: NodeExecutionBackend?
  public var adapterFailure: AdapterExecutionError?
  public var adapterOutput: AdapterExecutionOutput?
  public var inlineCandidate: JSONObject?
  public var candidatePath: URL?
  public var candidatePathReservation: RuntimeCandidatePathReservation?
  public var outputContract: WorkflowOutputContract?
  public var transitions: [WorkflowStepTransition]
  public var publishesRootOutput: Bool

  public init(
    sessionId: String,
    stepId: String,
    nodeId: String,
    attempt: Int,
    backend: NodeExecutionBackend? = nil,
    adapterFailure: AdapterExecutionError? = nil,
    adapterOutput: AdapterExecutionOutput? = nil,
    inlineCandidate: JSONObject? = nil,
    candidatePath: URL? = nil,
    candidatePathReservation: RuntimeCandidatePathReservation? = nil,
    outputContract: WorkflowOutputContract? = nil,
    transitions: [WorkflowStepTransition] = [],
    publishesRootOutput: Bool = false
  ) {
    self.sessionId = sessionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.attempt = attempt
    self.backend = backend
    self.adapterFailure = adapterFailure
    self.adapterOutput = adapterOutput
    self.inlineCandidate = inlineCandidate
    self.candidatePath = candidatePath
    self.candidatePathReservation = candidatePathReservation
    self.outputContract = outputContract
    self.transitions = transitions
    self.publishesRootOutput = publishesRootOutput
  }
}

public struct WorkflowPublicationResult: Equatable, Sendable {
  public var session: WorkflowSession
  public var stepExecution: WorkflowStepExecution
  public var publishedMessages: [WorkflowMessageRecord]
  public var rootOutput: JSONObject?

  public init(
    session: WorkflowSession,
    stepExecution: WorkflowStepExecution,
    publishedMessages: [WorkflowMessageRecord],
    rootOutput: JSONObject? = nil
  ) {
    self.session = session
    self.stepExecution = stepExecution
    self.publishedMessages = publishedMessages
    self.rootOutput = rootOutput
  }
}

public enum WorkflowPublicationError: Error, Equatable, Sendable {
  case noCandidateOutput
  case candidatePathRequiresReservation
  case candidatePathReservationRequiresCandidatePath
  case ambiguousCandidateSources([String])
  case unsupportedTransition(String)
  case validationRejected(String)
}

public protocol WorkflowOutputPublishing: Sendable {
  func publishAcceptedOutput(_ request: WorkflowPublicationRequest) async throws -> WorkflowPublicationResult
}

public typealias RuntimeCandidatePathFinalizer = @Sendable (RuntimeCandidatePathReservation) async throws -> Void

public struct InMemoryWorkflowOutputPublisher: WorkflowOutputPublishing {
  public var store: any WorkflowRuntimeStore
  public var validator: any WorkflowOutputValidating
  public var candidatePathReader: any CandidatePathReading
  public var candidatePathFinalizer: RuntimeCandidatePathFinalizer?
  public var clock: any WorkflowRuntimeClock

  public init(
    store: any WorkflowRuntimeStore,
    validator: any WorkflowOutputValidating = DefaultWorkflowOutputValidator(),
    candidatePathReader: any CandidatePathReading = DefaultCandidatePathReader(),
    candidatePathFinalizer: RuntimeCandidatePathFinalizer? = nil,
    clock: any WorkflowRuntimeClock = SystemWorkflowRuntimeClock()
  ) {
    self.store = store
    self.validator = validator
    self.candidatePathReader = candidatePathReader
    self.candidatePathFinalizer = candidatePathFinalizer
    self.clock = clock
  }

  public func publishAcceptedOutput(_ request: WorkflowPublicationRequest) async throws -> WorkflowPublicationResult {
    let recordedExecution = try await store.recordStepExecution(
      WorkflowStepExecutionRecordInput(
        sessionId: request.sessionId,
        stepId: request.stepId,
        nodeId: request.nodeId,
        attempt: request.attempt,
        backend: request.backend
      )
    )
    let adapterOutputMetadata = request.adapterOutput.map {
      WorkflowAdapterOutputMetadata(
        provider: $0.provider,
        model: $0.model,
        completionPassed: $0.completionPassed,
        when: $0.when
      )
    }
    if let adapterFailure = request.adapterFailure {
      _ = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          adapterOutput: adapterOutputMetadata,
          failureReason: "\(adapterFailure.code.rawValue): \(adapterFailure.message)"
        )
      )
      try? await finalizeCandidatePathIfNeeded(for: request)
      throw adapterFailure
    }

    let candidate: RuntimeOutputCandidate
    do {
      candidate = try await runtimeCandidate(from: request)
    } catch {
      try? await finalizeCandidatePathIfNeeded(for: request)
      _ = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          adapterOutput: adapterOutputMetadata,
          failureReason: String(describing: error)
        )
      )
      throw error
    }
    do {
      try await finalizeCandidatePathIfNeeded(for: request)
    } catch {
      _ = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          adapterOutput: adapterOutputMetadata,
          failureReason: String(describing: error)
        )
      )
      throw error
    }

    let validation = try validator.validate(candidate, contract: request.outputContract)
    guard validation.status == .accepted, let payload = validation.payload else {
      let reason = validation.reason ?? "output validation rejected candidate"
      let failedExecution = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          adapterOutput: adapterOutputMetadata,
          failureReason: reason
        )
      )
      let session = try await store.loadSession(id: request.sessionId)
      throw WorkflowPublicationError.validationRejected(failedExecution.failureReason ?? session?.status.rawValue ?? reason)
    }

    let publishableTransitions = request.transitions.filter { shouldPublish(transition: $0, when: candidate.when) }
    if let reason = unsupportedTransitionReason(in: publishableTransitions) {
      _ = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          adapterOutput: adapterOutputMetadata,
          failureReason: reason
        )
      )
      throw WorkflowPublicationError.unsupportedTransition(reason)
    }

    let acceptedOutput = WorkflowAcceptedOutputMetadata(
      payload: payload,
      when: candidate.when,
      isRootOutput: request.publishesRootOutput,
      acceptedAt: clock.now()
    )
    var completedExecution = try await store.updateStepExecution(
      WorkflowStepExecutionUpdateInput(
        sessionId: request.sessionId,
        executionId: recordedExecution.executionId,
        status: .completed,
        acceptedOutput: acceptedOutput,
        adapterOutput: adapterOutputMetadata
      )
    )

    let messageInputs = publishableTransitions
      .map { transition in
        WorkflowMessageAppendInput(
          workflowExecutionId: request.sessionId,
          fromStepId: request.stepId,
          toStepId: transition.toStepId,
          routingScope: .workflow,
          deliveryKind: .direct,
          sourceStepExecutionId: completedExecution.executionId,
          transitionCondition: transition.label,
          payload: payload
        )
      }
    let publishedMessages: [WorkflowMessageRecord]
    do {
      publishedMessages = try await store.appendWorkflowMessages(messageInputs)
    } catch {
      completedExecution = try await store.updateStepExecution(
        WorkflowStepExecutionUpdateInput(
          sessionId: request.sessionId,
          executionId: recordedExecution.executionId,
          status: .failed,
          acceptedOutput: nil,
          adapterOutput: adapterOutputMetadata,
          failureReason: String(describing: error)
        )
      )
      throw error
    }

    guard let session = try await store.loadSession(id: request.sessionId) else {
      throw WorkflowRuntimeStoreError.sessionNotFound(request.sessionId)
    }
    return WorkflowPublicationResult(
      session: session,
      stepExecution: completedExecution,
      publishedMessages: publishedMessages,
      rootOutput: request.publishesRootOutput ? payload : nil
    )
  }

  private func runtimeCandidate(from request: WorkflowPublicationRequest) async throws -> RuntimeOutputCandidate {
    let sources = candidateSources(from: request)
    if sources.count > 1 {
      throw WorkflowPublicationError.ambiguousCandidateSources(sources)
    }
    if request.candidatePathReservation != nil, request.candidatePath == nil {
      throw WorkflowPublicationError.candidatePathReservationRequiresCandidatePath
    }
    if let adapterOutput = request.adapterOutput {
      return try normalizeRuntimeAdapterOutput(adapterOutput)
    }
    if let inlineCandidate = request.inlineCandidate {
      return try normalizeRuntimeInlineCandidate(inlineCandidate)
    }
    if let candidatePath = request.candidatePath {
      guard let reservation = request.candidatePathReservation else {
        throw WorkflowPublicationError.candidatePathRequiresReservation
      }
      guard candidatePath.standardizedFileURL == reservation.candidatePath.standardizedFileURL else {
        throw RuntimeOutputCandidateError.candidatePathDoesNotMatchReservation(candidatePath.path)
      }
      return try await candidatePathReader.readCandidate(
        from: candidatePath,
        stagingDirectory: reservation.stagingDirectory,
        attemptStartedAt: reservation.attemptStartedAt,
        requiresObjectPayload: request.outputContract?.requiredObject ?? false
      )
    }
    throw WorkflowPublicationError.noCandidateOutput
  }

  private func candidateSources(from request: WorkflowPublicationRequest) -> [String] {
    var sources: [String] = []
    if request.adapterOutput != nil {
      sources.append("adapterOutput")
    }
    if request.inlineCandidate != nil {
      sources.append("inlineCandidate")
    }
    if request.candidatePath != nil {
      sources.append("candidatePath")
    }
    return sources
  }

  private func finalizeCandidatePathIfNeeded(for request: WorkflowPublicationRequest) async throws {
    guard let reservation = request.candidatePathReservation else {
      return
    }
    if let candidatePathFinalizer {
      try await candidatePathFinalizer(reservation)
      return
    }
    guard let finalizationRootDirectory = reservation.finalizationRootDirectory else {
      return
    }
    try FileManager.default.createDirectory(at: finalizationRootDirectory, withIntermediateDirectories: true)
    let root = finalizationRootDirectory.standardizedFileURL.resolvingSymlinksInPath()
    let stagingDirectory = reservation.stagingDirectory.standardizedFileURL.resolvingSymlinksInPath()
    guard isFileURL(stagingDirectory, inside: root) else {
      throw RuntimeCandidatePathStagingError.stagingPathEscapesRoot(stagingDirectory.path)
    }
    if FileManager.default.fileExists(atPath: reservation.stagingDirectory.path) {
      try FileManager.default.removeItem(at: reservation.stagingDirectory)
    }
  }

  private func shouldPublish(transition: WorkflowStepTransition, when: [String: Bool]) -> Bool {
    guard let label = transition.label else {
      return true
    }
    return when[label] ?? false
  }

  private func unsupportedTransitionReason(in transitions: [WorkflowStepTransition]) -> String? {
    for transition in transitions {
      if transition.toWorkflowId != nil {
        return "cross-workflow transitions are not supported by the Swift TASK-005 in-memory publisher"
      }
      if transition.resumeStepId != nil {
        return "resume-step transitions are not supported by the Swift TASK-005 in-memory publisher"
      }
      if transition.fanout != nil {
        return "fanout transitions are not supported by the Swift TASK-005 in-memory publisher"
      }
    }
    return nil
  }
}

private func isFileURL(_ url: URL, inside directory: URL) -> Bool {
  let path = url.path
  let directoryPath = directory.path
  return path == directoryPath || path.hasPrefix(directoryPath + "/")
}
