import Foundation

public struct SwiftDeletionReadinessGate: Codable, Equatable, Sendable {
  public var schemaVersion: Int
  public var migrationStatus: String
  public var allowsTypeScriptDeletion: Bool
  public var productionSwiftPackagingReady: Bool
  public var typeScriptSourceDeletionReady: Bool
  public var notes: String?
  public var domains: [SwiftDeletionReadinessDomain]

  public init(
    schemaVersion: Int,
    migrationStatus: String,
    allowsTypeScriptDeletion: Bool,
    productionSwiftPackagingReady: Bool,
    typeScriptSourceDeletionReady: Bool,
    notes: String? = nil,
    domains: [SwiftDeletionReadinessDomain]
  ) {
    self.schemaVersion = schemaVersion
    self.migrationStatus = migrationStatus
    self.allowsTypeScriptDeletion = allowsTypeScriptDeletion
    self.productionSwiftPackagingReady = productionSwiftPackagingReady
    self.typeScriptSourceDeletionReady = typeScriptSourceDeletionReady
    self.notes = notes
    self.domains = domains
  }
}

public struct SwiftDeletionReadinessDomain: Codable, Equatable, Sendable {
  public var id: String?
  public var status: String?
  public var requiredBeforeTypeScriptDeletion: Bool?
  public var evidenceCommands: [String]?
  public var evidenceArtifacts: [String]?
  public var lastVerifiedAt: String?
  public var reviewDecision: String?
  public var verifiedBranch: String?
  public var verifiedCommit: String?
  public var acceptedReviewWorkflowId: String?
  public var acceptedReviewNodeId: String?
  public var acceptedReviewFindingSeverities: [String]?
  public var notes: String?

  public init(
    id: String?,
    status: String?,
    requiredBeforeTypeScriptDeletion: Bool?,
    evidenceCommands: [String]?,
    evidenceArtifacts: [String]?,
    lastVerifiedAt: String?,
    reviewDecision: String?,
    verifiedBranch: String? = nil,
    verifiedCommit: String? = nil,
    acceptedReviewWorkflowId: String? = nil,
    acceptedReviewNodeId: String? = nil,
    acceptedReviewFindingSeverities: [String]? = nil,
    notes: String? = nil
  ) {
    self.id = id
    self.status = status
    self.requiredBeforeTypeScriptDeletion = requiredBeforeTypeScriptDeletion
    self.evidenceCommands = evidenceCommands
    self.evidenceArtifacts = evidenceArtifacts
    self.lastVerifiedAt = lastVerifiedAt
    self.reviewDecision = reviewDecision
    self.verifiedBranch = verifiedBranch
    self.verifiedCommit = verifiedCommit
    self.acceptedReviewWorkflowId = acceptedReviewWorkflowId
    self.acceptedReviewNodeId = acceptedReviewNodeId
    self.acceptedReviewFindingSeverities = acceptedReviewFindingSeverities
    self.notes = notes
  }
}

public struct SwiftDeletionReadinessValidationContext: Equatable, Sendable {
  public var currentBranch: String
  public var currentCommit: String
  public var expectedAcceptedReviewWorkflowId: String
  public var expectedAcceptedReviewNodeId: String
  public var resolvedEvidenceArtifacts: [String: SwiftDeletionReadinessEvidenceArtifact]

  public init(
    currentBranch: String,
    currentCommit: String,
    expectedAcceptedReviewWorkflowId: String = "codex-design-and-implement-review-loop",
    expectedAcceptedReviewNodeId: String = "step7-adversarial-review",
    resolvedEvidenceArtifacts: [String: SwiftDeletionReadinessEvidenceArtifact] = [:]
  ) {
    self.currentBranch = currentBranch
    self.currentCommit = currentCommit
    self.expectedAcceptedReviewWorkflowId = expectedAcceptedReviewWorkflowId
    self.expectedAcceptedReviewNodeId = expectedAcceptedReviewNodeId
    self.resolvedEvidenceArtifacts = resolvedEvidenceArtifacts
  }
}

public struct SwiftDeletionReadinessEvidenceArtifact: Codable, Equatable, Sendable {
  public var domainId: String
  public var command: String
  public var exitCode: Int
  public var branch: String
  public var commit: String
  public var workflowId: String
  public var nodeId: String

