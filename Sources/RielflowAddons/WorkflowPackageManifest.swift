import Foundation
import RielflowCore

public enum WorkflowPackageKind: String, Codable, Sendable {
  case workflow
  case nodeAddon = "node-addon"
}

public enum WorkflowPackageSkillVendor: String, Codable, CaseIterable, Sendable {
  case agents
  case claude
  case codex
  case cursor
  case gemini
}

public enum WorkflowPackageAddonExecutionKind: String, Codable, Sendable {
  case declarative
  case container
  case localCommand = "local-command"
}

public struct WorkflowAddonCapability: Codable, Equatable, Sendable {
  public var name: String
  public var required: Bool?
  public var scope: String?
  public var reason: String?
  public var defaultPolicy: String?

  public init(name: String, required: Bool? = nil, scope: String? = nil, reason: String? = nil, defaultPolicy: String? = nil) {
    self.name = name
    self.required = required
    self.scope = scope
    self.reason = reason
    self.defaultPolicy = defaultPolicy
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case name
    case required
    case scope
    case reason
    case defaultPolicy
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest add-on capability")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.name = try container.decode(String.self, forKey: .name)
    self.required = try container.decodeIfPresent(Bool.self, forKey: .required)
    self.scope = try container.decodeIfPresent(String.self, forKey: .scope)
    self.reason = try container.decodeIfPresent(String.self, forKey: .reason)
    self.defaultPolicy = try container.decodeIfPresent(String.self, forKey: .defaultPolicy)
  }
}

public struct WorkflowPackageAddonCapabilityGrant: Codable, Equatable, Sendable {
  public var allowed: Bool
  public var scope: String?

  public init(allowed: Bool, scope: String? = nil) {
    self.allowed = allowed
    self.scope = scope
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case allowed
    case scope
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest add-on capability grant")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.allowed = try container.decode(Bool.self, forKey: .allowed)
    self.scope = try container.decodeIfPresent(String.self, forKey: .scope)
  }
}

public struct WorkflowPackageWorkflow: Codable, Equatable, Sendable {
  public var title: String?
  public var description: String
  public var tags: [String]
  public var backends: [String]
  fileprivate var tagsFieldPresent: Bool

  public init(title: String? = nil, description: String, tags: [String] = [], backends: [String] = []) {
    self.title = title
    self.description = description
    self.tags = tags
    self.backends = backends
    self.tagsFieldPresent = true
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case title
    case description
    case tags
    case backends
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest workflow")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.title = try container.decodeIfPresent(String.self, forKey: .title)
    self.description = try container.decode(String.self, forKey: .description)
    self.tagsFieldPresent = container.contains(.tags)
    self.tags = self.tagsFieldPresent ? try container.decode([String].self, forKey: .tags) : []
    self.backends = try container.decodeIfPresent([String].self, forKey: .backends) ?? []
  }
}

public struct WorkflowPackageSkill: Codable, Equatable, Sendable {
  public var vendor: WorkflowPackageSkillVendor
  public var name: String
  public var sourcePath: String

  public init(vendor: WorkflowPackageSkillVendor, name: String, sourcePath: String) {
    self.vendor = vendor
    self.name = name
    self.sourcePath = sourcePath
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case vendor
    case name
    case sourcePath
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest skill")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.vendor = try container.decode(WorkflowPackageSkillVendor.self, forKey: .vendor)
    self.name = try container.decode(String.self, forKey: .name)
    self.sourcePath = try container.decode(String.self, forKey: .sourcePath)
  }
}

public struct WorkflowPackageAddonExecutionDescriptor: Codable, Equatable, Sendable {
  public var kind: WorkflowPackageAddonExecutionKind
  public var entrypoint: String?
  public var containerfilePath: String?
  public var runtimeHints: [String]

