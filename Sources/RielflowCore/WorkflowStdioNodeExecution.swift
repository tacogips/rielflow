import Foundation

public enum WorkflowStdioNodeExecutionKind: String, Codable, Equatable, Sendable {
  case command
  case container
}

public struct WorkflowStdioNodeExecutionInput: Equatable, Sendable {
  public var workflowId: String
  public var sessionId: String
  public var stepId: String
  public var nodeId: String
  public var executionIndex: Int
  public var kind: WorkflowStdioNodeExecutionKind
  public var node: AgentNodePayload
  public var variables: JSONObject
  public var resolvedInputPayload: JSONObject

  public init(
    workflowId: String,
    sessionId: String,
    stepId: String,
    nodeId: String,
    executionIndex: Int,
    kind: WorkflowStdioNodeExecutionKind,
    node: AgentNodePayload,
    variables: JSONObject,
    resolvedInputPayload: JSONObject
  ) {
    self.workflowId = workflowId
    self.sessionId = sessionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.executionIndex = executionIndex
    self.kind = kind
    self.node = node
    self.variables = variables
    self.resolvedInputPayload = resolvedInputPayload
  }
}

public struct WorkflowStdioNodeExecutionResult: Equatable, Sendable {
  public var payload: JSONObject?

  public init(payload: JSONObject? = nil) {
    self.payload = payload
  }
}

public struct WorkflowStdioNodeInvocationEnvelope: Codable, Equatable, Sendable {
  public var workflowId: String
  public var workflowExecutionId: String
  public var stepId: String
  public var nodeId: String
  public var executionIndex: Int
  public var nodeType: String
  public var variables: JSONObject
  public var input: JSONObject

  public init(
    workflowId: String,
    workflowExecutionId: String,
    stepId: String,
    nodeId: String,
    executionIndex: Int,
    nodeType: String,
    variables: JSONObject,
    input: JSONObject
  ) {
    self.workflowId = workflowId
    self.workflowExecutionId = workflowExecutionId
    self.stepId = stepId
    self.nodeId = nodeId
    self.executionIndex = executionIndex
    self.nodeType = nodeType
    self.variables = variables
    self.input = input
  }
}

public protocol WorkflowStdioNodeExecuting: Sendable {
  func execute(_ input: WorkflowStdioNodeExecutionInput, context: AdapterExecutionContext) async throws -> WorkflowStdioNodeExecutionResult
}

public func workflowStdioNodeExecutionKind(for payload: AgentNodePayload) -> WorkflowStdioNodeExecutionKind? {
  switch payload.nodeType {
  case .command:
    return .command
  case .container:
    return .container
  case .agent, .sleep, .userAction, .addon, nil:
    return nil
  }
}