  public init(
    domainId: String,
    command: String,
    exitCode: Int,
    branch: String,
    commit: String,
    workflowId: String,
    nodeId: String
  ) {
    self.domainId = domainId
    self.command = command
    self.exitCode = exitCode
    self.branch = branch
    self.commit = commit
    self.workflowId = workflowId
    self.nodeId = nodeId
  }
}

public struct SwiftDeletionReadinessValidationResult: Equatable, Sendable {
  public var valid: Bool
  public var allowsTypeScriptDeletion: Bool
  public var blockingDomainIds: [String]
  public var diagnostics: [String]

  public init(
    valid: Bool,
    allowsTypeScriptDeletion: Bool,
    blockingDomainIds: [String],
    diagnostics: [String]
  ) {
    self.valid = valid
    self.allowsTypeScriptDeletion = allowsTypeScriptDeletion
    self.blockingDomainIds = blockingDomainIds
    self.diagnostics = diagnostics
  }
}

public struct SwiftDeletionReadinessValidator: Sendable {
  public static let requiredDomainIds: [String] = [
    "package-build",
    "cli",
    "server",
    "graphql",
    "event",
    "workflow-package",
    "persistence",
    "release",
    "documentation",
    "test",
    "agent-codex",
    "agent-claude-code",
    "agent-cursor-cli",
  ]

  private static let allowedStatuses = Set(["passed", "blocked", "stale", "unknown"])
  private static let allowedReviewDecisions = Set(["accepted", "blocked", "not_reviewed"])
  private static let requiredEvidenceCommandGroupsByDomain: [String: [[String]]] = [
    "package-build": [["swift", "build"], ["bun", "typecheck"]],
    "cli": [["swift", "test", "WorkflowCommand"], ["bun", "packages/rielflow/src/bin.ts"]],
    "server": [["swift", "test", "RielflowServer"], ["bun", "typecheck:server"]],
    "graphql": [["swift", "test", "GraphQL"], ["bun", "graphql"]],
    "event": [["swift", "test", "Event"], ["bun", "event"]],
    "workflow-package": [["swift", "test", "WorkflowPackage"], ["bun", "package"]],
    "persistence": [["swift", "test", "Persistence"], ["bun", "manager-session-store"]],
    "release": [["build-homebrew-release.sh"], ["render-homebrew-formula.sh"]],
    "documentation": [["rg", "swift-deletion-readiness"], ["rg", "typescript", "deletion"]],
    "test": [["swift", "test"], ["bun", "test"]],
    "agent-codex": [["swift", "test", "CodexAgent"], ["bun", "codex"]],
    "agent-claude-code": [["swift", "test", "ClaudeCodeAgent"], ["bun", "claude"]],
    "agent-cursor-cli": [["swift", "test", "CursorCLIAgent"], ["bun", "cursor"]],
  ]
  private static let requiredDomainFields = [
    "id",
    "status",
    "requiredBeforeTypeScriptDeletion",
    "evidenceCommands",
    "evidenceArtifacts",
    "lastVerifiedAt",
    "reviewDecision",
    "verifiedBranch",
    "verifiedCommit",
    "acceptedReviewWorkflowId",
    "acceptedReviewNodeId",
    "acceptedReviewFindingSeverities",
    "notes",
  ]
  private static let requiredTopLevelFields = [
    "schemaVersion",
    "migrationStatus",
    "allowsTypeScriptDeletion",
    "productionSwiftPackagingReady",
    "typeScriptSourceDeletionReady",
    "domains",
  ]

  public init() {}

  public func decodeAndValidate(_ data: Data) -> SwiftDeletionReadinessValidationResult {
    decodeAndValidate(data, context: nil)
  }

  public func decodeAndValidate(
    _ data: Data,
    context: SwiftDeletionReadinessValidationContext?
  ) -> SwiftDeletionReadinessValidationResult {
    do {
      let raw = try JSONSerialization.jsonObject(with: data)
      guard let object = raw as? [String: Any] else {
        return SwiftDeletionReadinessValidationResult(
          valid: false,
          allowsTypeScriptDeletion: false,
          blockingDomainIds: [],
          diagnostics: ["gate JSON root must be an object"]
        )
      }

      var diagnostics = structuralDiagnostics(for: object)
      let gate = try JSONDecoder().decode(SwiftDeletionReadinessGate.self, from: data)
      let result = validate(gate, context: context)
      diagnostics.append(contentsOf: result.diagnostics)
      return SwiftDeletionReadinessValidationResult(
        valid: diagnostics.isEmpty,
        allowsTypeScriptDeletion: diagnostics.isEmpty && result.allowsTypeScriptDeletion,
        blockingDomainIds: result.blockingDomainIds,
        diagnostics: diagnostics
      )
    } catch {
      return SwiftDeletionReadinessValidationResult(
        valid: false,
        allowsTypeScriptDeletion: false,
        blockingDomainIds: [],
        diagnostics: ["gate JSON decode failed: \(error)"]
      )
    }
  }

