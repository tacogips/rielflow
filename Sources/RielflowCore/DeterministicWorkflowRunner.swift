import Foundation

public struct DeterministicWorkflowRunRequest: Sendable {
  public var workflow: WorkflowDefinition
  public var nodePayloads: [String: AgentNodePayload]
  public var variables: JSONObject
  public var maxSteps: Int?
  public var maxConcurrency: Int?
  public var maxLoopIterations: Int?
  public var defaultTimeoutMs: Int?
  public var timeoutMs: Int?
  public var addonAttachments: [String: WorkflowAddonAttachmentValue]
  public var addonAttachmentDescriptors: [String: WorkflowAddonAttachmentDescriptor]
  public var rerunFromSessionId: String?
  public var rerunFromStepId: String?
  public var resumeSessionId: String?

  public init(
    workflow: WorkflowDefinition,
    nodePayloads: [String: AgentNodePayload] = [:],
    variables: JSONObject = [:],
    maxSteps: Int? = nil,
    maxConcurrency: Int? = nil,
    maxLoopIterations: Int? = nil,
    defaultTimeoutMs: Int? = nil,
    timeoutMs: Int? = nil,
    addonAttachments: [String: WorkflowAddonAttachmentValue] = [:],
    addonAttachmentDescriptors: [String: WorkflowAddonAttachmentDescriptor] = [:],
    rerunFromSessionId: String? = nil,
    rerunFromStepId: String? = nil,
    resumeSessionId: String? = nil
  ) {
    self.workflow = workflow
    self.nodePayloads = nodePayloads
    self.variables = variables
    self.maxSteps = maxSteps
    self.maxConcurrency = maxConcurrency
    self.maxLoopIterations = maxLoopIterations
    self.defaultTimeoutMs = defaultTimeoutMs
    self.timeoutMs = timeoutMs
    self.addonAttachments = addonAttachments
    self.addonAttachmentDescriptors = addonAttachmentDescriptors
    self.rerunFromSessionId = rerunFromSessionId
    self.rerunFromStepId = rerunFromStepId
    self.resumeSessionId = resumeSessionId
  }
}

public struct WorkflowRunResult: Codable, Equatable, Sendable {
  public var workflowId: String
  public var session: WorkflowSession
  public var rootOutput: JSONObject?
  public var exitCode: Int32
  public var status: WorkflowSessionStatus
  public var nodeExecutions: Int
  public var transitions: Int

  public init(
    workflowId: String,
    session: WorkflowSession,
    rootOutput: JSONObject?,
    exitCode: Int32,
    transitions: Int
  ) {
    self.workflowId = workflowId
    self.session = session
    self.rootOutput = rootOutput
    self.exitCode = exitCode
    self.status = session.status
    self.nodeExecutions = session.executions.count
    self.transitions = transitions
  }
}

public protocol DeterministicWorkflowRunning: Sendable {
  func run(_ request: DeterministicWorkflowRunRequest) async throws -> WorkflowRunResult
}

public struct DeterministicWorkflowRunner: DeterministicWorkflowRunning {
  public var store: any WorkflowRuntimeStore
  public var adapter: any NodeAdapter
  public var addonResolver: (any WorkflowAddonResolving)?
  public var attachmentProjector: any WorkflowAddonAttachmentProjecting
  public var stdioNodeExecutor: (any WorkflowStdioNodeExecuting)?
  public var publisher: any WorkflowOutputPublishing
  public var inputResolver: any WorkflowMessageInputResolving

  public init(
    store: (any WorkflowRuntimeStore)? = nil,
    adapter: any NodeAdapter = DeterministicLocalNodeAdapter(),
    addonResolver: (any WorkflowAddonResolving)? = nil,
    attachmentProjector: any WorkflowAddonAttachmentProjecting = InlineWorkflowAddonAttachmentProjector(),
    stdioNodeExecutor: (any WorkflowStdioNodeExecuting)? = nil,
    publisher: (any WorkflowOutputPublishing)? = nil,
    inputResolver: any WorkflowMessageInputResolving = DefaultWorkflowMessageInputResolver()
  ) {
    let resolvedStore = store ?? InMemoryWorkflowRuntimeStore()
    self.store = resolvedStore
    self.adapter = adapter
    self.addonResolver = addonResolver
    self.attachmentProjector = attachmentProjector
    self.stdioNodeExecutor = stdioNodeExecutor
    self.publisher = publisher ?? InMemoryWorkflowOutputPublisher(store: resolvedStore)
    self.inputResolver = inputResolver
  }

