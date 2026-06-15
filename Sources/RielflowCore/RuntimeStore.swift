import Foundation

public protocol WorkflowRuntimeClock: Sendable {
  func now() -> Date
}

public struct SystemWorkflowRuntimeClock: WorkflowRuntimeClock {
  public init() {}

  public func now() -> Date {
    Date()
  }
}

public struct FixedWorkflowRuntimeClock: WorkflowRuntimeClock {
  public var fixedDate: Date

  public init(_ fixedDate: Date) {
    self.fixedDate = fixedDate
  }

  public func now() -> Date {
    fixedDate
  }
}

public protocol WorkflowRuntimeIDGenerating: Sendable {
  func nextSessionId(workflowId: String) throws -> String
  func nextStepExecutionId(stepId: String, attempt: Int) throws -> String
  func nextCommunicationId() throws -> String
  func noteExistingSessionId(_ sessionId: String, workflowId: String)
}

extension WorkflowRuntimeIDGenerating {
  public func noteExistingSessionId(_ sessionId: String, workflowId: String) {}
}

public final class MonotonicWorkflowRuntimeIDGenerator: WorkflowRuntimeIDGenerating, @unchecked Sendable {
  private let lock = NSLock()
  private var sessionCounter = 0
  private var executionCounter = 0
  private var communicationCounter = 0

  public init() {}

  public func nextSessionId(workflowId: String) throws -> String {
    lock.lock()
    defer { lock.unlock() }
    sessionCounter += 1
    return "\(workflowId)-session-\(sessionCounter)"
  }

  public func nextStepExecutionId(stepId: String, attempt: Int) throws -> String {
    lock.lock()
    defer { lock.unlock() }
    executionCounter += 1
    return "\(stepId)-attempt-\(attempt)-exec-\(executionCounter)"
  }

  public func nextCommunicationId() throws -> String {
    lock.lock()
    defer { lock.unlock() }
    communicationCounter += 1
    return "comm-\(String(format: "%06d", communicationCounter))"
  }

  public func noteExistingSessionId(_ sessionId: String, workflowId: String) {
    lock.lock()
    defer { lock.unlock() }
    let prefix = "\(workflowId)-session-"
    guard sessionId.hasPrefix(prefix) else {
      return
    }
    let suffix = sessionId.dropFirst(prefix.count)
    guard let parsed = Int(suffix) else {
      return
    }
    sessionCounter = max(sessionCounter, parsed)
  }
}

public struct WorkflowSessionCreateInput: Equatable, Sendable {
  public var workflowId: String
  public var entryStepId: String

  public init(workflowId: String, entryStepId: String) {
    self.workflowId = workflowId
    self.entryStepId = entryStepId
  }
}

public struct WorkflowStepExecutionRecordInput: Equatable, Sendable {
  public var sessionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: NodeExecutionBackend?

  public init(sessionId: String, stepId: String, nodeId: String, attempt: Int, backend: NodeExecutionBackend? = nil) {
    self.sessionId = sessionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.attempt = attempt
    self.backend = backend
  }
}

public struct WorkflowStepExecutionUpdateInput: Equatable, Sendable {
  public var sessionId: String
  public var executionId: String
  public var status: WorkflowStepExecutionStatus
  public var acceptedOutput: WorkflowAcceptedOutputMetadata?
  public var adapterOutput: WorkflowAdapterOutputMetadata?
  public var failureReason: String?
  public var completesRootWithoutOutput: Bool

  public init(
    sessionId: String,
    executionId: String,
    status: WorkflowStepExecutionStatus,
    acceptedOutput: WorkflowAcceptedOutputMetadata? = nil,
    adapterOutput: WorkflowAdapterOutputMetadata? = nil,
    failureReason: String? = nil,
    completesRootWithoutOutput: Bool = false
  ) {
    self.sessionId = sessionId
    self.executionId = executionId
    self.status = status
    self.acceptedOutput = acceptedOutput
    self.adapterOutput = adapterOutput
    self.failureReason = failureReason
    self.completesRootWithoutOutput = completesRootWithoutOutput
  }
}

public struct WorkflowMessageAppendInput: Equatable, Sendable {
  public var workflowExecutionId: String
  public var fromStepId: String?
  public var toStepId: String?
  public var routingScope: WorkflowMessageRoutingScope
  public var deliveryKind: WorkflowMessageDeliveryKind
  public var sourceStepExecutionId: String
  public var transitionCondition: String?
  public var payload: JSONObject
  public var artifactRefs: [String]

  public init(
    workflowExecutionId: String,
    fromStepId: String?,
    toStepId: String?,
    routingScope: WorkflowMessageRoutingScope = .workflow,
    deliveryKind: WorkflowMessageDeliveryKind = .direct,
    sourceStepExecutionId: String,
    transitionCondition: String? = nil,
    payload: JSONObject,
    artifactRefs: [String] = []
  ) {
    self.workflowExecutionId = workflowExecutionId
    self.fromStepId = fromStepId
    self.toStepId = toStepId
    self.routingScope = routingScope
    self.deliveryKind = deliveryKind
    self.sourceStepExecutionId = sourceStepExecutionId
    self.transitionCondition = transitionCondition
    self.payload = payload
    self.artifactRefs = artifactRefs
  }
}