  public func validate(_ gate: SwiftDeletionReadinessGate) -> SwiftDeletionReadinessValidationResult {
    validate(gate, context: nil)
  }

  public func validate(
    _ gate: SwiftDeletionReadinessGate,
    context: SwiftDeletionReadinessValidationContext?
  ) -> SwiftDeletionReadinessValidationResult {
    var diagnostics: [String] = []

    if gate.schemaVersion != 1 {
      diagnostics.append("schemaVersion must be 1")
    }
    if gate.allowsTypeScriptDeletion && gate.typeScriptSourceDeletionReady {
      if gate.migrationStatus != "deletion_ready" {
        diagnostics.append("migrationStatus must be deletion_ready when TypeScript deletion is accepted")
      }
    } else if gate.migrationStatus != "incomplete" {
      diagnostics.append("migrationStatus must remain incomplete until TypeScript deletion is accepted")
    }

    var seenDomainIds = Set<String>()
    var duplicateDomainIds: [String] = []
    var blockingDomainIds: [String] = []

    for domain in gate.domains {
      let domainId = domain.id ?? "<missing-id>"

      if let id = domain.id {
        if seenDomainIds.contains(id) {
          duplicateDomainIds.append(id)
        } else {
          seenDomainIds.insert(id)
        }
        if !Self.requiredDomainIds.contains(id) {
          diagnostics.append("domain \(id) is not a required TypeScript deletion-readiness domain")
        }
      } else {
        diagnostics.append("domain entry missing id")
      }

      if let status = domain.status {
        if !Self.allowedStatuses.contains(status) {
          diagnostics.append("domain \(domainId) has invalid status \(status)")
        }
      } else {
        diagnostics.append("domain \(domainId) missing status")
      }

      if domain.requiredBeforeTypeScriptDeletion != true {
        diagnostics.append("domain \(domainId) must be required before TypeScript deletion")
      }

      if domain.evidenceCommands == nil {
        diagnostics.append("domain \(domainId) missing evidenceCommands")
      }
      if domain.evidenceArtifacts == nil {
        diagnostics.append("domain \(domainId) missing evidenceArtifacts")
      }

      if let reviewDecision = domain.reviewDecision {
        if !Self.allowedReviewDecisions.contains(reviewDecision) {
          diagnostics.append("domain \(domainId) has invalid reviewDecision \(reviewDecision)")
        }
      } else {
        diagnostics.append("domain \(domainId) missing reviewDecision")
      }

      appendDeletionReadyEvidenceDiagnostics(for: domain, domainId: domainId, context: context, to: &diagnostics)

      if isDeletionBlocking(domain, context: context) {
        blockingDomainIds.append(domainId)
      }
    }

    for id in duplicateDomainIds.sorted() {
      diagnostics.append("domain \(id) is duplicated")
    }

    let missingDomainIds = Self.requiredDomainIds.filter { !seenDomainIds.contains($0) }
    for id in missingDomainIds {
      diagnostics.append("required domain \(id) is missing")
      blockingDomainIds.append(id)
    }

    let uniqueBlockingDomainIds = Array(Set(blockingDomainIds)).sorted()
    let hasDeletionReadyEvidence = uniqueBlockingDomainIds.isEmpty

    if gate.allowsTypeScriptDeletion && !hasDeletionReadyEvidence {
      diagnostics.append("allowsTypeScriptDeletion cannot be true while required domains are blocked")
    }
    if gate.typeScriptSourceDeletionReady && !hasDeletionReadyEvidence {
      diagnostics.append("typeScriptSourceDeletionReady cannot be true while required domains are blocked")
    }
    if gate.allowsTypeScriptDeletion != gate.typeScriptSourceDeletionReady {
      diagnostics.append("allowsTypeScriptDeletion and typeScriptSourceDeletionReady must agree")
    }

    return SwiftDeletionReadinessValidationResult(
      valid: diagnostics.isEmpty,
      allowsTypeScriptDeletion: diagnostics.isEmpty && gate.allowsTypeScriptDeletion && gate.typeScriptSourceDeletionReady && hasDeletionReadyEvidence,
      blockingDomainIds: uniqueBlockingDomainIds,
      diagnostics: diagnostics
    )
  }

