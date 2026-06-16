import Foundation
import RielflowCore

public struct CodexAgentCompatibilityContext: Equatable, Sendable {
  public var codexHome: String?
  public var configDir: String?

  public init(codexHome: String? = nil, configDir: String? = nil) {
    self.codexHome = codexHome
    self.configDir = configDir
  }
}

public struct CodexCLIProcessOptions: Equatable, Sendable {
  public var model: String?
  public var sandbox: String?
  public var fullAuto: Bool
  public var streamGranularity: String?

  public init(model: String? = nil, sandbox: String? = nil, fullAuto: Bool = false, streamGranularity: String? = nil) {
    self.model = model
    self.sandbox = sandbox
    self.fullAuto = fullAuto
    self.streamGranularity = streamGranularity
  }
}

public enum CodexCLICompatibility {
  public enum CommandFamily: String, Equatable, Sendable {
    case session
    case group
    case queue
    case bookmark
    case token
    case files
    case model
    case version
    case graphql
  }

  public struct ParsedCommand: Equatable, Sendable {
    public var family: CommandFamily
    public var action: String?
    public var arguments: [String]
  }

  public static let supportedCommands: [CommandFamily: Set<String>] = [
    .session: ["list", "show", "watch", "run", "resume", "fork", "search", "searchTranscript"],
    .group: ["create", "list", "show", "add", "remove", "pause", "resume", "delete", "run"],
    .queue: ["create", "add", "show", "list", "pause", "resume", "delete", "update", "remove", "move", "mode", "run"],
    .bookmark: ["add", "list", "get", "delete", "search"],
    .token: ["create", "list", "revoke", "rotate"],
    .files: ["list", "patches", "find", "rebuild"],
    .model: ["check"],
    .version: [""],
    .graphql: [""],
  ]

  public static func parseCommand(_ arguments: [String]) throws -> ParsedCommand {
    guard let rawFamily = arguments.first, let family = CommandFamily(rawValue: rawFamily) else {
      throw CodexCLIError.unknownCommand(arguments.first ?? "")
    }
    if family == .version || family == .graphql {
      return ParsedCommand(family: family, action: nil, arguments: Array(arguments.dropFirst()))
    }
    guard arguments.count >= 2 else {
      throw CodexCLIError.missingAction(rawFamily)
    }
    let action = arguments[1]
    guard supportedCommands[family]?.contains(action) == true else {
      throw CodexCLIError.unsupportedAction(rawFamily, action)
    }
    return ParsedCommand(family: family, action: action, arguments: Array(arguments.dropFirst(2)))
  }

  public static func parseProcessOptions(_ arguments: [String]) -> CodexCLIProcessOptions {
    var options = CodexCLIProcessOptions()
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      switch argument {
      case "--model", "-m":
        index += 1
        options.model = index < arguments.count ? arguments[index] : nil
      case "--sandbox":
        index += 1
        options.sandbox = index < arguments.count ? arguments[index] : nil
      case "--full-auto", "--dangerously-bypass-approvals-and-sandbox":
        options.fullAuto = true
      case "--stream-granularity":
        index += 1
        options.streamGranularity = index < arguments.count ? arguments[index] : nil
      default:
        break
      }
      index += 1
    }
    return options
  }

  public static func formatSessionsJSON(_ sessions: [CodexSession]) throws -> String {
    let values = sessions.map { session -> JSONObject in
      [
        "id": .string(session.id),
        "rolloutPath": .string(session.rolloutPath),
        "source": .string(session.source.rawValue),
        "cwd": .string(session.cwd),
        "title": .string(session.title),
      ]
    }
    let data = try JSONEncoder().encode(JSONValue.array(values.map(JSONValue.object)))
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  public static func usage() -> String {
    "session|group|queue|bookmark|token|files|model|version|graphql"
  }
}

public enum CodexCLIError: Error, Equatable {
  case unknownCommand(String)
  case missingAction(String)
  case unsupportedAction(String, String)
}

public enum CodexGraphQLCommandExecutor {
  public struct Result: Equatable, Sendable {
    public var data: JSONValue?
    public var errors: [String]