public enum WorkflowRuntimeStoreError: Error, Equatable, Sendable {
  case sessionNotFound(String)
  case stepExecutionNotFound(String)
  case messageAppendRejected(String)
}

public protocol WorkflowRuntimeStore: Sendable {
  func createSession(_ input: WorkflowSessionCreateInput) async throws -> WorkflowSession
  func recordStepExecution(_ input: WorkflowStepExecutionRecordInput) async throws -> WorkflowStepExecution
  func updateStepExecution(_ input: WorkflowStepExecutionUpdateInput) async throws -> WorkflowStepExecution
  func appendWorkflowMessage(_ input: WorkflowMessageAppendInput) async throws -> WorkflowMessageRecord
  func appendWorkflowMessages(_ inputs: [WorkflowMessageAppendInput]) async throws -> [WorkflowMessageRecord]
  func listMessages(for sessionId: String, toStepId: String?) async throws -> [WorkflowMessageRecord]
  func loadSession(id: String) async throws -> WorkflowSession?
}

public struct WorkflowResolvedMessageInput: Codable, Equatable, Sendable {
  public var workflowExecutionId: String
  public var stepId: String
  public var messages: [WorkflowMessageRecord]
  public var payload: JSONObject
  public var communicationIds: [String]
  public var sourceStepIds: [String]

  public init(
    workflowExecutionId: String,
    stepId: String,
    messages: [WorkflowMessageRecord],
    payload: JSONObject,
    communicationIds: [String],
    sourceStepIds: [String]
  ) {
    self.workflowExecutionId = workflowExecutionId
    self.stepId = stepId
    self.messages = messages
    self.payload = payload
    self.communicationIds = communicationIds
    self.sourceStepIds = sourceStepIds
  }

  public func applying(to input: AdapterExecutionInput) -> AdapterExecutionInput {
    var adapterInput = input
    for (key, value) in payload {
      adapterInput.mergedVariables[key] = value
    }
    return adapterInput
  }
}

public protocol WorkflowMessageInputResolving: Sendable {
  func resolveInput(
    for sessionId: String,
    stepId: String,
    store: any WorkflowRuntimeStore
  ) async throws -> WorkflowResolvedMessageInput
}

public struct DefaultWorkflowMessageInputResolver: WorkflowMessageInputResolving {
  public init() {}

  public func resolveInput(
    for sessionId: String,
    stepId: String,
    store: any WorkflowRuntimeStore
  ) async throws -> WorkflowResolvedMessageInput {
    let messages = try await store.listMessages(for: sessionId, toStepId: stepId)
      .filter { $0.isResolvableInput }
      .sorted {
        if $0.createdOrder == $1.createdOrder {
          return $0.communicationId < $1.communicationId
        }
        return $0.createdOrder < $1.createdOrder
      }
    var payload: JSONObject = [:]
    var sourceStepIds: [String] = []
    for message in messages {
      if let fromStepId = message.fromStepId, !sourceStepIds.contains(fromStepId) {
        sourceStepIds.append(fromStepId)
      }
      for (key, value) in message.payload {
        payload[key] = value
      }
    }
    return WorkflowResolvedMessageInput(
      workflowExecutionId: sessionId,
      stepId: stepId,
      messages: messages,
      payload: payload,
      communicationIds: messages.map(\.communicationId),
      sourceStepIds: sourceStepIds
    )
  }
}