  private func structuralDiagnostics(for object: [String: Any]) -> [String] {
    var diagnostics: [String] = []

    for field in Self.requiredTopLevelFields where object[field] == nil {
      diagnostics.append("gate missing \(field)")
    }

    guard let rawDomains = object["domains"] as? [[String: Any]] else {
      diagnostics.append("gate domains must be an array")
      return diagnostics
    }

    for (index, domain) in rawDomains.enumerated() {
      let domainId = domain["id"] as? String ?? "domain[\(index)]"
      for field in Self.requiredDomainFields where domain[field] == nil {
        diagnostics.append("domain \(domainId) missing \(field)")
      }
    }

    return diagnostics
  }

  private func appendDeletionReadyEvidenceDiagnostics(
    for domain: SwiftDeletionReadinessDomain,
    domainId: String,
    context: SwiftDeletionReadinessValidationContext?,
    to diagnostics: inout [String]
  ) {
    guard domain.status == "passed" || domain.reviewDecision == "accepted" else {
      return
    }

    if context == nil {
      diagnostics.append("domain \(domainId) cannot be deletion-ready without current branch and commit validation context")
    }
    if domain.verifiedBranch?.isEmpty != false {
      diagnostics.append("domain \(domainId) missing verifiedBranch")
    } else if let context, domain.verifiedBranch != context.currentBranch {
      diagnostics.append("domain \(domainId) verifiedBranch does not match current branch")
    }
    if domain.verifiedCommit?.isEmpty != false {
      diagnostics.append("domain \(domainId) missing verifiedCommit")
    } else if let context, domain.verifiedCommit != context.currentCommit {
      diagnostics.append("domain \(domainId) verifiedCommit does not match current commit")
    }
    if domain.lastVerifiedAt?.isEmpty != false {
      diagnostics.append("domain \(domainId) missing lastVerifiedAt")
    } else if !isISO8601Date(domain.lastVerifiedAt ?? "") {
      diagnostics.append("domain \(domainId) lastVerifiedAt must be ISO-8601")
    }
      if let commands = domain.evidenceCommands {
        if commands.isEmpty {
          diagnostics.append("domain \(domainId) missing evidenceCommands")
        }
        for command in commands where isPlaceholderCommand(command) {
          diagnostics.append("domain \(domainId) evidenceCommands contains placeholder command \(command)")
        }
        appendRequiredEvidenceCommandDiagnostics(commands: commands, domainId: domainId, to: &diagnostics)
      }
    if let artifacts = domain.evidenceArtifacts {
      if artifacts.isEmpty {
        diagnostics.append("domain \(domainId) missing evidenceArtifacts")
      }
      for artifact in artifacts where !isDurableEvidenceArtifact(artifact) {
        diagnostics.append("domain \(domainId) evidenceArtifacts contains non-durable reference \(artifact)")
      }
      if let context, let commands = domain.evidenceCommands {
        appendResolvedEvidenceDiagnostics(
          artifactRefs: artifacts,
          commands: commands,
          domainId: domainId,
          context: context,
          to: &diagnostics
        )
      }
    }
    if domain.acceptedReviewWorkflowId?.isEmpty != false {
      diagnostics.append("domain \(domainId) missing acceptedReviewWorkflowId")
    } else if let context, domain.acceptedReviewWorkflowId != context.expectedAcceptedReviewWorkflowId {
      diagnostics.append("domain \(domainId) acceptedReviewWorkflowId does not match expected review workflow")
    }
    if domain.acceptedReviewNodeId?.isEmpty != false {
      diagnostics.append("domain \(domainId) missing acceptedReviewNodeId")
    } else if let context, domain.acceptedReviewNodeId != context.expectedAcceptedReviewNodeId {
      diagnostics.append("domain \(domainId) acceptedReviewNodeId does not match expected review node")
    }
    guard let severities = domain.acceptedReviewFindingSeverities else {
      diagnostics.append("domain \(domainId) missing acceptedReviewFindingSeverities")
      return
    }
    if severities.isEmpty {
      diagnostics.append("domain \(domainId) acceptedReviewFindingSeverities must include explicit non-blocking severity evidence")
    }
    appendReviewSeverityDiagnostics(severities, domainId: domainId, to: &diagnostics)
  }