  public init(
    kind: WorkflowPackageAddonExecutionKind,
    entrypoint: String? = nil,
    containerfilePath: String? = nil,
    runtimeHints: [String] = []
  ) {
    self.kind = kind
    self.entrypoint = entrypoint
    self.containerfilePath = containerfilePath
    self.runtimeHints = runtimeHints
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case kind
    case entrypoint
    case containerfilePath
    case runtimeHints
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest add-on execution")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.kind = try container.decode(WorkflowPackageAddonExecutionKind.self, forKey: .kind)
    self.entrypoint = try container.decodeIfPresent(String.self, forKey: .entrypoint)
    self.containerfilePath = try container.decodeIfPresent(String.self, forKey: .containerfilePath)
    self.runtimeHints = try container.decodeIfPresent([String].self, forKey: .runtimeHints) ?? []
  }
}

public struct WorkflowPackageNodeAddon: Codable, Equatable, Sendable {
  public var name: String
  public var version: String
  public var sourcePath: String
  public var execution: WorkflowPackageAddonExecutionDescriptor?
  public var capabilities: [WorkflowAddonCapability]
  public var contentDigest: String?

  public init(
    name: String,
    version: String,
    sourcePath: String,
    execution: WorkflowPackageAddonExecutionDescriptor? = nil,
    capabilities: [WorkflowAddonCapability] = [],
    contentDigest: String? = nil
  ) {
    self.name = name
    self.version = version
    self.sourcePath = sourcePath
    self.execution = execution
    self.capabilities = capabilities
    self.contentDigest = contentDigest
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case name
    case version
    case sourcePath
    case execution
    case capabilities
    case contentDigest
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest add-on")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.name = try container.decode(String.self, forKey: .name)
    self.version = try container.decode(String.self, forKey: .version)
    self.sourcePath = try container.decode(String.self, forKey: .sourcePath)
    self.execution = try container.decodeIfPresent(WorkflowPackageAddonExecutionDescriptor.self, forKey: .execution)
    self.capabilities = try container.decodeIfPresent([WorkflowAddonCapability].self, forKey: .capabilities) ?? []
    self.contentDigest = try container.decodeIfPresent(String.self, forKey: .contentDigest)
  }
}

public struct WorkflowPackageManifestAddonDependencyLock: Codable, Equatable, Sendable {
  public var name: String
  public var version: String
  public var contentDigest: String?
  public var capabilityGrant: [String: WorkflowPackageAddonCapabilityGrant]
  public var optional: Bool

  public init(
    name: String,
    version: String,
    contentDigest: String? = nil,
    capabilityGrant: [String: WorkflowPackageAddonCapabilityGrant] = [:],
    optional: Bool = false
  ) {
    self.name = name
    self.version = version
    self.contentDigest = contentDigest
    self.capabilityGrant = capabilityGrant
    self.optional = optional
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case name
    case version
    case contentDigest
    case capabilityGrant
    case optional
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest dependency add-on lock")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.name = try container.decode(String.self, forKey: .name)
    self.version = try container.decode(String.self, forKey: .version)
    self.contentDigest = try container.decodeIfPresent(String.self, forKey: .contentDigest)
    self.capabilityGrant = try container.decodeIfPresent([String: WorkflowPackageAddonCapabilityGrant].self, forKey: .capabilityGrant) ?? [:]
    self.optional = try container.decodeIfPresent(Bool.self, forKey: .optional) ?? false
  }
}

public struct WorkflowPackageDependency: Codable, Equatable, Sendable {
  public var packageId: String
  public var registry: String?
  public var branch: String?
  public var kind: WorkflowPackageKind?
  public var addons: [WorkflowPackageManifestAddonDependencyLock]

  public init(
    packageId: String,
    registry: String? = nil,
    branch: String? = nil,
    kind: WorkflowPackageKind? = nil,
    addons: [WorkflowPackageManifestAddonDependencyLock] = []
  ) {
    self.packageId = packageId
    self.registry = registry
    self.branch = branch
    self.kind = kind
    self.addons = addons
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case packageId
    case registry
    case branch
    case kind
    case addons
  }