    public init(data: JSONValue? = nil, errors: [String] = []) {
      self.data = data
      self.errors = errors
    }
  }

  public static let supportedCommandNames: Set<String> = [
    "version.get",
    "session.list", "session.show", "session.search", "session.searchTranscript", "session.run", "session.resume", "session.fork", "session.watch",
    "group.create", "group.list", "group.show", "group.add", "group.remove", "group.pause", "group.resume", "group.delete", "group.run",
    "queue.create", "queue.add", "queue.show", "queue.list", "queue.pause", "queue.resume", "queue.delete", "queue.update", "queue.remove", "queue.move", "queue.mode", "queue.run",
    "bookmark.add", "bookmark.list", "bookmark.get", "bookmark.delete", "bookmark.search",
    "token.create", "token.list", "token.revoke", "token.rotate",
    "files.list", "files.patches", "files.find", "files.rebuild",
  ]

  public static func normalizeDocument(_ command: String) -> String {
    let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("query") || trimmed.hasPrefix("mutation") || trimmed.hasPrefix("subscription") || trimmed.hasPrefix("{") {
      return trimmed
    }
    if supportedCommandNames.contains(trimmed) {
      return "query { \(trimmed) }"
    }
    return trimmed
  }

  public static func parseVariables(_ text: String?) throws -> JSONObject {
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return [:]
    }
    let data = Data(text.utf8)
    let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
    guard case let .object(object) = decoded else {
      throw CodexGraphQLError.variablesMustBeObject
    }
    return object
  }

  public static func parseParams(_ values: [String]) throws -> JSONObject {
    var params: JSONObject = [:]
    for value in values {
      let pieces = value.split(separator: "=", maxSplits: 1).map(String.init)
      guard pieces.count == 2 else {
        throw CodexGraphQLError.invalidParam(value)
      }
      params[pieces[0]] = try parseLooseJSONValue(pieces[1])
    }
    return params
  }

  public static func loadVariables(_ textOrPath: String?) throws -> JSONObject {
    guard let textOrPath else {
      return [:]
    }
    if textOrPath.hasPrefix("@") {
      let path = String(textOrPath.dropFirst())
      return try parseVariables(String(contentsOfFile: path, encoding: .utf8))
    }
    return try parseVariables(textOrPath)
  }

  public static func execute(command: String, variables: JSONObject = [:], context: CodexAgentCompatibilityContext = CodexAgentCompatibilityContext()) -> Result {
    let normalized = normalizeDocument(command)
    guard let commandName = extractCommandName(from: normalized) else {
      return Result(errors: ["Unable to extract command name"])
    }
    if normalized.hasPrefix("subscription"), commandName != "session.watch" {
      return Result(errors: ["Unsupported subscription command: \(commandName)"])
    }
    guard supportedCommandNames.contains(commandName) else {
      return Result(errors: ["Unknown command: \(commandName)"])
    }
    switch commandName {
    case "version.get":
      return Result(data: .object(["version": .string("swift")]))
    case "session.list":
      let sessions = CodexSessionCommands.list(codexHome: stringValue(variables["codexHome"]) ?? context.codexHome)
      return Result(data: .array(sessions.map { .object(["id": .string($0.id), "cwd": .string($0.cwd), "source": .string($0.source.rawValue)]) }))
    case "session.show":
      guard let id = stringValue(variables["id"]) else {
        return Result(errors: ["Missing required variable: id"])
      }
      if let session = CodexSessionCommands.show(sessionId: id, codexHome: stringValue(variables["codexHome"]) ?? context.codexHome) {
        return Result(data: .object(["id": .string(session.id), "cwd": .string(session.cwd), "source": .string(session.source.rawValue)]))
      }
      return Result(data: .null)
    case "session.run":
      let prompt = stringValue(variables["prompt"]) ?? ""
      let args = CodexSessionCommands.runArguments(prompt: prompt, options: processOptions(from: variables))
      return Result(data: .object(["arguments": .array(args.map(JSONValue.string))]))
    case "session.resume":
      guard let id = stringValue(variables["id"]) else {
        return Result(errors: ["Missing required variable: id"])
      }
      let args = CodexSessionCommands.resumeArguments(sessionId: id, prompt: stringValue(variables["prompt"]), options: processOptions(from: variables))
      return Result(data: .object(["arguments": .array(args.map(JSONValue.string))]))
    case "session.fork":
      guard let id = stringValue(variables["id"]) else {
        return Result(errors: ["Missing required variable: id"])
      }
      let nthMessage = intValue(variables["nthMessage"]) ?? 0
      let args = CodexProcessCommandBuilder.buildForkArguments(sessionId: id, nthMessage: nthMessage, options: processOptions(from: variables))
      return Result(data: .object(["arguments": .array(args.map(JSONValue.string))]))
    default:
      return Result(data: .object(["command": .string(commandName), "accepted": .bool(true)]))
    }
  }
}

