import Foundation

public enum CliAgentBackend: String, Codable, CaseIterable, Sendable {
  case codexAgent = "codex-agent"
  case claudeCodeAgent = "claude-code-agent"
  case cursorCliAgent = "cursor-cli-agent"
}

public enum NodeExecutionBackend: String, Codable, CaseIterable, Sendable {
  case codexAgent = "codex-agent"
  case claudeCodeAgent = "claude-code-agent"
  case cursorCliAgent = "cursor-cli-agent"
  case officialOpenAISDK = "official/openai-sdk"
  case officialAnthropicSDK = "official/anthropic-sdk"
  case officialCursorSDK = "official/cursor-sdk"

  public var cliAgentBackend: CliAgentBackend? {
    switch self {
    case .codexAgent:
      .codexAgent
    case .claudeCodeAgent:
      .claudeCodeAgent
    case .cursorCliAgent:
      .cursorCliAgent
    case .officialOpenAISDK, .officialAnthropicSDK, .officialCursorSDK:
      nil
    }
  }
}

public enum NodeReasoningEffort: String, Codable, CaseIterable, Sendable {
  case low
  case medium
  case high
  case xhigh
}

public enum NodeRole: String, Codable, Sendable {
  case manager
  case worker
}

public enum WorkflowRegistryNodeKind: String, Codable, Sendable {
  case task
  case branchJudge = "branch-judge"
  case loopJudge = "loop-judge"
  case input
  case output
}

public enum NodeType: String, Codable, Sendable {
  case agent
  case command
  case container
  case sleep
  case userAction = "user-action"
  case addon
}

public enum NodeSessionMode: String, Codable, Sendable {
  case new
  case reuse
}

public struct WorkflowDefaults: Codable, Equatable, Sendable {
  public var nodeTimeoutMs: Int
  public var maxLoopIterations: Int
  public var fanoutConcurrency: Int?

  public init(nodeTimeoutMs: Int, maxLoopIterations: Int, fanoutConcurrency: Int? = nil) {
    self.nodeTimeoutMs = nodeTimeoutMs
    self.maxLoopIterations = maxLoopIterations
    self.fanoutConcurrency = fanoutConcurrency
  }
}

public struct WorkflowPrompts: Codable, Equatable, Sendable {
  public var rielflowPromptTemplate: String?
  public var workerSystemPromptTemplate: String?
  public var chatFailureMessageTemplate: String?

  public init(
    rielflowPromptTemplate: String? = nil,
    workerSystemPromptTemplate: String? = nil,
    chatFailureMessageTemplate: String? = nil
  ) {
    self.rielflowPromptTemplate = rielflowPromptTemplate
    self.workerSystemPromptTemplate = workerSystemPromptTemplate
    self.chatFailureMessageTemplate = chatFailureMessageTemplate
  }
}

public struct WorkflowNodeExecutionPolicy: Codable, Equatable, Sendable {
  public var mode: String?
  public var decisionBy: String?

  public init(mode: String? = nil, decisionBy: String? = nil) {
    self.mode = mode
    self.decisionBy = decisionBy
  }
}

public struct WorkflowNodeRepeatPolicy: Codable, Equatable, Sendable {
  public var `while`: String
  public var restartAt: String?
  public var maxIterations: Int?

  public init(whileExpression: String, restartAt: String? = nil, maxIterations: Int? = nil) {
    self.`while` = whileExpression
    self.restartAt = restartAt
    self.maxIterations = maxIterations
  }
}

public struct WorkflowNodeAddonRef: Codable, Equatable, Sendable {
  public var name: String
  public var version: String?
  public var config: JSONObject?
  public var env: JSONObject?
  public var inputs: JSONObject?

  public init(
    name: String,
    version: String? = nil,
    config: JSONObject? = nil,
    env: JSONObject? = nil,
    inputs: JSONObject? = nil
  ) {
    self.name = name
    self.version = version
    self.config = config
    self.env = env
    self.inputs = inputs
  }
}

public struct WorkflowNodeRegistryRef: Codable, Equatable, Sendable {
  public var id: String
  public var nodeFile: String?
  public var addon: WorkflowNodeAddonRef?
  public var execution: WorkflowNodeExecutionPolicy?
  public var kind: WorkflowRegistryNodeKind?
  public var repeatPolicy: WorkflowNodeRepeatPolicy?

  enum CodingKeys: String, CodingKey {
    case id
    case nodeFile
    case addon
    case execution
    case kind
    case repeatPolicy = "repeat"
  }

  public init(
    id: String,
    nodeFile: String? = nil,
    addon: WorkflowNodeAddonRef? = nil,
    execution: WorkflowNodeExecutionPolicy? = nil,
    kind: WorkflowRegistryNodeKind? = nil,
    repeatPolicy: WorkflowNodeRepeatPolicy? = nil
  ) {
    self.id = id
    self.nodeFile = nodeFile
    self.addon = addon
    self.execution = execution
    self.kind = kind
    self.repeatPolicy = repeatPolicy
  }
}