  public init(from decoder: Decoder) throws {
    if let packageId = try? decoder.singleValueContainer().decode(String.self) {
      self.packageId = packageId
      self.registry = nil
      self.branch = nil
      self.kind = nil
      self.addons = []
      return
    }
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest dependency")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.packageId = try container.decode(String.self, forKey: .packageId)
    self.registry = try container.decodeIfPresent(String.self, forKey: .registry)
    self.branch = try container.decodeIfPresent(String.self, forKey: .branch)
    self.kind = try container.decodeIfPresent(WorkflowPackageKind.self, forKey: .kind)
    self.addons = try container.decodeIfPresent([WorkflowPackageManifestAddonDependencyLock].self, forKey: .addons) ?? []
  }
}

public struct WorkflowPackageSignature: Codable, Equatable, Sendable {
  public var keyId: String
  public var algorithm: String
  public var signature: String

  public init(keyId: String, algorithm: String = "ed25519", signature: String) {
    self.keyId = keyId
    self.algorithm = algorithm
    self.signature = signature
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case keyId
    case algorithm
    case signature
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest signature")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.keyId = try container.decode(String.self, forKey: .keyId)
    self.algorithm = try container.decodeIfPresent(String.self, forKey: .algorithm) ?? "ed25519"
    self.signature = try container.decode(String.self, forKey: .signature)
  }
}

public struct WorkflowPackageIntegrity: Codable, Equatable, Sendable {
  public var digestAlgorithm: String
  public var digest: String
  public var signatures: [WorkflowPackageSignature]

  public init(digestAlgorithm: String = "sha256", digest: String, signatures: [WorkflowPackageSignature] = []) {
    self.digestAlgorithm = digestAlgorithm
    self.digest = digest
    self.signatures = signatures
  }

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case digestAlgorithm
    case digest
    case signatures
  }

  public init(from decoder: Decoder) throws {
    try rejectUnsupportedKeys(decoder, allowed: CodingKeys.allCases.map(\.rawValue), label: "package manifest integrity")
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.digestAlgorithm = try container.decodeIfPresent(String.self, forKey: .digestAlgorithm) ?? "sha256"
    self.digest = try container.decode(String.self, forKey: .digest)
    self.signatures = try container.decodeIfPresent([WorkflowPackageSignature].self, forKey: .signatures) ?? []
  }
}

public struct WorkflowPackageManifest: Codable, Equatable, Sendable {
  public var name: String
  public var version: String?
  public var kind: WorkflowPackageKind
  public var description: String?
  public var tags: [String]
  public var registry: String?
  public var checksum: String?
  public var checksumAlgorithm: String?
  public var workflow: WorkflowPackageWorkflow?
  public var workflows: [WorkflowPackageWorkflow]
  public var workflowDirectory: String?
  public var skillDirectory: String?
  public var nodeAddons: [WorkflowPackageNodeAddon]
  public var skills: [WorkflowPackageSkill]
  public var dependencies: [WorkflowPackageDependency]
  public var integrity: WorkflowPackageIntegrity?
  public var title: String?
  public var authors: [String]
  public var license: String?
  public var homepage: String?
  public var repository: String?
  public var examples: [String]
  public var minimumRielflowVersion: String?
  public var backends: [String]
  fileprivate var tagsFieldPresent: Bool

  private enum CodingKeys: String, CodingKey, CaseIterable {
    case name
    case version
    case kind
    case description
    case tags
    case registry
    case checksum
    case checksumAlgorithm
    case workflow
    case workflows
    case workflowDirectory
    case skillDirectory
    case addons
    case skills
    case dependencies
    case integrity
    case title
    case authors
    case license
    case homepage
    case repository
    case examples
    case minimumRielflowVersion
    case backends
  }