public enum CodexGraphQLError: Error, Equatable {
  case variablesMustBeObject
  case invalidParam(String)
}

public enum CodexMarkdown {
  public struct Section: Equatable, Sendable {
    public var level: Int
    public var heading: String
    public var body: String
  }

  public struct Task: Equatable, Sendable {
    public var sectionHeading: String
    public var text: String
    public var checked: Bool
  }

  public static func parseTasks(_ markdown: String) -> [Task] {
    var heading = ""
    var tasks: [Task] = []
    for rawLine in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = String(rawLine)
      if line.hasPrefix("#") {
        heading = line.trimmingCharacters(in: CharacterSet(charactersIn: "# " ))
      } else if line.hasPrefix("- [ ] ") || line.hasPrefix("- [x] ") || line.hasPrefix("- [X] ") {
        let checked = line.hasPrefix("- [x] ") || line.hasPrefix("- [X] ")
        tasks.append(Task(sectionHeading: heading, text: String(line.dropFirst(6)), checked: checked))
      }
    }
    return tasks
  }

  public static func parseSections(_ markdown: String) -> [Section] {
    var sections: [Section] = []
    var currentLevel = 0
    var currentHeading = ""
    var body: [String] = []
    for rawLine in markdown.split(separator: "\n", omittingEmptySubsequences: false) {
      let line = String(rawLine)
      if let heading = parseHeading(line) {
        if !currentHeading.isEmpty || !body.isEmpty {
          sections.append(Section(level: currentLevel, heading: currentHeading, body: body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        currentLevel = heading.level
        currentHeading = heading.text
        body = []
      } else {
        body.append(line)
      }
    }
    if !currentHeading.isEmpty || !body.isEmpty {
      sections.append(Section(level: currentLevel, heading: currentHeading, body: body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)))
    }
    return sections
  }

  private static func parseHeading(_ line: String) -> (level: Int, text: String)? {
    let hashes = line.prefix { $0 == "#" }.count
    guard hashes > 0, hashes < line.count, line.dropFirst(hashes).first == " " else {
      return nil
    }
    return (hashes, line.dropFirst(hashes).trimmingCharacters(in: .whitespacesAndNewlines))
  }
}

public enum CodexFileChangeSource: String, Equatable, Sendable {
  case applyPatch = "apply_patch"
  case shell
  case execCommand = "exec_command"
  case localShell = "local_shell"
}

public enum CodexFileOperation: String, Equatable, Sendable {
  case created
  case modified
  case deleted
  case moved
}

public struct CodexFileChange: Equatable, Sendable {
  public var path: String
  public var operation: CodexFileOperation
  public var source: CodexFileChangeSource
  public var previousPath: String?

  public init(path: String, operation: CodexFileOperation, source: CodexFileChangeSource, previousPath: String? = nil) {
    self.path = path
    self.operation = operation
    self.source = source
    self.previousPath = previousPath
  }
}

public enum CodexFileChanges {
  public static func extract(from line: CodexRolloutLine) -> [CodexFileChange] {
    guard let payload = fileChangeObject(line.payload) else {
      return []
    }
    if let exitCode = numberValue(payload["exit_code"]), exitCode != 0 {
      return []
    }
    if let changes = fileChangeArray(payload["file_changes"]) {
      return changes
    }
    if let patch = fileChangeString(payload["patch"]) ?? fileChangeString(payload["aggregated_output"]) {
      var pendingUpdatePath: String?
      return patch.split(separator: "\n").compactMap { rawLine in
        let line = String(rawLine)
        if line.hasPrefix("*** Add File: ") {
          pendingUpdatePath = nil
          return CodexFileChange(path: String(line.dropFirst("*** Add File: ".count)), operation: .created, source: .applyPatch)
        }
        if line.hasPrefix("*** Delete File: ") {
          pendingUpdatePath = nil
          return CodexFileChange(path: String(line.dropFirst("*** Delete File: ".count)), operation: .deleted, source: .applyPatch)
        }
        if line.hasPrefix("*** Update File: ") {
          pendingUpdatePath = String(line.dropFirst("*** Update File: ".count))
          return CodexFileChange(path: pendingUpdatePath ?? "", operation: .modified, source: .applyPatch)
        }
        if line.hasPrefix("*** Move to: "), let from = pendingUpdatePath {
          let to = String(line.dropFirst("*** Move to: ".count))
          return CodexFileChange(path: to, operation: .moved, source: .applyPatch, previousPath: from)
        }
        return nil
      }
    }
    return []
  }
}

public struct CodexFileChangeIndex: Equatable, Sendable {
  private var changes: [CodexFileChange] = []

  public init(changes: [CodexFileChange] = []) {
    self.changes = changes
  }

  public static func rebuild(from lines: [CodexRolloutLine]) -> CodexFileChangeIndex {
    CodexFileChangeIndex(changes: lines.flatMap(CodexFileChanges.extract(from:)))
  }

  public func listChangedFiles() -> [String] {
    Array(Set(changes.flatMap { change in
      [change.path, change.previousPath].compactMap { $0 }
    })).sorted()
  }

  public func patches(for path: String) -> [CodexFileChange] {
    changes.filter { $0.path == path || $0.previousPath == path }
  }

  public func find(_ path: String) -> CodexFileChange? {
    patches(for: path).last
  }
}

private func fileChangeArray(_ value: JSONValue?) -> [CodexFileChange]? {
  guard case let .array(values) = value else {
    return nil
  }
  return values.compactMap { entry in
    guard let object = fileChangeObject(entry), let path = fileChangeString(object["path"]) else {
      return nil
    }
    return CodexFileChange(path: path, operation: CodexFileOperation(rawValue: fileChangeString(object["operation"]) ?? "") ?? .modified, source: CodexFileChangeSource(rawValue: fileChangeString(object["source"]) ?? "") ?? .shell)
  }
}

private func fileChangeObject(_ value: JSONValue?) -> JSONObject? {
  guard case let .object(object) = value else {
    return nil
  }
  return object
}

private func fileChangeString(_ value: JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}

private func numberValue(_ value: JSONValue?) -> Double? {
  guard case let .number(number) = value else {
    return nil
  }
  return number
}

private func intValue(_ value: JSONValue?) -> Int? {
  guard let number = numberValue(value) else {
    return nil
  }
  return Int(number)
}

private func stringValue(_ value: JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}

private func parseLooseJSONValue(_ text: String) throws -> JSONValue {
  if let data = text.data(using: .utf8), let value = try? JSONDecoder().decode(JSONValue.self, from: data) {
    return value
  }
  return .string(text)
}

private func processOptions(from object: JSONObject) -> CodexProcessOptions {
  CodexProcessOptions(
    model: stringValue(object["model"]),
    sandbox: stringValue(object["sandbox"]),
    fullAuto: boolValue(object["fullAuto"]) ?? false
  )
}

private func boolValue(_ value: JSONValue?) -> Bool? {
  guard case let .bool(value) = value else {
    return nil
  }
  return value
}

private func extractCommandName(from document: String) -> String? {
  let trimmed = document.trimmingCharacters(in: .whitespacesAndNewlines)
  if let open = trimmed.firstIndex(of: "{"), let close = trimmed.lastIndex(of: "}") {
    let inside = trimmed[trimmed.index(after: open)..<close]
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return inside.split(whereSeparator: { $0 == " " || $0 == "(" || $0 == "{" }).first.map(String.init)
  }
  if CodexGraphQLCommandExecutor.supportedCommandNames.contains(trimmed) || trimmed.contains(".") {
    return trimmed
  }
  return nil
}