public actor InMemoryWorkflowRuntimeStore: WorkflowRuntimeStore {
  public typealias AppendFailurePredicate = @Sendable (WorkflowMessageAppendInput) -> String?

  private let clock: any WorkflowRuntimeClock
  private let idGenerator: any WorkflowRuntimeIDGenerating
  private let appendFailurePredicate: AppendFailurePredicate?
  private var sessions: [String: WorkflowSession] = [:]
  private var messagesBySession: [String: [WorkflowMessageRecord]] = [:]
  private var createdOrder = 0

  public init(
    clock: any WorkflowRuntimeClock = SystemWorkflowRuntimeClock(),
    idGenerator: any WorkflowRuntimeIDGenerating = MonotonicWorkflowRuntimeIDGenerator(),
    appendFailurePredicate: AppendFailurePredicate? = nil
  ) {
    self.clock = clock
    self.idGenerator = idGenerator
    self.appendFailurePredicate = appendFailurePredicate
  }

  public func seedSession(_ session: WorkflowSession) {
    idGenerator.noteExistingSessionId(session.sessionId, workflowId: session.workflowId)
    sessions[session.sessionId] = session
    if messagesBySession[session.sessionId] == nil {
      messagesBySession[session.sessionId] = []
    }
  }

  public func createSession(_ input: WorkflowSessionCreateInput) async throws -> WorkflowSession {
    let date = clock.now()
    let sessionId = try idGenerator.nextSessionId(workflowId: input.workflowId)
    let session = WorkflowSession(
      workflowId: input.workflowId,
      sessionId: sessionId,
      status: .created,
      entryStepId: input.entryStepId,
      currentStepId: input.entryStepId,
      createdAt: date,
      updatedAt: date
    )
    sessions[sessionId] = session
    messagesBySession[sessionId] = []
    return session
  }

  public func recordStepExecution(_ input: WorkflowStepExecutionRecordInput) async throws -> WorkflowStepExecution {
    guard var session = sessions[input.sessionId] else {
      throw WorkflowRuntimeStoreError.sessionNotFound(input.sessionId)
    }
    let date = clock.now()
    let execution = WorkflowStepExecution(
      executionId: try idGenerator.nextStepExecutionId(stepId: input.stepId, attempt: input.attempt),
      stepId: input.stepId,
      nodeId: input.nodeId,
      attempt: input.attempt,
      backend: input.backend,
      status: .running,
      createdAt: date,
      updatedAt: date
    )
    session.status = .running
    session.currentStepId = input.stepId
    session.updatedAt = date
    session.executions.append(execution)
    sessions[input.sessionId] = session
    return execution
  }

  public func updateStepExecution(_ input: WorkflowStepExecutionUpdateInput) async throws -> WorkflowStepExecution {
    guard var session = sessions[input.sessionId] else {
      throw WorkflowRuntimeStoreError.sessionNotFound(input.sessionId)
    }
    guard let index = session.executions.firstIndex(where: { $0.executionId == input.executionId }) else {
      throw WorkflowRuntimeStoreError.stepExecutionNotFound(input.executionId)
    }

    let date = clock.now()
    var execution = session.executions[index]
    execution.status = input.status
    execution.acceptedOutput = input.acceptedOutput
    execution.adapterOutput = input.adapterOutput ?? execution.adapterOutput
    execution.failureReason = input.failureReason
    execution.updatedAt = date
    session.executions[index] = execution
    session.updatedAt = date
    switch input.status {
    case .failed:
      session.status = .failed
    case .completed where input.acceptedOutput?.isRootOutput == true || input.completesRootWithoutOutput:
      session.status = .completed
    case .completed, .running:
      session.status = .running
    }
    sessions[input.sessionId] = session
    return execution
  }

  public func appendWorkflowMessage(_ input: WorkflowMessageAppendInput) async throws -> WorkflowMessageRecord {
    let records = try await appendWorkflowMessages([input])
    guard let record = records.first else {
      throw WorkflowRuntimeStoreError.messageAppendRejected("empty append")
    }
    return record
  }

  public func appendWorkflowMessages(_ inputs: [WorkflowMessageAppendInput]) async throws -> [WorkflowMessageRecord] {
    guard let firstInput = inputs.first else {
      return []
    }
    guard sessions[firstInput.workflowExecutionId] != nil else {
      throw WorkflowRuntimeStoreError.sessionNotFound(firstInput.workflowExecutionId)
    }
    for input in inputs {
      guard input.workflowExecutionId == firstInput.workflowExecutionId else {
        throw WorkflowRuntimeStoreError.sessionNotFound(input.workflowExecutionId)
      }
      if let reason = appendFailurePredicate?(input) {
        throw WorkflowRuntimeStoreError.messageAppendRejected(reason)
      }
    }

    var records: [WorkflowMessageRecord] = []
    for input in inputs {
      createdOrder += 1
      records.append(
        WorkflowMessageRecord(
          communicationId: try idGenerator.nextCommunicationId(),
          workflowExecutionId: input.workflowExecutionId,
          fromStepId: input.fromStepId,
          toStepId: input.toStepId,
          routingScope: input.routingScope,
          deliveryKind: input.deliveryKind,
          sourceStepExecutionId: input.sourceStepExecutionId,
          transitionCondition: input.transitionCondition,
          payload: input.payload,
          artifactRefs: input.artifactRefs,
          lifecycleStatus: .delivered,
          createdOrder: createdOrder,
          createdAt: clock.now()
        )
      )
    }
    messagesBySession[firstInput.workflowExecutionId, default: []].append(contentsOf: records)
    return records
  }

  public func listMessages(for sessionId: String, toStepId: String?) async throws -> [WorkflowMessageRecord] {
    guard sessions[sessionId] != nil else {
      throw WorkflowRuntimeStoreError.sessionNotFound(sessionId)
    }
    let messages = messagesBySession[sessionId, default: []]
    guard let toStepId else {
      return messages.sorted { $0.createdOrder < $1.createdOrder }
    }
    return messages.filter { $0.toStepId == toStepId }.sorted { $0.createdOrder < $1.createdOrder }
  }

  public func loadSession(id: String) async throws -> WorkflowSession? {
    sessions[id]
  }
}

private extension WorkflowMessageRecord {
  var isResolvableInput: Bool {
    switch lifecycleStatus {
    case .delivered, .consumed:
      return true
    case .created, .failed, .superseded:
      return false
    }
  }
}