  public init(
    name: String,
    version: String? = nil,
    kind: WorkflowPackageKind = .workflow,
    description: String? = nil,
    tags: [String] = [],
    registry: String? = nil,
    checksum: String? = nil,
    checksumAlgorithm: String? = nil,
    workflow: WorkflowPackageWorkflow? = nil,
    workflows: [WorkflowPackageWorkflow] = [],
    workflowDirectory: String? = nil,
    skillDirectory: String? = nil,
    nodeAddons: [WorkflowPackageNodeAddon] = [],
    skills: [WorkflowPackageSkill] = [],
    dependencies: [WorkflowPackageDependency] = [],
    integrity: WorkflowPackageIntegrity? = nil,
    title: String? = nil,
    authors: [String] = [],
    license: String? = nil,
    homepage: String? = nil,
    repository: String? = nil,
    examples: [String] = [],
    minimumRielflowVersion: String? = nil,
    backends: [String] = []
  ) {
    self.name = name
    self.version = version
    self.kind = kind
    self.description = description
    self.tags = tags
    self.registry = registry
    self.checksum = checksum
    self.checksumAlgorithm = checksumAlgorithm
    self.workflow = workflow
    self.workflows = workflows
    self.workflowDirectory = workflowDirectory
    self.skillDirectory = skillDirectory
    self.nodeAddons = nodeAddons
    self.skills = skills
    self.dependencies = dependencies
    self.integrity = integrity
    self.title = title
    self.authors = authors
    self.license = license
    self.homepage = homepage
    self.repository = repository
    self.examples = examples
    self.minimumRielflowVersion = minimumRielflowVersion
    self.backends = backends
    self.tagsFieldPresent = true
  }

  public init(from decoder: Decoder) throws {
    let allowed = Set(CodingKeys.allCases.map(\.rawValue))
    let dynamic = try decoder.container(keyedBy: DynamicCodingKey.self)
    for key in dynamic.allKeys where !allowed.contains(key.stringValue) {
      throw DecodingError.dataCorruptedError(
        forKey: key,
        in: dynamic,
        debugDescription: "package manifest has unsupported key '\(key.stringValue)'"
      )
    }

    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.name = try container.decode(String.self, forKey: .name)
    self.version = try container.decodeIfPresent(String.self, forKey: .version)
    self.kind = try container.decodeIfPresent(WorkflowPackageKind.self, forKey: .kind) ?? .workflow
    self.description = try container.decodeIfPresent(String.self, forKey: .description)
    self.tagsFieldPresent = container.contains(.tags)
    self.tags = self.tagsFieldPresent ? try container.decode([String].self, forKey: .tags) : []
    self.registry = try container.decodeIfPresent(String.self, forKey: .registry)
    self.checksum = try container.decodeIfPresent(String.self, forKey: .checksum)
    self.checksumAlgorithm = try container.decodeIfPresent(String.self, forKey: .checksumAlgorithm)
    self.workflow = try container.decodeIfPresent(WorkflowPackageWorkflow.self, forKey: .workflow)
    self.workflows = try container.decodeIfPresent([WorkflowPackageWorkflow].self, forKey: .workflows) ?? []
    self.workflowDirectory = try container.decodeIfPresent(String.self, forKey: .workflowDirectory)
    self.skillDirectory = try container.decodeIfPresent(String.self, forKey: .skillDirectory)
    self.nodeAddons = try container.decodeIfPresent([WorkflowPackageNodeAddon].self, forKey: .addons) ?? []
    self.skills = try container.decodeIfPresent([WorkflowPackageSkill].self, forKey: .skills) ?? []
    self.dependencies = try container.decodeIfPresent([WorkflowPackageDependency].self, forKey: .dependencies) ?? []
    self.integrity = try container.decodeIfPresent(WorkflowPackageIntegrity.self, forKey: .integrity)
    self.title = try container.decodeIfPresent(String.self, forKey: .title)
    self.authors = try container.decodeIfPresent([String].self, forKey: .authors) ?? []
    self.license = try container.decodeIfPresent(String.self, forKey: .license)
    self.homepage = try container.decodeIfPresent(String.self, forKey: .homepage)
    self.repository = try container.decodeIfPresent(String.self, forKey: .repository)
    self.examples = try container.decodeIfPresent([String].self, forKey: .examples) ?? []
    self.minimumRielflowVersion = try container.decodeIfPresent(String.self, forKey: .minimumRielflowVersion)
    self.backends = try container.decodeIfPresent([String].self, forKey: .backends) ?? []
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encodeIfPresent(version, forKey: .version)
    try container.encode(kind, forKey: .kind)
    try container.encodeIfPresent(description, forKey: .description)
    try container.encode(tags, forKey: .tags)
    try container.encodeIfPresent(registry, forKey: .registry)
    try container.encodeIfPresent(checksum, forKey: .checksum)
    try container.encodeIfPresent(checksumAlgorithm, forKey: .checksumAlgorithm)
    try container.encodeIfPresent(workflow, forKey: .workflow)
    try container.encode(workflows, forKey: .workflows)
    try container.encodeIfPresent(workflowDirectory, forKey: .workflowDirectory)
    try container.encodeIfPresent(skillDirectory, forKey: .skillDirectory)
    try container.encode(nodeAddons, forKey: .addons)
    try container.encode(skills, forKey: .skills)
    try container.encode(dependencies, forKey: .dependencies)
    try container.encodeIfPresent(integrity, forKey: .integrity)
    try container.encodeIfPresent(title, forKey: .title)
    try container.encode(authors, forKey: .authors)
    try container.encodeIfPresent(license, forKey: .license)
    try container.encodeIfPresent(homepage, forKey: .homepage)
    try container.encodeIfPresent(repository, forKey: .repository)
    try container.encode(examples, forKey: .examples)
    try container.encodeIfPresent(minimumRielflowVersion, forKey: .minimumRielflowVersion)
    try container.encode(backends, forKey: .backends)
  }
}