  private func isDeletionBlocking(
    _ domain: SwiftDeletionReadinessDomain,
    context: SwiftDeletionReadinessValidationContext?
  ) -> Bool {
    guard domain.requiredBeforeTypeScriptDeletion == true else {
      return true
    }
    guard domain.status == "passed", domain.reviewDecision == "accepted" else {
      return true
    }
    guard let commands = domain.evidenceCommands, !commands.isEmpty else {
      return true
    }
    guard let artifacts = domain.evidenceArtifacts, !artifacts.isEmpty else {
      return true
    }
    guard let lastVerifiedAt = domain.lastVerifiedAt, !lastVerifiedAt.isEmpty else {
      return true
    }
    guard isISO8601Date(lastVerifiedAt) else {
      return true
    }
    if commands.contains(where: isPlaceholderCommand) {
      return true
    }
    if !hasRequiredEvidenceCommands(commands: commands, domainId: domain.id ?? "<missing-id>") {
      return true
    }
    if artifacts.contains(where: { !isDurableEvidenceArtifact($0) }) {
      return true
    }
    guard let context else {
      return true
    }
    guard hasResolvedSuccessfulEvidence(
      artifactRefs: artifacts,
      commands: commands,
      domainId: domain.id ?? "<missing-id>",
      context: context
    ) else {
      return true
    }
    guard domain.verifiedBranch == context.currentBranch, domain.verifiedCommit == context.currentCommit else {
      return true
    }
    guard domain.acceptedReviewWorkflowId == context.expectedAcceptedReviewWorkflowId else {
      return true
    }
    guard domain.acceptedReviewNodeId == context.expectedAcceptedReviewNodeId else {
      return true
    }
    guard let severities = domain.acceptedReviewFindingSeverities else {
      return true
    }
    if severities.isEmpty {
      return true
    }
    if hasBlockingOrInvalidSeverity(severities) {
      return true
    }
    return false
  }

  private enum ReviewSeverityState {
    case nonBlocking
    case blocking
    case invalid
  }

  private func appendReviewSeverityDiagnostics(
    _ severities: [String],
    domainId: String,
    to diagnostics: inout [String]
  ) {
    for severity in severities {
      let normalized = severity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      switch reviewSeverityState(for: normalized) {
      case .nonBlocking:
        continue
      case .blocking:
        diagnostics.append("domain \(domainId) accepted review includes blocking finding severity \(normalized)")
      case .invalid:
        if normalized.isEmpty {
          diagnostics.append("domain \(domainId) accepted review includes blank finding severity")
        } else {
          diagnostics.append("domain \(domainId) accepted review includes unknown finding severity \(normalized)")
        }
      }
    }
  }

  private func hasBlockingOrInvalidSeverity(_ severities: [String]) -> Bool {
    severities.contains { severity in
      let normalized = severity.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      return reviewSeverityState(for: normalized) != .nonBlocking
    }
  }

  private func reviewSeverityState(for normalized: String) -> ReviewSeverityState {
    if normalized.isEmpty {
      return .invalid
    }
    if ["high", "mid", "medium", "critical", "blocker"].contains(normalized) {
      return .blocking
    }
    if ["low", "info", "informational", "none"].contains(normalized) {
      return .nonBlocking
    }
    return .invalid
  }

  private func isISO8601Date(_ value: String) -> Bool {
    ISO8601DateFormatter().date(from: value) != nil
  }

  private func isPlaceholderCommand(_ command: String) -> Bool {
    let normalized = command.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized.isEmpty || normalized == "true" || normalized == ":" || normalized == "noop" || normalized == "n/a"
  }

  private func appendRequiredEvidenceCommandDiagnostics(
    commands: [String],
    domainId: String,
    to diagnostics: inout [String]
  ) {
    for group in missingEvidenceCommandGroups(commands: commands, domainId: domainId) {
      diagnostics.append("domain \(domainId) missing required evidence command matching \(group.joined(separator: " + "))")
    }
  }