  public func run(_ request: DeterministicWorkflowRunRequest) async throws -> WorkflowRunResult {
    let diagnostics = DefaultWorkflowValidator().validate(request.workflow)
    if let diagnostic = diagnostics.first(where: { $0.severity == .error }) {
      throw DeterministicWorkflowRunnerError.invalidWorkflow("\(diagnostic.path): \(diagnostic.message)")
    }

    do {
      try WorkflowSessionEntryValidation.validateMutuallyExclusiveSessionEntryModes(
        resumeSessionId: request.resumeSessionId,
        rerunFromSessionId: request.rerunFromSessionId,
        continueFromWorkflowExecutionId: nil
      )
    } catch let error as WorkflowSessionEntryValidationError {
      throw DeterministicWorkflowRunnerError.resumeValidation(errorMessage(error))
    }

    let entryStepId: String
    var session: WorkflowSession
    var currentStepId: String?
    if let resumeSessionId = request.resumeSessionId {
      guard let existing = try await store.loadSession(id: resumeSessionId) else {
        throw DeterministicWorkflowRunnerError.resumeValidation("resume session not found: \(resumeSessionId)")
      }
      guard existing.workflowId == request.workflow.workflowId else {
        throw DeterministicWorkflowRunnerError.resumeValidation("session workflow does not match command workflow")
      }
      if existing.status == .completed || existing.status == .failed {
        return WorkflowRunResult(
          workflowId: request.workflow.workflowId,
          session: existing,
          rootOutput: existing.executions.last(where: { $0.acceptedOutput?.isRootOutput == true })?.acceptedOutput?.payload,
          exitCode: existing.status == .completed ? 0 : 1,
          transitions: 0
        )
      }
      session = existing
      currentStepId = existing.currentStepId ?? existing.entryStepId
      entryStepId = existing.entryStepId
    } else if let rerunFromSessionId = request.rerunFromSessionId {
      guard let sourceSession = try await store.loadSession(id: rerunFromSessionId) else {
        throw DeterministicWorkflowRunnerError.rerunValidation("source session not found: \(rerunFromSessionId)")
      }
      guard sourceSession.workflowId == request.workflow.workflowId else {
        throw DeterministicWorkflowRunnerError.rerunValidation("source session workflow does not match command workflow")
      }
      do {
        entryStepId = try WorkflowSessionEntryValidation.validateRerunTarget(
          workflow: request.workflow,
          sourceSession: sourceSession,
          rerunStepId: request.rerunFromStepId
        )
      } catch let error as WorkflowSessionEntryValidationError {
        throw DeterministicWorkflowRunnerError.rerunValidation(errorMessage(error))
      }
      session = try await store.createSession(
        WorkflowSessionCreateInput(workflowId: request.workflow.workflowId, entryStepId: entryStepId)
      )
      currentStepId = entryStepId
    } else {
      entryStepId = request.workflow.entryStepId
      session = try await store.createSession(
        WorkflowSessionCreateInput(workflowId: request.workflow.workflowId, entryStepId: entryStepId)
      )
      currentStepId = entryStepId
    }

    var visitedSteps = 0
    var publishedTransitions = 0
    var rootOutput: JSONObject?
    var executionCounts: [String: Int] = [:]
    let maxLoopIterations = request.maxLoopIterations ?? request.workflow.defaults.maxLoopIterations
    let maxSteps = request.maxSteps ?? max(1, request.workflow.steps.count + maxLoopIterations)

    while let stepId = currentStepId {
      visitedSteps += 1
      if visitedSteps > maxSteps {
        throw DeterministicWorkflowRunnerError.maxStepsExceeded(maxSteps)
      }
      guard let step = request.workflow.steps.first(where: { $0.id == stepId }) else {
        throw DeterministicWorkflowRunnerError.missingStep(stepId)
      }
      guard let registryNode = request.workflow.nodeRegistry.first(where: { $0.id == step.nodeId }) else {
        throw DeterministicWorkflowRunnerError.missingNode(step.nodeId)
      }
      let executionIndex = (executionCounts[step.id] ?? 0) + 1
      executionCounts[step.id] = executionIndex
      let resolvedInput = try await inputResolver.resolveInput(for: session.sessionId, stepId: step.id, store: store)
      let transitions = step.transitions ?? []
      let publishResult: WorkflowPublicationResult
      if let basePayload = request.nodePayloads[step.nodeId] {
        if let stdioNodeKind = workflowStdioNodeExecutionKind(for: basePayload) {
          var executionPayload = basePayload
          executionPayload.id = step.id
          publishResult = try await executeStdioNodeAndPublish(
            kind: stdioNodeKind,
            payload: executionPayload,
            sessionId: session.sessionId,
            workflow: request.workflow,
            step: step,
            resolvedInputPayload: resolvedInput.payload,
            transitions: transitions,
            request: request,
            executionIndex: executionIndex
          )
        } else {
          var executionPayload = try payload(basePayload, applyingPromptVariantFrom: step)
          executionPayload.id = step.id
          let mergedVariables = promptVariables(
            workflow: request.workflow,
            step: step,
            payload: executionPayload,
            requestVariables: request.variables,
            resolvedInputPayload: resolvedInput.payload
          )
          let prompts = composedPrompts(
            workflow: request.workflow,
            step: step,
            payload: executionPayload,
            variables: mergedVariables
          )
          let adapterInput = AdapterExecutionInput(
            node: executionPayload,
            promptText: prompts.promptText,
            systemPromptText: prompts.systemPromptText,
            arguments: request.variables,
            mergedVariables: mergedVariables
          )
          publishResult = try await executeAndPublish(
            adapterInput: adapterInput,
            sessionId: session.sessionId,
            step: step,
            basePayload: basePayload,
            transitions: transitions,
            request: request,
            executionIndex: executionIndex
          )
        }
      } else if let addon = registryNode.addon {
        publishResult = try await executeAddonAndPublish(
          addon: addon,
          sessionId: session.sessionId,
          workflow: request.workflow,
          step: step,
          resolvedInputPayload: resolvedInput.payload,
          transitions: transitions,
          request: request,
          executionIndex: executionIndex
        )
      } else {
        throw DeterministicWorkflowRunnerError.missingNodePayload(step.nodeId)
      }
      session = publishResult.session
      publishedTransitions += publishResult.publishedMessages.count
      rootOutput = publishResult.rootOutput ?? rootOutput
      currentStepId = publishResult.publishedMessages.first?.toStepId
    }

    guard let loadedSession = try await store.loadSession(id: session.sessionId) else {
      throw WorkflowRuntimeStoreError.sessionNotFound(session.sessionId)
    }
    return WorkflowRunResult(
      workflowId: request.workflow.workflowId,
      session: loadedSession,
      rootOutput: rootOutput,
      exitCode: loadedSession.status == .completed ? 0 : 1,
      transitions: publishedTransitions
    )
  }