public enum WorkflowFanoutFailurePolicy: String, Codable, Sendable {
  case failFast = "fail-fast"
  case collectAll = "collect-all"
}

public enum WorkflowFanoutResultOrder: String, Codable, Sendable {
  case input
}

public enum WorkflowFanoutWriteOwnershipMode: String, Codable, Sendable {
  case readOnly = "read-only"
  case disjointPaths = "disjoint-paths"
  case isolatedWorkspace = "isolated-workspace"
}

public struct WorkflowFanoutWriteOwnership: Codable, Equatable, Sendable {
  public var mode: WorkflowFanoutWriteOwnershipMode
  public var paths: [String]?
  public var directories: [String]?

  public init(mode: WorkflowFanoutWriteOwnershipMode, paths: [String]? = nil, directories: [String]? = nil) {
    self.mode = mode
    self.paths = paths
    self.directories = directories
  }
}

public struct WorkflowStepFanout: Codable, Equatable, Sendable {
  public var groupId: String
  public var itemsFrom: String
  public var itemVariable: String?
  public var concurrency: Int?
  public var joinStepId: String
  public var failurePolicy: WorkflowFanoutFailurePolicy?
  public var resultOrder: WorkflowFanoutResultOrder?
  public var writeOwnership: WorkflowFanoutWriteOwnership?

  public init(
    groupId: String,
    itemsFrom: String,
    itemVariable: String? = nil,
    concurrency: Int? = nil,
    joinStepId: String,
    failurePolicy: WorkflowFanoutFailurePolicy? = nil,
    resultOrder: WorkflowFanoutResultOrder? = nil,
    writeOwnership: WorkflowFanoutWriteOwnership? = nil
  ) {
    self.groupId = groupId
    self.itemsFrom = itemsFrom
    self.itemVariable = itemVariable
    self.concurrency = concurrency
    self.joinStepId = joinStepId
    self.failurePolicy = failurePolicy
    self.resultOrder = resultOrder
    self.writeOwnership = writeOwnership
  }
}

public struct WorkflowStepTransition: Codable, Equatable, Sendable {
  public var toStepId: String
  public var toWorkflowId: String?
  public var resumeStepId: String?
  public var label: String?
  public var fanout: WorkflowStepFanout?

  public init(
    toStepId: String,
    toWorkflowId: String? = nil,
    resumeStepId: String? = nil,
    label: String? = nil,
    fanout: WorkflowStepFanout? = nil
  ) {
    self.toStepId = toStepId
    self.toWorkflowId = toWorkflowId
    self.resumeStepId = resumeStepId
    self.label = label
    self.fanout = fanout
  }
}

public struct WorkflowStepSessionPolicy: Codable, Equatable, Sendable {
  public var mode: NodeSessionMode?
  public var inheritFromStepId: String?

  public init(mode: NodeSessionMode? = nil, inheritFromStepId: String? = nil) {
    self.mode = mode
    self.inheritFromStepId = inheritFromStepId
  }
}

public struct WorkflowStepRef: Codable, Equatable, Sendable {
  public var id: String
  public var stepFile: String?
  public var nodeId: String
  public var description: String?
  public var role: NodeRole?
  public var promptVariant: String?
  public var timeoutMs: Int?
  public var stallTimeoutMs: Int?
  public var sessionPolicy: WorkflowStepSessionPolicy?
  public var transitions: [WorkflowStepTransition]?

  public init(
    id: String,
    stepFile: String? = nil,
    nodeId: String,
    description: String? = nil,
    role: NodeRole? = nil,
    promptVariant: String? = nil,
    timeoutMs: Int? = nil,
    stallTimeoutMs: Int? = nil,
    sessionPolicy: WorkflowStepSessionPolicy? = nil,
    transitions: [WorkflowStepTransition]? = nil
  ) {
    self.id = id
    self.stepFile = stepFile
    self.nodeId = nodeId
    self.description = description
    self.role = role
    self.promptVariant = promptVariant
    self.timeoutMs = timeoutMs
    self.stallTimeoutMs = stallTimeoutMs
    self.sessionPolicy = sessionPolicy
    self.transitions = transitions
  }
}

public struct AuthoredWorkflowJSON: Codable, Equatable, Sendable {
  public var workflowId: String
  public var description: String?
  public var defaults: WorkflowDefaults
  public var prompts: WorkflowPrompts?
  public var managerStepId: String?
  public var entryStepId: String?
  public var nodes: [WorkflowNodeRegistryRef]
  public var steps: [WorkflowStepRef]?