public struct WorkflowPackageValidationIssue: Codable, Equatable, Sendable {
  public var code: String
  public var path: String
  public var message: String

  public init(code: String, path: String, message: String) {
    self.code = code
    self.path = path
    self.message = message
  }
}

public protocol WorkflowPackageManifestLoading: Sendable {
  func loadManifest(from url: URL) async throws -> WorkflowPackageManifest
  func validate(_ manifest: WorkflowPackageManifest, packageRoot: URL) async -> [WorkflowPackageValidationIssue]
}

public enum WorkflowPackageManifestLoadingError: Error, Equatable, Sendable {
  case nonFileURL(String)
}

public struct FileWorkflowPackageManifestLoader: WorkflowPackageManifestLoading {
  public init() {}

  public func loadManifest(from url: URL) async throws -> WorkflowPackageManifest {
    guard url.isFileURL else {
      throw WorkflowPackageManifestLoadingError.nonFileURL(url.absoluteString)
    }
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(WorkflowPackageManifest.self, from: data)
  }

  public func validate(_ manifest: WorkflowPackageManifest, packageRoot: URL) async -> [WorkflowPackageValidationIssue] {
    var issues = WorkflowPackageManifestValidator.validate(manifest)
    issues.append(contentsOf: WorkflowPackageManifestValidator.validateWorkflowBundle(manifest, packageRoot: packageRoot))
    return issues
  }
}

public enum WorkflowPackageManifestValidator {
  private static let addonCapabilityNames: Set<String> = [
    "network.egress",
    "filesystem.read",
    "filesystem.write",
    "process.spawn",
    "container.build",
    "container.run",
    "device.gpu",
    "env.read"
  ]

  private static let sensitiveAddonCapabilityNames: Set<String> = [
    "network.egress",
    "process.spawn",
    "device.gpu",
    "env.read"
  ]

  private static let addonCapabilityDefaultPolicies: Set<String> = ["deny", "prompt", "allow"]

  public static func isSafePackageName(_ name: String) -> Bool {
    let pattern = #"^(?:@[a-z0-9][a-z0-9._-]{0,79}/)?[a-z0-9][a-z0-9._-]{0,79}$"#
    return name.range(of: pattern, options: .regularExpression) != nil
  }

