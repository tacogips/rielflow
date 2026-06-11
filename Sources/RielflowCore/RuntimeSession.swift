import Foundation

public enum WorkflowSessionStatus: String, Codable, Sendable {
  case created
  case running
  case completed
  case failed
}

public enum WorkflowStepExecutionStatus: String, Codable, Sendable {
  case running
  case completed
  case failed
}

public struct WorkflowAcceptedOutputMetadata: Codable, Equatable, Sendable {
  public var payload: JSONObject
  public var when: [String: Bool]
  public var isRootOutput: Bool
  public var acceptedAt: Date

  public init(payload: JSONObject, when: [String: Bool], isRootOutput: Bool = false, acceptedAt: Date) {
    self.payload = payload
    self.when = when
    self.isRootOutput = isRootOutput
    self.acceptedAt = acceptedAt
  }
}

public struct WorkflowAdapterOutputMetadata: Codable, Equatable, Sendable {
  public var provider: String
  public var model: String
  public var completionPassed: Bool
  public var when: [String: Bool]

  public init(provider: String, model: String, completionPassed: Bool, when: [String: Bool]) {
    self.provider = provider
    self.model = model
    self.completionPassed = completionPassed
    self.when = when
  }
}

public struct WorkflowStepExecution: Codable, Equatable, Sendable {
  public var executionId: String
  public var stepId: String
  public var nodeId: String
  public var attempt: Int
  public var backend: NodeExecutionBackend?
  public var status: WorkflowStepExecutionStatus
  public var acceptedOutput: WorkflowAcceptedOutputMetadata?
  public var adapterOutput: WorkflowAdapterOutputMetadata?
  public var failureReason: String?
  public var createdAt: Date
  public var updatedAt: Date

  public init(
    executionId: String,
    stepId: String,
    nodeId: String,
    attempt: Int,
    backend: NodeExecutionBackend? = nil,
    status: WorkflowStepExecutionStatus = .running,
    acceptedOutput: WorkflowAcceptedOutputMetadata? = nil,
    adapterOutput: WorkflowAdapterOutputMetadata? = nil,
    failureReason: String? = nil,
    createdAt: Date,
    updatedAt: Date
  ) {
    self.executionId = executionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.attempt = attempt
    self.backend = backend
    self.status = status
    self.acceptedOutput = acceptedOutput
    self.adapterOutput = adapterOutput
    self.failureReason = failureReason
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

public struct WorkflowSession: Codable, Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var status: WorkflowSessionStatus
  public var entryStepId: String
  public var currentStepId: String?
  public var createdAt: Date
  public var updatedAt: Date
  public var executions: [WorkflowStepExecution]

  public init(
    workflowId: String,
    sessionId: String,
    status: WorkflowSessionStatus = .created,
    entryStepId: String,
    currentStepId: String? = nil,
    createdAt: Date,
    updatedAt: Date,
    executions: [WorkflowStepExecution] = []
  ) {
    self.workflowId = workflowId
    self.sessionId = sessionId
    self.status = status
    self.entryStepId = entryStepId
    self.currentStepId = currentStepId
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.executions = executions
  }
}

public enum WorkflowMessageRoutingScope: String, Codable, Sendable {
  case workflow
  case root
}

public enum WorkflowMessageDeliveryKind: String, Codable, Sendable {
  case direct
  case fanout
  case rootOutput = "root-output"
}

public enum WorkflowMessageLifecycleStatus: String, Codable, Sendable {
  case created
  case delivered
  case consumed
  case failed
  case superseded
}

public struct WorkflowMessageRecord: Codable, Equatable, Sendable {
  public var communicationId: String
  public var workflowExecutionId: String
  public var fromStepId: String?
  public var toStepId: String?
  public var routingScope: WorkflowMessageRoutingScope
  public var deliveryKind: WorkflowMessageDeliveryKind
  public var sourceStepExecutionId: String
  public var transitionCondition: String?
  public var payload: JSONObject
  public var artifactRefs: [String]
  public var lifecycleStatus: WorkflowMessageLifecycleStatus
  public var createdOrder: Int
  public var createdAt: Date

  public init(
    communicationId: String,
    workflowExecutionId: String,
    fromStepId: String?,
    toStepId: String?,
    routingScope: WorkflowMessageRoutingScope = .workflow,
    deliveryKind: WorkflowMessageDeliveryKind = .direct,
    sourceStepExecutionId: String,
    transitionCondition: String? = nil,
    payload: JSONObject,
    artifactRefs: [String] = [],
    lifecycleStatus: WorkflowMessageLifecycleStatus = .created,
    createdOrder: Int,
    createdAt: Date
  ) {
    self.communicationId = communicationId
    self.workflowExecutionId = workflowExecutionId
    self.fromStepId = fromStepId
    self.toStepId = toStepId
    self.routingScope = routingScope
    self.deliveryKind = deliveryKind
    self.sourceStepExecutionId = sourceStepExecutionId
    self.transitionCondition = transitionCondition
    self.payload = payload
    self.artifactRefs = artifactRefs
    self.lifecycleStatus = lifecycleStatus
    self.createdOrder = createdOrder
    self.createdAt = createdAt
  }
}