  public init(
    workflowId: String,
    description: String? = nil,
    defaults: WorkflowDefaults,
    prompts: WorkflowPrompts? = nil,
    managerStepId: String? = nil,
    entryStepId: String? = nil,
    nodes: [WorkflowNodeRegistryRef],
    steps: [WorkflowStepRef]? = nil
  ) {
    self.workflowId = workflowId
    self.description = description
    self.defaults = defaults
    self.prompts = prompts
    self.managerStepId = managerStepId
    self.entryStepId = entryStepId
    self.nodes = nodes
    self.steps = steps
  }
}

public struct WorkflowNodeRef: Codable, Equatable, Sendable {
  public var id: String
  public var nodeFile: String?
  public var addon: WorkflowNodeAddonRef?
  public var kind: WorkflowRegistryNodeKind?
  public var role: NodeRole?
  public var execution: WorkflowNodeExecutionPolicy?
  public var repeatPolicy: WorkflowNodeRepeatPolicy?

  enum CodingKeys: String, CodingKey {
    case id
    case nodeFile
    case addon
    case kind
    case role
    case execution
    case repeatPolicy = "repeat"
  }

  public init(
    id: String,
    nodeFile: String? = nil,
    addon: WorkflowNodeAddonRef? = nil,
    kind: WorkflowRegistryNodeKind? = nil,
    role: NodeRole? = nil,
    execution: WorkflowNodeExecutionPolicy? = nil,
    repeatPolicy: WorkflowNodeRepeatPolicy? = nil
  ) {
    self.id = id
    self.nodeFile = nodeFile
    self.addon = addon
    self.kind = kind
    self.role = role
    self.execution = execution
    self.repeatPolicy = repeatPolicy
  }
}

public struct WorkflowDefinition: Codable, Equatable, Sendable {
  public var workflowId: String
  public var description: String
  public var defaults: WorkflowDefaults
  public var prompts: WorkflowPrompts?
  public var managerStepId: String?
  public var entryStepId: String
  public var nodeRegistry: [WorkflowNodeRegistryRef]
  public var steps: [WorkflowStepRef]
  public var nodes: [WorkflowNodeRef]

  public init(
    workflowId: String,
    description: String = "",
    defaults: WorkflowDefaults,
    prompts: WorkflowPrompts? = nil,
    managerStepId: String? = nil,
    entryStepId: String,
    nodeRegistry: [WorkflowNodeRegistryRef],
    steps: [WorkflowStepRef],
    nodes: [WorkflowNodeRef]
  ) {
    self.workflowId = workflowId
    self.description = description
    self.defaults = defaults
    self.prompts = prompts
    self.managerStepId = managerStepId
    self.entryStepId = entryStepId
    self.nodeRegistry = nodeRegistry
    self.steps = steps
    self.nodes = nodes
  }
}

public struct AgentNodePayload: Codable, Equatable, Sendable {
  public var id: String
  public var description: String?
  public var nodeType: NodeType?
  public var executionBackend: NodeExecutionBackend?
  public var model: String
  public var effort: NodeReasoningEffort?
  public var workingDirectory: String?
  public var variables: JSONObject
  public var input: NodeInputContract?
  public var output: NodeOutputContract?

  public init(
    id: String,
    description: String? = nil,
    nodeType: NodeType? = nil,
    executionBackend: NodeExecutionBackend? = nil,
    model: String,
    effort: NodeReasoningEffort? = nil,
    workingDirectory: String? = nil,
    variables: JSONObject = [:],
    input: NodeInputContract? = nil,
    output: NodeOutputContract? = nil
  ) {
    self.id = id
    self.description = description
    self.nodeType = nodeType
    self.executionBackend = executionBackend
    self.model = model
    self.effort = effort
    self.workingDirectory = workingDirectory
    self.variables = variables
    self.input = input
    self.output = output
  }
}

public struct NodeInputContract: Codable, Equatable, Sendable {
  public var description: String?
  public var jsonSchema: JSONObject?

  public init(description: String? = nil, jsonSchema: JSONObject? = nil) {
    self.description = description
    self.jsonSchema = jsonSchema
  }
}

public struct NodeOutputContract: Codable, Equatable, Sendable {
  public var description: String?
  public var jsonSchema: JSONObject?
  public var maxValidationAttempts: Int?

  public init(description: String? = nil, jsonSchema: JSONObject? = nil, maxValidationAttempts: Int? = nil) {
    self.description = description
    self.jsonSchema = jsonSchema
    self.maxValidationAttempts = maxValidationAttempts
  }
}

public func normalizeCliAgentBackend(_ rawValue: String) -> CliAgentBackend? {
  CliAgentBackend(rawValue: rawValue)
}

public func normalizeNodeExecutionBackend(_ rawValue: String) -> NodeExecutionBackend? {
  NodeExecutionBackend(rawValue: rawValue)
}

public func nodeExecutionBackendListText() -> String {
  let values = NodeExecutionBackend.allCases.map(\.rawValue)
  guard let last = values.last else {
    return ""
  }
  let leading = values.dropLast()
  return leading.isEmpty ? last : "\(leading.joined(separator: ", ")), or \(last)"
}
