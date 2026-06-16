import Foundation
import RielflowCore

public struct CodexSession: Equatable, Sendable {
  public var id: String
  public var rolloutPath: String
  public var createdAt: Date
  public var updatedAt: Date
  public var source: CodexSessionSource
  public var modelProvider: String?
  public var cwd: String
  public var cliVersion: String
  public var title: String
  public var firstUserMessage: String?
  public var archivedAt: Date?
  public var git: CodexSessionGit?
  public var forkedFromId: String?

  public init(
    id: String,
    rolloutPath: String,
    createdAt: Date,
    updatedAt: Date,
    source: CodexSessionSource,
    modelProvider: String? = nil,
    cwd: String,
    cliVersion: String,
    title: String,
    firstUserMessage: String? = nil,
    archivedAt: Date? = nil,
    git: CodexSessionGit? = nil,
    forkedFromId: String? = nil
  ) {
    self.id = id
    self.rolloutPath = rolloutPath
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.source = source
    self.modelProvider = modelProvider
    self.cwd = cwd
    self.cliVersion = cliVersion
    self.title = title
    self.firstUserMessage = firstUserMessage
    self.archivedAt = archivedAt
    self.git = git
    self.forkedFromId = forkedFromId
  }
}

public struct CodexSessionListOptions: Equatable, Sendable {
  public var codexHome: String?
  public var source: CodexSessionSource?
  public var cwd: String?
  public var branch: String?
  public var limit: Int
  public var offset: Int
  public var sortBy: String
  public var sortOrder: String

  public init(
    codexHome: String? = nil,
    source: CodexSessionSource? = nil,
    cwd: String? = nil,
    branch: String? = nil,
    limit: Int = 50,
    offset: Int = 0,
    sortBy: String = "createdAt",
    sortOrder: String = "desc"
  ) {
    self.codexHome = codexHome
    self.source = source
    self.cwd = cwd
    self.branch = branch
    self.limit = limit
    self.offset = offset
    self.sortBy = sortBy
    self.sortOrder = sortOrder
  }
}

public struct CodexSessionListResult: Equatable, Sendable {
  public var sessions: [CodexSession]
  public var total: Int
  public var offset: Int
  public var limit: Int

  public init(sessions: [CodexSession], total: Int, offset: Int, limit: Int) {
    self.sessions = sessions
    self.total = total
    self.offset = offset
    self.limit = limit
  }
}

public struct CodexSessionTranscriptSearchOptions: Equatable, Sendable {
  public var caseSensitive: Bool
  public var role: String
  public var maxBytes: Int?
  public var maxEvents: Int?
  public var timeoutMs: Int?
  public var limit: Int
  public var offset: Int

  public init(
    caseSensitive: Bool = false,
    role: String = "both",
    maxBytes: Int? = nil,
    maxEvents: Int? = nil,
    timeoutMs: Int? = nil,
    limit: Int = 50,
    offset: Int = 0
  ) {
    self.caseSensitive = caseSensitive
    self.role = role
    self.maxBytes = maxBytes
    self.maxEvents = maxEvents
    self.timeoutMs = timeoutMs
    self.limit = limit
    self.offset = offset
  }
}

public struct CodexSessionsSearchResult: Equatable, Sendable {
  public var sessionIds: [String]
  public var total: Int
  public var scannedSessions: Int
  public var scannedBytes: Int
  public var scannedEvents: Int
  public var truncated: Bool
  public var timedOut: Bool

  public init(sessionIds: [String], total: Int, scannedSessions: Int, scannedBytes: Int, scannedEvents: Int, truncated: Bool, timedOut: Bool = false) {
    self.sessionIds = sessionIds
    self.total = total
    self.scannedSessions = scannedSessions
    self.scannedBytes = scannedBytes
    self.scannedEvents = scannedEvents
    self.truncated = truncated
    self.timedOut = timedOut
  }
}

public enum CodexActivityStatus: String, Equatable, Sendable {
  case idle
  case running
  case waitingApproval = "waiting_approval"
  case failed
}

public struct CodexActivityEntry: Equatable, Sendable {
  public var sessionId: String
  public var status: CodexActivityStatus
  public var updatedAt: String

  public init(sessionId: String, status: CodexActivityStatus, updatedAt: String) {
    self.sessionId = sessionId
    self.status = status
    self.updatedAt = updatedAt
  }
}

public enum CodexSessionIndex {
  public static func resolveCodexHome(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
    environment["CODEX_HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex").path
  }

  public static func discoverRolloutPaths(codexHome: String? = nil) -> [String] {
    let home = codexHome ?? resolveCodexHome()
    let sessionsDir = URL(fileURLWithPath: home, isDirectory: true).appendingPathComponent("sessions", isDirectory: true)
    var paths: [String] = []
    collectDateRollouts(root: sessionsDir, into: &paths)
    let archivedDir = URL(fileURLWithPath: home, isDirectory: true).appendingPathComponent("archived_sessions", isDirectory: true)
    paths.append(contentsOf: rolloutFiles(in: archivedDir))
    return paths
  }