  private func hasRequiredEvidenceCommands(commands: [String], domainId: String) -> Bool {
    missingEvidenceCommandGroups(commands: commands, domainId: domainId).isEmpty
  }

  private func missingEvidenceCommandGroups(commands: [String], domainId: String) -> [[String]] {
    guard let requiredGroups = Self.requiredEvidenceCommandGroupsByDomain[domainId] else {
      return []
    }
    return requiredGroups.filter { group in
      !commands.contains { command in
        commandMatches(command, requiredFragments: group)
      }
    }
  }

  private func commandMatches(_ command: String, requiredFragments: [String]) -> Bool {
    let normalized = command.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return requiredFragments.allSatisfy { fragment in
      normalized.contains(fragment.lowercased())
    }
  }

  private func isDurableEvidenceArtifact(_ artifact: String) -> Bool {
    let normalized = artifact.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.hasPrefix("workflow-artifact:")
      || normalized.hasPrefix("verification-result:")
      || normalized.hasPrefix("/tmp/rielflow-artifact-dev/")
  }

  private func appendResolvedEvidenceDiagnostics(
    artifactRefs: [String],
    commands: [String],
    domainId: String,
    context: SwiftDeletionReadinessValidationContext,
    to diagnostics: inout [String]
  ) {
    for artifactRef in artifactRefs {
      guard let evidence = context.resolvedEvidenceArtifacts[artifactRef] else {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) is not resolved")
        continue
      }
      if evidence.exitCode != 0 {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) command exitCode is not 0")
      }
      if evidence.domainId != domainId {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) domainId does not match")
      }
      if !commands.contains(evidence.command) {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) command is not listed")
      }
      if evidence.branch != context.currentBranch {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) branch does not match current branch")
      }
      if evidence.commit != context.currentCommit {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) commit does not match current commit")
      }
      if evidence.workflowId != context.expectedAcceptedReviewWorkflowId {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) workflowId does not match expected review workflow")
      }
      if evidence.nodeId != context.expectedAcceptedReviewNodeId {
        diagnostics.append("domain \(domainId) evidenceArtifact \(artifactRef) nodeId does not match expected review node")
      }
      let coveredCommands = Set(
        artifactRefs.compactMap { artifactRef -> String? in
          guard
            let evidence = context.resolvedEvidenceArtifacts[artifactRef],
            isResolvedSuccessfulEvidence(evidence, domainId: domainId, context: context),
            commands.contains(evidence.command)
          else {
            return nil
          }
          return evidence.command
        }
      )
      for command in Set(commands).sorted() where !coveredCommands.contains(command) {
        diagnostics.append("domain \(domainId) evidenceCommand \(command) has no resolved successful evidenceArtifact")
      }
    }
  }

  private func hasResolvedSuccessfulEvidence(
    artifactRefs: [String],
    commands: [String],
    domainId: String,
    context: SwiftDeletionReadinessValidationContext
  ) -> Bool {
    let allArtifactsResolve = artifactRefs.allSatisfy { artifactRef in
      guard let evidence = context.resolvedEvidenceArtifacts[artifactRef] else {
        return false
      }
      return commands.contains(evidence.command)
        && isResolvedSuccessfulEvidence(evidence, domainId: domainId, context: context)
    }
    let coveredCommands = Set(
      artifactRefs.compactMap { artifactRef -> String? in
        guard
          let evidence = context.resolvedEvidenceArtifacts[artifactRef],
          isResolvedSuccessfulEvidence(evidence, domainId: domainId, context: context),
          commands.contains(evidence.command)
        else {
          return nil
        }
        return evidence.command
      }
    )
    return allArtifactsResolve && Set(commands).isSubset(of: coveredCommands)
  }

  private func isResolvedSuccessfulEvidence(
    _ evidence: SwiftDeletionReadinessEvidenceArtifact,
    domainId: String,
    context: SwiftDeletionReadinessValidationContext
  ) -> Bool {
    evidence.exitCode == 0
      && evidence.domainId == domainId
      && evidence.branch == context.currentBranch
      && evidence.commit == context.currentCommit
      && evidence.workflowId == context.expectedAcceptedReviewWorkflowId
      && evidence.nodeId == context.expectedAcceptedReviewNodeId
  }
}
