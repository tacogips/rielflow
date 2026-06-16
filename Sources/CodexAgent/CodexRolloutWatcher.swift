import Foundation

public enum CodexRolloutWatcherEvent: Equatable, Sendable {
  case line(path: String, line: CodexRolloutLine)
  case newSession(path: String)
  case error(path: String?, message: String)
}

public final class CodexRolloutWatcher: @unchecked Sendable {
  private let lock = NSLock()
  private var fileOffsets: [String: UInt64] = [:]
  private var sessionDirectories: Set<String> = []
  private var knownSessionFiles: Set<String> = []
  private var closed = false

  public init() {}

  public var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }

  public static func sessionsWatchDir(codexHome: String? = nil) -> String {
    URL(fileURLWithPath: codexHome ?? resolveCodexHome(), isDirectory: true).appendingPathComponent("sessions", isDirectory: true).path
  }

  public func watchFile(path: String, startOffset: UInt64? = nil) {
    lock.lock()
    defer { lock.unlock() }
    guard !closed, fileOffsets[path] == nil else {
      return
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? UInt64) ?? 0
    fileOffsets[path] = startOffset ?? size
  }

  public func watchSessionsDirectory(path: String) {
    lock.lock()
    defer { lock.unlock() }
    guard !closed else {
      return
    }
    sessionDirectories.insert(path)
    for rolloutPath in rolloutFilesRecursively(root: path) {
      knownSessionFiles.insert(rolloutPath)
    }
  }

  public func flush() -> [CodexRolloutWatcherEvent] {
    lock.lock()
    guard !closed else {
      lock.unlock()
      return []
    }
    let watchedFiles = fileOffsets
    let watchedDirectories = Array(sessionDirectories)
    lock.unlock()

    var events: [CodexRolloutWatcherEvent] = []
    for directory in watchedDirectories {
      for rolloutPath in rolloutFilesRecursively(root: directory) {
        lock.lock()
        let isNew = !knownSessionFiles.contains(rolloutPath)
        if isNew {
          knownSessionFiles.insert(rolloutPath)
        }
        lock.unlock()
        if isNew {
          events.append(.newSession(path: rolloutPath))
        }
      }
    }

    for (path, offset) in watchedFiles {
      let url = URL(fileURLWithPath: path)
      guard let data = try? Data(contentsOf: url) else {
        events.append(.error(path: path, message: "rollout file is not readable"))
        continue
      }
      guard UInt64(data.count) >= offset else {
        lock.lock()
        fileOffsets[path] = UInt64(data.count)
        lock.unlock()
        continue
      }
      let appended = data.dropFirst(Int(offset))
      if let text = String(data: appended, encoding: .utf8) {
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: true) {
          if let line = CodexRolloutReader.parseRolloutLine(String(rawLine)) {
            events.append(.line(path: path, line: line))
          }
        }
      }
      lock.lock()
      fileOffsets[path] = UInt64(data.count)
      lock.unlock()
    }
    return events
  }

  public func stop() {
    lock.lock()
    closed = true
    fileOffsets = [:]
    sessionDirectories = []
    knownSessionFiles = []
    lock.unlock()
  }
}

private func rolloutFilesRecursively(root: String) -> [String] {
  guard let enumerator = FileManager.default.enumerator(at: URL(fileURLWithPath: root, isDirectory: true), includingPropertiesForKeys: [.isRegularFileKey]) else {
    return []
  }
  return enumerator.compactMap { entry -> String? in
    guard let url = entry as? URL else {
      return nil
    }
    guard url.lastPathComponent.hasPrefix("rollout-"), url.lastPathComponent.hasSuffix(".jsonl") else {
      return nil
    }
    return url.path
  }.sorted()
}