  public static func buildSession(rolloutPath: String) -> CodexSession? {
    guard let meta = try? CodexRolloutReader.parseSessionMeta(path: rolloutPath) else {
      return nil
    }
    guard let createdAt = isoDate(meta.timestamp) else {
      return nil
    }
    let attributes = try? FileManager.default.attributesOfItem(atPath: rolloutPath)
    let updatedAt = attributes?[.modificationDate] as? Date ?? createdAt
    let firstUserMessage = try? CodexRolloutReader.extractFirstUserMessage(path: rolloutPath)
    let archivedAt = rolloutPath.contains("/archived_sessions/") ? updatedAt : nil
    return CodexSession(
      id: meta.id,
      rolloutPath: rolloutPath,
      createdAt: createdAt,
      updatedAt: updatedAt,
      source: meta.source,
      modelProvider: meta.modelProvider,
      cwd: meta.cwd,
      cliVersion: meta.cliVersion,
      title: firstUserMessage ?? meta.id,
      firstUserMessage: firstUserMessage,
      archivedAt: archivedAt,
      git: meta.git,
      forkedFromId: meta.forkedFromId
    )
  }

  public static func listSessions(options: CodexSessionListOptions = CodexSessionListOptions()) -> CodexSessionListResult {
    if let sqliteResult = CodexSessionSQLiteIndex.listSessionsSqlite(codexHome: options.codexHome, options: options) {
      return sqliteResult
    }
    var sessions = discoverRolloutPaths(codexHome: options.codexHome).compactMap(buildSession)
    sessions = sessions.filter { session in
      if let source = options.source, session.source != source {
        return false
      }
      if let cwd = options.cwd, URL(fileURLWithPath: session.cwd).standardizedFileURL.path != URL(fileURLWithPath: cwd).standardizedFileURL.path {
        return false
      }
      if let branch = options.branch, session.git?.branch != branch {
        return false
      }
      return true
    }
    sessions.sort { lhs, rhs in
      let left = options.sortBy == "updatedAt" ? lhs.updatedAt : lhs.createdAt
      let right = options.sortBy == "updatedAt" ? rhs.updatedAt : rhs.createdAt
      return options.sortOrder == "asc" ? left < right : left > right
    }
    let total = sessions.count
    let start = min(max(options.offset, 0), sessions.count)
    let end = min(start + max(options.limit, 0), sessions.count)
    return CodexSessionListResult(sessions: Array(sessions[start..<end]), total: total, offset: options.offset, limit: options.limit)
  }

  public static func findSession(id: String, codexHome: String? = nil) -> CodexSession? {
    if let session = CodexSessionSQLiteIndex.findSessionSqlite(id: id, codexHome: codexHome) {
      return session
    }
    for path in discoverRolloutPaths(codexHome: codexHome) where path.contains(id) {
      guard let session = buildSession(rolloutPath: path), session.id == id else {
        continue
      }
      return session
    }
    return nil
  }

  public static func findLatestSession(codexHome: String? = nil, cwd: String? = nil) -> CodexSession? {
    if let session = CodexSessionSQLiteIndex.findLatestSessionSqlite(codexHome: codexHome, cwd: cwd) {
      return session
    }
    for path in discoverRolloutPaths(codexHome: codexHome) {
      guard let session = buildSession(rolloutPath: path) else {
        continue
      }
      if let cwd, URL(fileURLWithPath: session.cwd).standardizedFileURL.path != URL(fileURLWithPath: cwd).standardizedFileURL.path {
        continue
      }
      return session
    }
    return nil
  }

  public static func searchSessionTranscript(session: CodexSession, query: String, options: CodexSessionTranscriptSearchOptions = CodexSessionTranscriptSearchOptions()) throws -> Bool {
    guard !query.isEmpty else {
      throw CodexSessionSearchError.emptyQuery
    }
    let messages = try CodexRolloutReader.getSessionMessages(path: session.rolloutPath)
    let needle = options.caseSensitive ? query : query.lowercased()
    for message in messages {
      if options.role != "both", message.role != options.role {
        continue
      }
      guard let text = message.text else {
        continue
      }
      let haystack = options.caseSensitive ? text : text.lowercased()
      if haystack.contains(needle) {
        return true
      }
    }
    return false
  }