  public static func normalizePackageRelativePath(_ rawPath: String) -> String? {
    guard !rawPath.isEmpty, !rawPath.hasPrefix("/"), !isWindowsAbsolutePath(rawPath) else {
      return nil
    }
    let segments = rawPath.replacingOccurrences(of: "\\", with: "/")
      .split(separator: "/", omittingEmptySubsequences: false)
    if segments.contains(where: { $0 == ".." }) {
      return nil
    }
    let normalized = segments
      .reduce(into: [String]()) { parts, part in
        if part.isEmpty || part == "." {
          return
        }
        parts.append(String(part))
      }
      .joined(separator: "/")
    if normalized.isEmpty {
      return "."
    }
    guard normalized != ".", !normalized.hasPrefix("/"), normalized != "..",
      !normalized.hasPrefix("../")
    else {
      return normalized == "." ? "." : nil
    }
    return normalized
  }

  public static func validate(_ manifest: WorkflowPackageManifest) -> [WorkflowPackageValidationIssue] {
    var issues: [WorkflowPackageValidationIssue] = []
    if !isSafePackageName(manifest.name) {
      issues.append(.init(code: "INVALID_MANIFEST", path: "name", message: "package manifest name is invalid"))
    }
    requireNonEmpty(manifest.version, path: "version", into: &issues)
    requireNonEmpty(manifest.description, path: "description", into: &issues)
    requireNonEmpty(manifest.registry, path: "registry", into: &issues)
    requireNonEmpty(manifest.checksum, path: "checksum", into: &issues)
    validateTags(manifest.tags, fieldPresent: manifest.tagsFieldPresent, path: "tags", into: &issues)
    if manifest.checksumAlgorithm != "md5" {
      issues.append(.init(code: "INVALID_MANIFEST", path: "checksumAlgorithm", message: "checksumAlgorithm must be md5"))
    }
    if let workflow = manifest.workflow {
      validateTags(workflow.tags, fieldPresent: workflow.tagsFieldPresent, path: "workflow.tags", into: &issues)
    }
    validatePath(manifest.workflowDirectory, path: "workflowDirectory", into: &issues)
    validatePath(manifest.skillDirectory, path: "skillDirectory", into: &issues)
    for (index, skill) in manifest.skills.enumerated() {
      if skill.name.isEmpty {
        issues.append(.init(code: "INVALID_MANIFEST", path: "skills[\(index)].name", message: "skill name is required"))
      }
      validatePath(skill.sourcePath, path: "skills[\(index)].sourcePath", into: &issues)
    }
    for (index, dependency) in manifest.dependencies.enumerated() {
      if !isSafePackageName(dependency.packageId) || dependency.packageId == manifest.name {
        issues.append(.init(code: "INVALID_MANIFEST", path: "dependencies[\(index)].packageId", message: "dependency packageId is invalid"))
      }
      if dependency.kind == .nodeAddon, dependency.addons.isEmpty {
        issues.append(.init(code: "INVALID_MANIFEST", path: "dependencies[\(index)].addons", message: "node-addon dependency requires add-on locks"))
      }
      for (lockIndex, lock) in dependency.addons.enumerated() {
        for (capabilityName, grant) in lock.capabilityGrant {
          if !addonCapabilityNames.contains(capabilityName) {
            issues.append(.init(code: "INVALID_MANIFEST", path: "dependencies[\(index)].addons[\(lockIndex)].capabilityGrant", message: "capabilityGrant contains unknown capability"))
          }
          validateCapabilityScope(grant.scope, path: "dependencies[\(index)].addons[\(lockIndex)].capabilityGrant.\(capabilityName).scope", into: &issues)
        }
      }
    }
    for (index, addon) in manifest.nodeAddons.enumerated() {
      if addon.name.isEmpty || addon.version.isEmpty {
        issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)]", message: "add-on name and version are required"))
      }
      validateAddonArtifactPath(addon.sourcePath, path: "addons[\(index)].sourcePath", into: &issues)
      if let contentDigest = addon.contentDigest, !isSha256Digest(contentDigest) {
        issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)].contentDigest", message: "contentDigest must be sha256:<64 lowercase hex>"))
      }
      if let execution = addon.execution {
        validateAddonExecution(execution, addonIndex: index, into: &issues)
        if execution.kind != .declarative {
          if addon.capabilities.isEmpty {
            issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)].capabilities", message: "capabilities are required for executable add-ons"))
          }
          if addon.contentDigest == nil {
            issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)].contentDigest", message: "contentDigest is required for executable add-ons"))
          }
        }
      }
      if addon.capabilities.contains(where: { $0.name.isEmpty }) {
        issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)].capabilities", message: "capability names must be non-empty"))
      }
      validateCapabilities(addon.capabilities, path: "addons[\(index)].capabilities", into: &issues)
    }
    if manifest.kind == .nodeAddon {
      if manifest.workflow != nil || manifest.workflowDirectory != nil {
        issues.append(.init(code: "INVALID_MANIFEST", path: "workflow", message: "node-addon package manifest must not include workflow metadata"))
      }
      if manifest.nodeAddons.isEmpty {
        issues.append(.init(code: "INVALID_MANIFEST", path: "addons", message: "node-addon package manifest requires add-ons"))
      }
    }
    var seenAddons = Set<String>()
    for (index, addon) in manifest.nodeAddons.enumerated() {
      let key = "\(addon.name)\u{0}\(addon.version)"
      if !seenAddons.insert(key).inserted {
        issues.append(.init(code: "INVALID_MANIFEST", path: "addons[\(index)]", message: "duplicate add-on name and version"))
      }
    }
    return issues
  }

  public static func validateWorkflowBundle(_ manifest: WorkflowPackageManifest, packageRoot: URL) -> [WorkflowPackageValidationIssue] {
    guard manifest.kind == .workflow else {
      return []
    }
    let rawWorkflowDirectory = manifest.workflowDirectory ?? "."
    guard let workflowDirectory = normalizePackageRelativePath(rawWorkflowDirectory) else {
      return []
    }
    let workflowJsonPath = packageRoot
      .appendingPathComponent(workflowDirectory, isDirectory: true)
      .appendingPathComponent("workflow.json", isDirectory: false)
      .path
    var isDirectory: ObjCBool = false
    if !FileManager.default.fileExists(atPath: workflowJsonPath, isDirectory: &isDirectory) || isDirectory.boolValue {
      return [
        .init(
          code: "MISSING_WORKFLOW_BUNDLE",
          path: "workflowDirectory",
          message: "workflow.json not found for package '\(manifest.name)'"
        )
      ]
    }
    return []
  }

  private static func requireNonEmpty(_ value: String?, path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    if value?.isEmpty != false {
      issues.append(.init(code: "INVALID_MANIFEST", path: path, message: "\(path) is required"))
    }
  }

  private static func validateTags(_ tags: [String], fieldPresent: Bool, path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    if !fieldPresent {
      issues.append(.init(code: "INVALID_MANIFEST", path: path, message: "\(path) is required"))
      return
    }
    for (index, tag) in tags.enumerated() where tag.isEmpty {
      issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)]", message: "tags must be non-empty strings"))
    }
  }

  private static func isSha256Digest(_ value: String) -> Bool {
    value.range(of: #"^sha256:[a-f0-9]{64}$"#, options: .regularExpression) != nil
  }

  private static func validateCapabilities(_ capabilities: [WorkflowAddonCapability], path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    var seen = Set<String>()
    for (index, capability) in capabilities.enumerated() {
      if !addonCapabilityNames.contains(capability.name) {
        issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)].name", message: "capability name is unsupported"))
      }
      validateCapabilityScope(capability.scope, path: "\(path)[\(index)].scope", into: &issues)
      if let reason = capability.reason, reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)].reason", message: "capability reason must be non-empty"))
      }
      if let defaultPolicy = capability.defaultPolicy, !addonCapabilityDefaultPolicies.contains(defaultPolicy) {
        issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)].defaultPolicy", message: "capability defaultPolicy must be deny, prompt, or allow"))
      }
      if sensitiveAddonCapabilityNames.contains(capability.name), capability.reason == nil {
        issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)].reason", message: "sensitive capability requires a reason"))
      }
      let key = "\(capability.name)\u{0}\(capability.scope ?? "")"
      if !seen.insert(key).inserted {
        issues.append(.init(code: "INVALID_MANIFEST", path: "\(path)[\(index)]", message: "duplicate capability name and scope"))
      }
    }
  }

  private static func validateCapabilityScope(_ scope: String?, path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    guard let scope else {
      return
    }
    if scope.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || scope.contains("*") {
      issues.append(.init(code: "INVALID_MANIFEST", path: path, message: "capability scope must be non-empty and must not contain *"))
    }
  }

  private static func validatePath(_ value: String?, path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    guard let value else {
      return
    }
    if normalizePackageRelativePath(value) == nil {
      issues.append(.init(code: "INVALID_MANIFEST", path: path, message: "path must be package-relative"))
    }
  }

  private static func validateAddonExecution(
    _ execution: WorkflowPackageAddonExecutionDescriptor,
    addonIndex index: Int,
    into issues: inout [WorkflowPackageValidationIssue]
  ) {
    validateAddonArtifactPath(execution.entrypoint, path: "addons[\(index)].execution.entrypoint", into: &issues)
    validateAddonArtifactPath(execution.containerfilePath, path: "addons[\(index)].execution.containerfilePath", into: &issues)

    switch execution.kind {
    case .declarative:
      if execution.entrypoint != nil || execution.containerfilePath != nil {
        issues.append(.init(
          code: "INVALID_MANIFEST",
          path: "addons[\(index)].execution",
          message: "declarative execution must not declare executable artifacts"
        ))
      }
    case .container, .localCommand:
      if execution.entrypoint == nil && execution.containerfilePath == nil {
        issues.append(.init(
          code: "INVALID_MANIFEST",
          path: "addons[\(index)].execution",
          message: "executable add-on execution must declare an entrypoint or containerfilePath"
        ))
      }
    }
  }

  private static func validateAddonArtifactPath(_ value: String?, path: String, into issues: inout [WorkflowPackageValidationIssue]) {
    guard let value else {
      return
    }
    if normalizeStrictPackageRelativePath(value) == nil {
      issues.append(.init(code: "INVALID_MANIFEST", path: path, message: "path must be a safe package-relative artifact path"))
    }
  }

  private static func normalizeStrictPackageRelativePath(_ rawPath: String) -> String? {
    if rawPath.isEmpty || rawPath.hasPrefix("/") || isWindowsAbsolutePath(rawPath) {
      return nil
    }
    let segments = rawPath.replacingOccurrences(of: "\\", with: "/")
      .split(separator: "/", omittingEmptySubsequences: true)
    if segments.isEmpty || segments.contains(where: { $0 == "." || $0 == ".." }) {
      return nil
    }
    return segments.joined(separator: "/")
  }

  private static func isWindowsAbsolutePath(_ rawPath: String) -> Bool {
    rawPath.hasPrefix("\\\\") || rawPath.range(of: #"^[A-Za-z]:[\\/]"#, options: .regularExpression) != nil
  }
}

private struct DynamicCodingKey: CodingKey {
  var stringValue: String
  var intValue: Int?

  init?(stringValue: String) {
    self.stringValue = stringValue
  }

  init?(intValue: Int) {
    self.stringValue = String(intValue)
    self.intValue = intValue
  }
}

private func rejectUnsupportedKeys(_ decoder: Decoder, allowed: [String], label: String) throws {
  let allowed = Set(allowed)
  let dynamic = try decoder.container(keyedBy: DynamicCodingKey.self)
  for key in dynamic.allKeys where !allowed.contains(key.stringValue) {
    throw DecodingError.dataCorruptedError(
      forKey: key,
      in: dynamic,
      debugDescription: "\(label) has unsupported key '\(key.stringValue)'"
    )
  }
}
