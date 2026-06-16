import Foundation

public enum PromptTemplateAssetLoadingError: Error, Equatable, Sendable {
  case invalidPath(fieldName: String, relativePath: String, message: String)
  case unreadable(fieldName: String, relativePath: String, message: String)

  public var diagnostic: WorkflowValidationDiagnostic {
    switch self {
    case let .invalidPath(fieldName, _, message), let .unreadable(fieldName, _, message):
      WorkflowValidationDiagnostic(severity: .error, path: "node.\(fieldName)", message: message)
    }
  }
}

public struct PromptTemplateAssetLoader: Sendable {
  private let readText: @Sendable (URL) throws -> String

  public init() {
    self.readText = PromptTemplateAssetLoader.defaultReadText
  }

  public init(readText: @escaping @Sendable (URL) throws -> String) {
    self.readText = readText
  }

  public func hydrate(_ payload: AgentNodePayload, workflowDirectory: URL) throws -> AgentNodePayload {
    var hydrated = payload
    if let path = payload.systemPromptTemplateFile {
      hydrated.systemPromptTemplate = try loadTemplate(
        path,
        fieldName: "systemPromptTemplateFile",
        workflowDirectory: workflowDirectory
      )
    }
    if let path = payload.promptTemplateFile {
      hydrated.promptTemplate = try loadTemplate(
        path,
        fieldName: "promptTemplateFile",
        workflowDirectory: workflowDirectory
      )
    }
    if let path = payload.sessionStartPromptTemplateFile {
      hydrated.sessionStartPromptTemplate = try loadTemplate(
        path,
        fieldName: "sessionStartPromptTemplateFile",
        workflowDirectory: workflowDirectory
      )
    }

    if let promptVariants = payload.promptVariants {
      var hydratedVariants: [String: NodePromptVariant] = [:]
      for key in promptVariants.keys.sorted() {
        guard var variant = promptVariants[key] else {
          continue
        }
        if let path = variant.systemPromptTemplateFile {
          variant.systemPromptTemplate = try loadTemplate(
            path,
            fieldName: "promptVariants.\(key).systemPromptTemplateFile",
            workflowDirectory: workflowDirectory
          )
        }
        if let path = variant.promptTemplateFile {
          variant.promptTemplate = try loadTemplate(
            path,
            fieldName: "promptVariants.\(key).promptTemplateFile",
            workflowDirectory: workflowDirectory
          )
        }
        if let path = variant.sessionStartPromptTemplateFile {
          variant.sessionStartPromptTemplate = try loadTemplate(
            path,
            fieldName: "promptVariants.\(key).sessionStartPromptTemplateFile",
            workflowDirectory: workflowDirectory
          )
        }
        hydratedVariants[key] = variant
      }
      hydrated.promptVariants = hydratedVariants
    }

    return hydrated
  }

  private func loadTemplate(_ relativePath: String, fieldName: String, workflowDirectory: URL) throws -> String {
    let resolvedPath = try resolvePromptTemplatePath(relativePath, fieldName: fieldName, workflowDirectory: workflowDirectory)
    do {
      return try readText(resolvedPath)
    } catch {
      throw PromptTemplateAssetLoadingError.unreadable(
        fieldName: fieldName,
        relativePath: relativePath,
        message: "unable to read \(fieldName) '\(relativePath)': \(error.localizedDescription)"
      )
    }
  }

  private static func defaultReadText(_ url: URL) throws -> String {
    try String(contentsOf: url, encoding: .utf8)
  }
}

public func resolvePromptTemplatePath(_ relativePath: String, fieldName: String, workflowDirectory: URL) throws -> URL {
  guard !relativePath.isEmpty else {
    throw PromptTemplateAssetLoadingError.invalidPath(
      fieldName: fieldName,
      relativePath: relativePath,
      message: "\(fieldName) must be a non-empty string"
    )
  }
  guard isSafePromptTemplateRelativePath(relativePath) else {
    throw PromptTemplateAssetLoadingError.invalidPath(
      fieldName: fieldName,
      relativePath: relativePath,
      message: "\(fieldName) '\(relativePath)' must be a workflow-relative path without '.' or '..' segments"
    )
  }
  guard !isReservedWorkflowDefinitionPath(relativePath) else {
    throw PromptTemplateAssetLoadingError.invalidPath(
      fieldName: fieldName,
      relativePath: relativePath,
      message: "\(fieldName) '\(relativePath)' must not reference canonical workflow definition files"
    )
  }

  let root = workflowDirectory.standardizedFileURL.resolvingSymlinksInPath()
  let resolved = root.appendingPathComponent(relativePath).standardizedFileURL
  guard isFileURL(resolved, inside: root) else {
    throw PromptTemplateAssetLoadingError.invalidPath(
      fieldName: fieldName,
      relativePath: relativePath,
      message: "\(fieldName) '\(relativePath)' must stay within workflow directory '\(root.path)'"
    )
  }

  let symlinkResolved = resolved.resolvingSymlinksInPath().standardizedFileURL
  guard isFileURL(symlinkResolved, inside: root) else {
    throw PromptTemplateAssetLoadingError.invalidPath(
      fieldName: fieldName,
      relativePath: relativePath,
      message: "\(fieldName) '\(relativePath)' must stay within workflow directory '\(root.path)'"
    )
  }
  return symlinkResolved
}

private func isSafePromptTemplateRelativePath(_ value: String) -> Bool {
  if value.isEmpty || value.hasPrefix("/") || value.hasPrefix("\\") || matchesPromptTemplatePath(value, pattern: #"^[A-Za-z]:[\\/]"#) {
    return false
  }
  let segments = splitPromptTemplatePath(value)
  if segments.isEmpty {
    return false
  }
  return !segments.contains { segment in
    segment == "." || segment == ".."
  }
}

private func isReservedWorkflowDefinitionPath(_ value: String) -> Bool {
  guard let fileName = splitPromptTemplatePath(value).last else {
    return false
  }
  return fileName == "workflow.json" || matchesPromptTemplatePath(fileName, pattern: #"^node-.+\.json$"#)
}

private func splitPromptTemplatePath(_ value: String) -> [String] {
  value.split { character in
    character == "/" || character == "\\"
  }.map(String.init)
}

private func matchesPromptTemplatePath(_ value: String, pattern: String) -> Bool {
  value.range(of: pattern, options: .regularExpression) != nil
}

private func isFileURL(_ url: URL, inside directory: URL) -> Bool {
  let path = url.standardizedFileURL.path
  let directoryPath = directory.standardizedFileURL.path
  return path == directoryPath || path.hasPrefix(directoryPath + "/")
}