  public static func searchSessions(query: String, options: CodexSessionListOptions = CodexSessionListOptions(), searchOptions: CodexSessionTranscriptSearchOptions = CodexSessionTranscriptSearchOptions()) throws -> CodexSessionsSearchResult {
    guard !query.isEmpty else {
      throw CodexSessionSearchError.emptyQuery
    }
    let startedAt = Date()
    let candidates = listSessions(options: CodexSessionListOptions(codexHome: options.codexHome, source: options.source, cwd: options.cwd, branch: options.branch, limit: Int.max, offset: 0, sortBy: options.sortBy, sortOrder: options.sortOrder)).sessions
    var matches: [String] = []
    var scannedBytes = 0
    var scannedEvents = 0
    var scannedSessions = 0
    var truncated = false
    var timedOut = false
    for session in candidates {
      if let timeoutMs = searchOptions.timeoutMs, Date().timeIntervalSince(startedAt) * 1000 >= Double(timeoutMs) {
        timedOut = true
        truncated = true
        break
      }
      let dataSize = (try? Data(contentsOf: URL(fileURLWithPath: session.rolloutPath)).count) ?? 0
      if let maxBytes = searchOptions.maxBytes, scannedBytes + dataSize > maxBytes {
        truncated = true
        break
      }
      scannedBytes += dataSize
      let messages = try CodexRolloutReader.getSessionMessages(path: session.rolloutPath)
      if let maxEvents = searchOptions.maxEvents, scannedEvents + messages.count > maxEvents {
        truncated = true
        break
      }
      scannedEvents += messages.count
      scannedSessions += 1
      if try searchSessionTranscript(session: session, query: query, options: searchOptions) {
        matches.append(session.id)
      }
    }
    let total = matches.count
    let start = min(searchOptions.offset, matches.count)
    let end = min(start + searchOptions.limit, matches.count)
    return CodexSessionsSearchResult(sessionIds: Array(matches[start..<end]), total: total, scannedSessions: scannedSessions, scannedBytes: scannedBytes, scannedEvents: scannedEvents, truncated: truncated, timedOut: timedOut)
  }

  public static func deriveActivityEntry(sessionId: String, lines: [CodexRolloutLine]) -> CodexActivityEntry {
    var status = CodexActivityStatus.idle
    var updatedAt = lines.last?.timestamp ?? ""
    for line in lines {
      updatedAt = line.timestamp
      guard let payload = jsonObject(line.payload), let type = jsonString(payload["type"]) else {
        continue
      }
      if type == "TurnStarted" || type == "ExecCommandBegin" {
        status = .running
      } else if type == "TurnComplete" || type == "ExecCommandEnd" {
        status = .idle
      } else if type == "Error" || type == "Aborted" {
        status = .failed
      } else if type == "PatchApplyApprovalRequest" || type == "ExecApprovalRequest" {
        status = .waitingApproval
      }
    }
    return CodexActivityEntry(sessionId: sessionId, status: status, updatedAt: updatedAt)
  }
}

public enum CodexSessionSearchError: Error, Equatable {
  case emptyQuery
}

public func resolveCodexHome(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
  CodexSessionIndex.resolveCodexHome(environment: environment)
}

public func discoverRolloutPaths(codexHome: String? = nil) -> [String] {
  CodexSessionIndex.discoverRolloutPaths(codexHome: codexHome)
}

public func buildSession(rolloutPath: String) -> CodexSession? {
  CodexSessionIndex.buildSession(rolloutPath: rolloutPath)
}

public func listSessions(options: CodexSessionListOptions = CodexSessionListOptions()) -> CodexSessionListResult {
  CodexSessionIndex.listSessions(options: options)
}

public func findSession(id: String, codexHome: String? = nil) -> CodexSession? {
  CodexSessionIndex.findSession(id: id, codexHome: codexHome)
}

public func findLatestSession(codexHome: String? = nil, cwd: String? = nil) -> CodexSession? {
  CodexSessionIndex.findLatestSession(codexHome: codexHome, cwd: cwd)
}

private func collectDateRollouts(root: URL, into paths: inout [String]) {
  for year in directoryNames(in: root).sorted(by: >) {
    let yearURL = root.appendingPathComponent(year, isDirectory: true)
    for month in directoryNames(in: yearURL).sorted(by: >) {
      let monthURL = yearURL.appendingPathComponent(month, isDirectory: true)
      for day in directoryNames(in: monthURL).sorted(by: >) {
        let dayURL = monthURL.appendingPathComponent(day, isDirectory: true)
        paths.append(contentsOf: rolloutFiles(in: dayURL))
      }
    }
  }
}

private func directoryNames(in url: URL) -> [String] {
  guard let entries = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else {
    return []
  }
  return entries.filter { ((try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false) }.map(\.lastPathComponent)
}

private func rolloutFiles(in url: URL) -> [String] {
  guard let entries = try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else {
    return []
  }
  return entries
    .filter { $0.lastPathComponent.hasPrefix("rollout-") && $0.lastPathComponent.hasSuffix(".jsonl") }
    .sorted { $0.lastPathComponent > $1.lastPathComponent }
    .map(\.path)
}

private func isoDate(_ text: String) -> Date? {
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractional.date(from: text) {
    return date
  }
  return ISO8601DateFormatter().date(from: text)
}

private func jsonString(_ value: RielflowCore.JSONValue?) -> String? {
  guard case let .string(text) = value else {
    return nil
  }
  return text
}

private func jsonObject(_ value: RielflowCore.JSONValue?) -> RielflowCore.JSONObject? {
  guard case let .object(object) = value else {
    return nil
  }
  return object
}