  private func executeStdioNodeAndPublish(
    kind: WorkflowStdioNodeExecutionKind,
    payload: AgentNodePayload,
    sessionId: String,
    workflow: WorkflowDefinition,
    step: WorkflowStepRef,
    resolvedInputPayload: JSONObject,
    transitions: [WorkflowStepTransition],
    request: DeterministicWorkflowRunRequest,
    executionIndex: Int
  ) async throws -> WorkflowPublicationResult {
    guard let stdioNodeExecutor else {
      let adapterFailure = AdapterExecutionError(.providerError, "missing stdio-node executor for '\(kind.rawValue)' node '\(step.nodeId)'")
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    }

    do {
      let result = try await stdioNodeExecutor.execute(
        WorkflowStdioNodeExecutionInput(
          workflowId: workflow.workflowId,
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          executionIndex: executionIndex,
          kind: kind,
          node: payload,
          variables: request.variables,
          resolvedInputPayload: resolvedInputPayload
        ),
        context: AdapterExecutionContext(deadline: deadline(for: step, request: request))
      )
      if let payload = result.payload {
        let candidate = try normalizeRuntimeInlineCandidate(payload)
        if let adapterFailure = multiplePublishableTransitionFailure(transitions: transitions, candidate: candidate) {
          _ = try? await publisher.publishAcceptedOutput(
            WorkflowPublicationRequest(
              sessionId: sessionId,
              stepId: step.id,
              nodeId: step.nodeId,
              attempt: executionIndex,
              adapterFailure: adapterFailure,
              transitions: transitions,
              publishesRootOutput: transitions.isEmpty
            )
          )
          throw adapterFailure
        }
      }
      return try await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          inlineCandidate: result.payload,
          outputContract: workflowOutputContract(from: payload.output),
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty,
          allowsNoOutput: result.payload == nil
        )
      )
    } catch let adapterFailure as AdapterExecutionError {
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    } catch {
      let adapterFailure = AdapterExecutionError(.providerError, String(describing: error))
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw error
    }
  }

  private func workflowOutputContract(from output: NodeOutputContract?) -> WorkflowOutputContract? {
    guard let output else {
      return nil
    }
    return WorkflowOutputContract(schema: output.jsonSchema, requiredObject: true)
  }

  private func executeAndPublish(
    adapterInput: AdapterExecutionInput,
    sessionId: String,
    step: WorkflowStepRef,
    basePayload: AgentNodePayload,
    transitions: [WorkflowStepTransition],
    request: DeterministicWorkflowRunRequest,
    executionIndex: Int
  ) async throws -> WorkflowPublicationResult {
    let maxAttempts = maxValidationAttempts(from: basePayload.output)
    var lastValidationError: Error?
    for attempt in 1...maxAttempts {
      var attemptInput = adapterInput
      attemptInput.executionIndex = executionIndex
      attemptInput.output = basePayload.output == nil
        ? nil
        : AdapterOutputAttemptContext(maxValidationAttempts: maxAttempts, attempt: attempt)
      let adapterOutput: AdapterExecutionOutput
      do {
        adapterOutput = try await adapter.execute(attemptInput, context: AdapterExecutionContext(deadline: deadline(for: step, request: request)))
      } catch let adapterFailure as AdapterExecutionError {
        _ = try? await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: sessionId,
            stepId: step.id,
            nodeId: step.nodeId,
            attempt: attempt,
            backend: basePayload.executionBackend,
            adapterFailure: adapterFailure,
            transitions: transitions,
            publishesRootOutput: transitions.isEmpty
          )
        )
        throw adapterFailure
      } catch {
        let adapterFailure = AdapterExecutionError(.providerError, String(describing: error))
        _ = try? await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: sessionId,
            stepId: step.id,
            nodeId: step.nodeId,
            attempt: attempt,
            backend: basePayload.executionBackend,
            adapterFailure: adapterFailure,
            transitions: transitions,
            publishesRootOutput: transitions.isEmpty
          )
        )
        throw error
      }
      let candidate: RuntimeOutputCandidate
      do {
        candidate = try normalizeRuntimeAdapterOutput(adapterOutput)
      } catch let adapterFailure as AdapterExecutionError {
        _ = try? await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: sessionId,
            stepId: step.id,
            nodeId: step.nodeId,
            attempt: attempt,
            backend: basePayload.executionBackend,
            adapterFailure: adapterFailure,
            transitions: transitions,
            publishesRootOutput: transitions.isEmpty
          )
        )
        throw adapterFailure
      }
      if let adapterFailure = multiplePublishableTransitionFailure(transitions: transitions, candidate: candidate) {
        _ = try? await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: sessionId,
            stepId: step.id,
            nodeId: step.nodeId,
            attempt: attempt,
            backend: basePayload.executionBackend,
            adapterFailure: adapterFailure,
            transitions: transitions,
            publishesRootOutput: transitions.isEmpty
          )
        )
        throw adapterFailure
      }
      do {
        return try await publisher.publishAcceptedOutput(
          WorkflowPublicationRequest(
            sessionId: sessionId,
            stepId: step.id,
            nodeId: step.nodeId,
            attempt: attempt,
            backend: basePayload.executionBackend,
            adapterOutput: adapterOutput,
            outputContract: workflowOutputContract(from: basePayload.output),
            transitions: transitions,
            publishesRootOutput: transitions.isEmpty
          )
        )
      } catch let error as WorkflowPublicationError {
        guard case .validationRejected = error, attempt < maxAttempts else {
          throw error
        }
        lastValidationError = error
      }
    }
    throw lastValidationError ?? WorkflowPublicationError.validationRejected("output validation rejected candidate")
  }

  private func executeAddonAndPublish(
    addon: WorkflowNodeAddonRef,
    sessionId: String,
    workflow: WorkflowDefinition,
    step: WorkflowStepRef,
    resolvedInputPayload: JSONObject,
    transitions: [WorkflowStepTransition],
    request: DeterministicWorkflowRunRequest,
    executionIndex: Int
  ) async throws -> WorkflowPublicationResult {
    let attachments: [String: WorkflowAddonAttachmentValue]
    do {
      attachments = try await attachmentProjector.project(
        WorkflowAddonAttachmentProjectionRequest(
          workflowId: workflow.workflowId,
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          addon: addon,
          preprojectedAttachments: request.addonAttachments,
          descriptors: request.addonAttachmentDescriptors
        )
      )
    } catch let projectionError as WorkflowAddonAttachmentProjectionError {
      let adapterFailure = projectionError.adapterError
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    } catch {
      let adapterFailure = AdapterExecutionError(.policyBlocked, "native_attachment_projection_failed: \(String(describing: error))")
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    }

    let addonInput = WorkflowAddonExecutionInput(
      workflowId: workflow.workflowId,
      stepId: step.id,
      nodeId: step.nodeId,
      addon: addon,
      variables: request.variables,
      resolvedInputPayload: resolvedInputPayload,
      attachments: attachments
    )
    guard let addonResolver else {
      let adapterFailure = AdapterExecutionError(.providerError, "missing add-on resolver for '\(addon.name)'")
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    }

    let adapterOutput: AdapterExecutionOutput
    do {
      adapterOutput = try await addonResolver.execute(
        addonInput,
        context: AdapterExecutionContext(deadline: deadline(for: step, request: request))
      )
    } catch let adapterFailure as AdapterExecutionError {
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    } catch {
      let adapterFailure = AdapterExecutionError(.providerError, String(describing: error))
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw error
    }

    let candidate = try normalizeRuntimeAdapterOutput(adapterOutput)
    if let adapterFailure = multiplePublishableTransitionFailure(transitions: transitions, candidate: candidate) {
      _ = try? await publisher.publishAcceptedOutput(
        WorkflowPublicationRequest(
          sessionId: sessionId,
          stepId: step.id,
          nodeId: step.nodeId,
          attempt: executionIndex,
          adapterFailure: adapterFailure,
          adapterOutput: adapterOutput,
          transitions: transitions,
          publishesRootOutput: transitions.isEmpty
        )
      )
      throw adapterFailure
    }
    return try await publisher.publishAcceptedOutput(
      WorkflowPublicationRequest(
        sessionId: sessionId,
        stepId: step.id,
        nodeId: step.nodeId,
        attempt: executionIndex,
        adapterOutput: adapterOutput,
        transitions: transitions,
        publishesRootOutput: transitions.isEmpty
      )
    )
  }

  private func maxValidationAttempts(from output: NodeOutputContract?) -> Int {
    max(1, output?.maxValidationAttempts ?? 1)
  }

  private func payload(_ basePayload: AgentNodePayload, applyingPromptVariantFrom step: WorkflowStepRef) throws -> AgentNodePayload {
    guard let promptVariantName = step.promptVariant else {
      return basePayload
    }
    guard let promptVariant = basePayload.promptVariants?[promptVariantName] else {
      throw DeterministicWorkflowRunnerError.missingPromptVariant(step.id, promptVariantName)
    }

    var payload = basePayload
    if promptVariant.systemPromptTemplate != nil || promptVariant.systemPromptTemplateFile != nil {
      payload.systemPromptTemplate = promptVariant.systemPromptTemplate
      payload.systemPromptTemplateFile = promptVariant.systemPromptTemplateFile
    }
    if promptVariant.promptTemplate != nil || promptVariant.promptTemplateFile != nil {
      payload.promptTemplate = promptVariant.promptTemplate
      payload.promptTemplateFile = promptVariant.promptTemplateFile
    }
    if promptVariant.sessionStartPromptTemplate != nil || promptVariant.sessionStartPromptTemplateFile != nil {
      payload.sessionStartPromptTemplate = promptVariant.sessionStartPromptTemplate
      payload.sessionStartPromptTemplateFile = promptVariant.sessionStartPromptTemplateFile
    }
    return payload
  }

  private func promptVariables(
    workflow: WorkflowDefinition,
    step: WorkflowStepRef,
    payload: AgentNodePayload,
    requestVariables: JSONObject,
    resolvedInputPayload: JSONObject
  ) -> JSONObject {
    var variables = payload.variables
    for (key, value) in requestVariables {
      variables[key] = value
    }
    for (key, value) in resolvedInputPayload {
      variables[key] = value
    }
    variables["workflowId"] = .string(workflow.workflowId)
    variables["workflowDescription"] = .string(workflow.description)
    variables["nodeId"] = .string(step.id)
    variables["nodeKind"] = .string(step.role?.rawValue ?? "task")
    return variables
  }

  private func composedPrompts(
    workflow: WorkflowDefinition,
    step: WorkflowStepRef,
    payload: AgentNodePayload,
    variables: JSONObject
  ) -> (promptText: String, systemPromptText: String?) {
    let fallbackPrompt = step.description ?? workflow.description
    let usesConfiguredPromptTemplate = payload.promptTemplate != nil
    let promptTemplate = payload.promptTemplate ?? fallbackPrompt
    let sessionStartPrompt = payload.sessionStartPromptTemplate.map {
      renderPromptTemplate($0, variables: variables).trimmingCharacters(in: .whitespacesAndNewlines)
    } ?? ""
    let promptText = renderPromptTemplate(promptTemplate, variables: variables)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let renderedPromptText = [sessionStartPrompt, promptText]
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")

    let systemPromptText = [
      workflow.prompts?.workerSystemPromptTemplate,
      payload.systemPromptTemplate,
    ]
      .compactMap { template in
        template.map {
          renderPromptTemplate($0, variables: variables)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        }
      }
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")

    return (
      promptText: renderedPromptText.isEmpty && !usesConfiguredPromptTemplate ? fallbackPrompt : renderedPromptText,
      systemPromptText: systemPromptText.isEmpty ? nil : systemPromptText
    )
  }

  private func multiplePublishableTransitionFailure(
    transitions: [WorkflowStepTransition],
    candidate: RuntimeOutputCandidate
  ) -> AdapterExecutionError? {
    let evaluator = WorkflowBranchEvaluator()
    let publishableCount = transitions.filter { transition in
      evaluator.evaluate(label: transition.label, when: candidate.when, payload: candidate.payload)
    }.count
    guard publishableCount > 1 else {
      return nil
    }
    return AdapterExecutionError(
      .invalidOutput,
      "multiple direct transitions are not supported by the Swift TASK-007 sequential runner"
    )
  }

  private func deadline(for step: WorkflowStepRef, request: DeterministicWorkflowRunRequest) -> Date? {
    let timeoutMs = request.timeoutMs ?? step.timeoutMs ?? request.defaultTimeoutMs ?? request.workflow.defaults.nodeTimeoutMs
    guard timeoutMs > 0 else {
      return nil
    }
    return Date(timeIntervalSinceNow: Double(timeoutMs) / 1000)
  }
}

public enum DeterministicWorkflowRunnerError: Error, Equatable, Sendable {
  case invalidWorkflow(String)
  case missingNode(String)
  case missingStep(String)
  case missingNodePayload(String)
  case missingPromptVariant(String, String)
  case maxStepsExceeded(Int)
  case rerunValidation(String)
  case resumeValidation(String)
}

private func errorMessage(_ error: WorkflowSessionEntryValidationError) -> String {
  switch error {
  case let .usage(message), let .validation(message):
    message
  }
}

public struct DeterministicLocalNodeAdapter: NodeAdapter {
  public init() {}

  public func execute(_ input: AdapterExecutionInput, context: AdapterExecutionContext) async throws -> AdapterExecutionOutput {
    AdapterExecutionOutput(
      provider: "deterministic-local",
      model: input.node.model,
      promptText: input.promptText,
      completionPassed: true,
      payload: [
        "nodeId": .string(input.node.id),
        "provider": .string("deterministic-local"),
        "status": .string("completed"),
      ]
    )
  }
}
