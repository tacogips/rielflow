import Foundation

public enum CodexSessionSQLiteIndex {
  public static func statePath(codexHome: String? = nil) -> String {
    URL(fileURLWithPath: codexHome ?? resolveCodexHome(), isDirectory: true).appendingPathComponent("state").path
  }

  public static func openCodexDb(codexHome: String? = nil) -> String? {
    let path = statePath(codexHome: codexHome)
    guard FileManager.default.fileExists(atPath: path), sqliteQuery(dbPath: path, sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='threads' LIMIT 1;")?.contains("threads") == true else {
      return nil
    }
    return path
  }

  public static func listSessionsSqlite(codexHome: String? = nil, options: CodexSessionListOptions = CodexSessionListOptions()) -> CodexSessionListResult? {
    guard let dbPath = openCodexDb(codexHome: codexHome) else {
      return nil
    }
    let rows = selectRows(dbPath: dbPath)
    let sessions = rows.compactMap(rowToSession).filter { session in
      if let source = options.source, session.source != source {
        return false
      }
      if let cwd = options.cwd, session.cwd != cwd {
        return false
      }
      if let branch = options.branch, session.git?.branch != branch {
        return false
      }
      return true
    }.sorted { lhs, rhs in
      let left = options.sortBy == "updatedAt" ? lhs.updatedAt : lhs.createdAt
      let right = options.sortBy == "updatedAt" ? rhs.updatedAt : rhs.createdAt
      return options.sortOrder == "asc" ? left < right : left > right
    }
    let total = sessions.count
    let start = min(max(options.offset, 0), sessions.count)
    let end = min(start + max(options.limit, 0), sessions.count)
    return CodexSessionListResult(sessions: Array(sessions[start..<end]), total: total, offset: options.offset, limit: options.limit)
  }

  public static func findSessionSqlite(id: String, codexHome: String? = nil) -> CodexSession? {
    listSessionsSqlite(codexHome: codexHome, options: CodexSessionListOptions(codexHome: codexHome, limit: Int.max)).map(\.sessions)?.first { $0.id == id }
  }

  public static func findLatestSessionSqlite(codexHome: String? = nil, cwd: String? = nil) -> CodexSession? {
    listSessionsSqlite(codexHome: codexHome, options: CodexSessionListOptions(codexHome: codexHome, cwd: cwd, limit: 1, sortBy: "updatedAt")).map(\.sessions.first) ?? nil
  }

  private static func selectRows(dbPath: String) -> [[String: String]] {
    let columns = [
      "id", "rollout_path", "created_at", "updated_at", "source", "model_provider", "cwd",
      "cli_version", "title", "first_user_message", "archived_at", "git_sha", "git_branch",
      "git_origin_url",
    ]
    let separator = "|||rielflow-codex-sqlite|||"
    let sql = "SELECT \(columns.map { "ifnull(\($0),'')" }.joined(separator: " || '\(separator)' || ")) FROM threads;"
    guard let output = sqliteQuery(dbPath: dbPath, sql: sql) else {
      return []
    }
    return output.split(separator: "\n", omittingEmptySubsequences: true).map { line in
      let values = String(line).components(separatedBy: separator)
      return Dictionary(uniqueKeysWithValues: zip(columns, values))
    }
  }

  private static func rowToSession(_ row: [String: String]) -> CodexSession? {
    guard
      let id = nonEmpty(row["id"]),
      let rolloutPath = nonEmpty(row["rollout_path"]),
      let createdAt = nonEmpty(row["created_at"]).flatMap(sqliteDate),
      let updatedAt = nonEmpty(row["updated_at"]).flatMap(sqliteDate),
      let cwd = nonEmpty(row["cwd"])
    else {
      return nil
    }
    let git = [row["git_sha"], row["git_branch"], row["git_origin_url"]].contains { nonEmpty($0) != nil }
      ? CodexSessionGit(sha: nonEmpty(row["git_sha"]), branch: nonEmpty(row["git_branch"]), originURL: nonEmpty(row["git_origin_url"]))
      : nil
    return CodexSession(
      id: id,
      rolloutPath: rolloutPath,
      createdAt: createdAt,
      updatedAt: updatedAt,
      source: CodexSessionSource(rawValue: row["source"] ?? "") ?? .unknown,
      modelProvider: nonEmpty(row["model_provider"]),
      cwd: cwd,
      cliVersion: nonEmpty(row["cli_version"]) ?? "unknown",
      title: nonEmpty(row["title"]) ?? nonEmpty(row["first_user_message"]) ?? id,
      firstUserMessage: nonEmpty(row["first_user_message"]),
      archivedAt: nonEmpty(row["archived_at"]).flatMap(sqliteDate),
      git: git
    )
  }
}

private func sqliteQuery(dbPath: String, sql: String) -> String? {
  let process = Process()
  let output = Pipe()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
  process.arguments = ["-readonly", dbPath, sql]
  process.standardOutput = output
  process.standardError = Pipe()
  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    return nil
  }
  guard process.terminationStatus == 0 else {
    return nil
  }
  return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
}

private func nonEmpty(_ value: String?) -> String? {
  guard let value, !value.isEmpty else {
    return nil
  }
  return value
}

private func sqliteDate(_ text: String) -> Date? {
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return fractional.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}
