import CryptoKit
import Foundation

public enum CodexQueuePromptStatus: String, Equatable, Codable, Sendable {
  case pending
  case running
  case completed
  case failed
}

public struct CodexQueuePrompt: Equatable, Codable, Sendable {
  public var id: String
  public var prompt: String
  public var status: CodexQueuePromptStatus
  public var imagePaths: [String]
  public var resultExitCode: Int?
  public var createdAt: String?
  public var updatedAt: String?

  public init(id: String, prompt: String, status: CodexQueuePromptStatus = .pending, imagePaths: [String] = [], resultExitCode: Int? = nil, createdAt: String? = nil, updatedAt: String? = nil) {
    self.id = id
    self.prompt = prompt
    self.status = status
    self.imagePaths = imagePaths
    self.resultExitCode = resultExitCode
    self.createdAt = createdAt
    self.updatedAt = updatedAt
  }
}

public enum CodexQueueCommandMode: String, Equatable, Codable, Sendable {
  case auto
  case manual
}

public struct CodexQueue: Equatable, Sendable {
  public var id: String
  public var name: String
  public var projectPath: String?
  public var prompts: [CodexQueuePrompt]
  public var paused: Bool
  public var mode: CodexQueueCommandMode
  public var createdAt: String?

  public init(id: String, name: String, prompts: [CodexQueuePrompt], paused: Bool, mode: CodexQueueCommandMode = .auto, projectPath: String? = nil, createdAt: String? = nil) {
    self.id = id
    self.name = name
    self.projectPath = projectPath
    self.prompts = prompts
    self.paused = paused
    self.mode = mode
    self.createdAt = createdAt
  }
}

extension CodexQueue: Codable {}

public struct CodexQueueRepository: Equatable, Sendable {
  private var queues: [CodexQueue] = []

  public init() {}

  public mutating func createQueue(name: String, projectPath: String? = nil) -> CodexQueue {
    let queue = CodexQueue(id: UUID().uuidString, name: name, prompts: [], paused: false, projectPath: projectPath)
    queues.append(queue)
    return queue
  }

  public mutating func addPrompt(queueId: String, prompt: String, imagePaths: [String] = []) -> CodexQueuePrompt? {
    guard let index = queues.firstIndex(where: { $0.id == queueId }) else {
      return nil
    }
    let item = CodexQueuePrompt(id: UUID().uuidString, prompt: prompt, status: .pending, imagePaths: imagePaths)
    queues[index].prompts.append(item)
    return item
  }

  public mutating func updatePrompt(queueId: String, promptId: String, status: CodexQueuePromptStatus, resultExitCode: Int? = nil) -> Bool {
    guard let queueIndex = queues.firstIndex(where: { $0.id == queueId }), let promptIndex = queues[queueIndex].prompts.firstIndex(where: { $0.id == promptId }) else {
      return false
    }
    queues[queueIndex].prompts[promptIndex].status = status
    queues[queueIndex].prompts[promptIndex].resultExitCode = resultExitCode
    return true
  }

  public mutating func movePrompt(queueId: String, promptId: String, toIndex: Int) -> Bool {
    guard let queueIndex = queues.firstIndex(where: { $0.id == queueId }), let promptIndex = queues[queueIndex].prompts.firstIndex(where: { $0.id == promptId }) else {
      return false
    }
    let item = queues[queueIndex].prompts.remove(at: promptIndex)
    let boundedIndex = max(0, min(toIndex, queues[queueIndex].prompts.count))
    queues[queueIndex].prompts.insert(item, at: boundedIndex)
    return true
  }

  public mutating func setMode(queueId: String, mode: CodexQueueCommandMode) -> Bool {
    guard let queueIndex = queues.firstIndex(where: { $0.id == queueId }) else {
      return false
    }
    queues[queueIndex].mode = mode
    return true
  }

  public mutating func removePrompt(queueId: String, promptId: String) -> Bool {
    guard let queueIndex = queues.firstIndex(where: { $0.id == queueId }), let promptIndex = queues[queueIndex].prompts.firstIndex(where: { $0.id == promptId }) else {
      return false
    }
    queues[queueIndex].prompts.remove(at: promptIndex)
    return true
  }

  public mutating func pauseQueue(id: String) -> Bool {
    setPaused(id: id, paused: true)
  }

  public mutating func resumeQueue(id: String) -> Bool {
    setPaused(id: id, paused: false)
  }

  public mutating func deleteQueue(id: String) -> Bool {
    guard let index = queues.firstIndex(where: { $0.id == id }) else {
      return false
    }
    queues.remove(at: index)
    return true
  }

  public func listQueues() -> [CodexQueue] {
    queues
  }

  public func getQueue(id: String) -> CodexQueue? {
    queues.first { $0.id == id }
  }

  public func findQueue(_ idOrName: String) -> CodexQueue? {
    queues.first { $0.id == idOrName || $0.name == idOrName }
  }

  public mutating func replaceQueues(_ queues: [CodexQueue]) {
    self.queues = queues
  }

  @discardableResult
  public mutating func runQueue(id: String, runner: (CodexQueuePrompt) throws -> Int) rethrows -> [CodexQueuePrompt] {
    guard let queueIndex = queues.firstIndex(where: { $0.id == id }), !queues[queueIndex].paused else {
      return []
    }
    var completed: [CodexQueuePrompt] = []
    for promptIndex in queues[queueIndex].prompts.indices where queues[queueIndex].prompts[promptIndex].status == .pending {
      queues[queueIndex].prompts[promptIndex].status = .running
      let exitCode = try runner(queues[queueIndex].prompts[promptIndex])
      queues[queueIndex].prompts[promptIndex].resultExitCode = exitCode
      queues[queueIndex].prompts[promptIndex].status = exitCode == 0 ? .completed : .failed
      completed.append(queues[queueIndex].prompts[promptIndex])
      if queues[queueIndex].mode == .manual {
        break
      }
    }
    return completed
  }

  private mutating func setPaused(id: String, paused: Bool) -> Bool {
    guard let index = queues.firstIndex(where: { $0.id == id }) else {
      return false
    }
    queues[index].paused = paused
    return true
  }
}

public struct CodexQueuesConfig: Equatable, Codable, Sendable {
  public var queues: [CodexQueue]

  public init(queues: [CodexQueue] = []) {
    self.queues = queues
  }
}

public enum CodexQueuePersistence {
  public static func url(configDir: String) -> URL {
    URL(fileURLWithPath: configDir, isDirectory: true).appendingPathComponent("queues.json")
  }

  public static func load(configDir: String) throws -> CodexQueuesConfig {
    try CodexJSONStore<CodexQueuesConfig>(url: url(configDir: configDir)).load(default: CodexQueuesConfig())
  }

  public static func save(_ config: CodexQueuesConfig, configDir: String) throws {
    try CodexJSONStore<CodexQueuesConfig>(url: url(configDir: configDir)).save(config)
  }

  public static func createQueue(name: String, projectPath: String, configDir: String) throws -> CodexQueue {
    var config = try load(configDir: configDir)
    var repository = CodexQueueRepository()
    repository.replaceQueues(config.queues)
    let queue = repository.createQueue(name: name, projectPath: projectPath)
    config.queues = repository.listQueues()
    try save(config, configDir: configDir)
    return queue
  }

  public static func listQueues(configDir: String) throws -> [CodexQueue] {
    try load(configDir: configDir).queues
  }

  public static func findQueue(_ idOrName: String, configDir: String) throws -> CodexQueue? {
    var repository = CodexQueueRepository()
    repository.replaceQueues(try load(configDir: configDir).queues)
    return repository.findQueue(idOrName)
  }

  public static func addPrompt(queueId: String, prompt: String, imagePaths: [String] = [], configDir: String) throws -> CodexQueuePrompt? {
    var config = try load(configDir: configDir)
    var repository = CodexQueueRepository()
    repository.replaceQueues(config.queues)
    let item = repository.addPrompt(queueId: queueId, prompt: prompt, imagePaths: imagePaths)
    config.queues = repository.listQueues()
    try save(config, configDir: configDir)
    return item
  }

  public static func removeQueue(_ id: String, configDir: String) throws -> Bool {
    var config = try load(configDir: configDir)
    var repository = CodexQueueRepository()
    repository.replaceQueues(config.queues)
    let removed = repository.deleteQueue(id: id)
    config.queues = repository.listQueues()
    try save(config, configDir: configDir)
    return removed
  }

  public static func updateQueuePrompts(queueId: String, prompts: [CodexQueuePrompt], configDir: String) throws -> Bool {
    var config = try load(configDir: configDir)
    guard let index = config.queues.firstIndex(where: { $0.id == queueId }) else {
      return false
    }
    config.queues[index].prompts = prompts
    try save(config, configDir: configDir)
    return true
  }
}

public struct CodexGroup: Equatable, Codable, Sendable {
  public var id: String
  public var name: String
  public var sessionIds: [String]
  public var paused: Bool
}

public struct CodexGroupRepository: Equatable, Sendable {
  private var groups: [CodexGroup] = []

  public init() {}

  public mutating func createGroup(name: String) -> CodexGroup {
    let group = CodexGroup(id: UUID().uuidString, name: name, sessionIds: [], paused: false)
    groups.append(group)
    return group
  }

  public mutating func addSession(groupId: String, sessionId: String) -> Bool {
    guard let index = groups.firstIndex(where: { $0.id == groupId }) else {
      return false
    }
    if !groups[index].sessionIds.contains(sessionId) {
      groups[index].sessionIds.append(sessionId)
    }
    return true
  }

  public mutating func removeSession(groupId: String, sessionId: String) -> Bool {
    guard let groupIndex = groups.firstIndex(where: { $0.id == groupId }), let sessionIndex = groups[groupIndex].sessionIds.firstIndex(of: sessionId) else {
      return false
    }
    groups[groupIndex].sessionIds.remove(at: sessionIndex)
    return true
  }

  public mutating func pauseGroup(id: String) -> Bool {
    setPaused(id: id, paused: true)
  }

  public mutating func resumeGroup(id: String) -> Bool {
    setPaused(id: id, paused: false)
  }

  public mutating func deleteGroup(id: String) -> Bool {
    guard let index = groups.firstIndex(where: { $0.id == id }) else {
      return false
    }
    groups.remove(at: index)
    return true
  }

  public func listGroups() -> [CodexGroup] {
    groups
  }

  public func getGroup(id: String) -> CodexGroup? {
    groups.first { $0.id == id }
  }

  public func findGroup(_ idOrName: String) -> CodexGroup? {
    groups.first { $0.id == idOrName || $0.name == idOrName }
  }

  public mutating func replaceGroups(_ groups: [CodexGroup]) {
    self.groups = groups
  }

  public func runGroup(id: String, maxConcurrent: Int = 1, runner: (String) throws -> Int) rethrows -> [(sessionId: String, exitCode: Int)] {
    guard let group = groups.first(where: { $0.id == id }), !group.paused else {
      return []
    }
    let limit = max(1, maxConcurrent)
    var results: [(sessionId: String, exitCode: Int)] = []
    for sessionId in group.sessionIds.prefix(limit) {
      results.append((sessionId, try runner(sessionId)))
    }
    return results
  }

  private mutating func setPaused(id: String, paused: Bool) -> Bool {
    guard let index = groups.firstIndex(where: { $0.id == id }) else {
      return false
    }
    groups[index].paused = paused
    return true
  }
}

public enum CodexBookmarkType: String, Equatable, Codable, Sendable {
  case session
  case message
  case range
}

public struct CodexBookmark: Equatable, Codable, Sendable {
  public var id: String
  public var type: CodexBookmarkType
  public var sessionId: String
  public var messageId: String?
  public var text: String?
  public var name: String?
  public var description: String?
  public var tags: [String]
  public var startLine: Int?
  public var endLine: Int?
  public var fromMessageId: String?
  public var toMessageId: String?

  public init(id: String, type: CodexBookmarkType, sessionId: String, messageId: String? = nil, text: String? = nil, name: String? = nil, description: String? = nil, tags: [String] = [], startLine: Int? = nil, endLine: Int? = nil, fromMessageId: String? = nil, toMessageId: String? = nil) {
    self.id = id
    self.type = type
    self.sessionId = sessionId
    self.messageId = messageId
    self.text = text
    self.name = name
    self.description = description
    self.tags = tags
    self.startLine = startLine
    self.endLine = endLine
    self.fromMessageId = fromMessageId
    self.toMessageId = toMessageId
  }
}

public struct CodexBookmarkManager: Equatable, Sendable {
  private var bookmarks: [CodexBookmark] = []

  public init() {}

  public mutating func create(type: CodexBookmarkType, sessionId: String, messageId: String? = nil, text: String? = nil, name: String? = nil, description: String? = nil, tags: [String] = [], startLine: Int? = nil, endLine: Int? = nil, fromMessageId: String? = nil, toMessageId: String? = nil) throws -> CodexBookmark {
    if type == .session, messageId != nil {
      throw CodexOperationalError.invalidBookmark
    }
    if type == .message, messageId == nil {
      throw CodexOperationalError.invalidBookmark
    }
    if type == .range, (fromMessageId == nil) != (toMessageId == nil) {
      throw CodexOperationalError.invalidBookmark
    }
    if type == .range, startLine != nil, endLine != nil, (startLine ?? 0) > (endLine ?? 0) {
      throw CodexOperationalError.invalidBookmark
    }
    let normalizedTags = Array(Set(tags.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })).sorted()
    let bookmark = CodexBookmark(id: UUID().uuidString, type: type, sessionId: sessionId, messageId: messageId, text: text, name: name, description: description, tags: normalizedTags, startLine: startLine, endLine: endLine, fromMessageId: fromMessageId, toMessageId: toMessageId)
    bookmarks.append(bookmark)
    return bookmark
  }

  public func get(id: String) -> CodexBookmark? {
    bookmarks.first { $0.id == id }
  }

  public func list(sessionId: String? = nil, tag: String? = nil) -> [CodexBookmark] {
    bookmarks.filter { bookmark in
      (sessionId == nil || bookmark.sessionId == sessionId) && (tag == nil || bookmark.tags.contains(tag?.lowercased() ?? ""))
    }
  }

  public func list(sessionId: String? = nil, type: CodexBookmarkType? = nil, tag: String? = nil) -> [CodexBookmark] {
    bookmarks.filter { bookmark in
      (sessionId == nil || bookmark.sessionId == sessionId) && (type == nil || bookmark.type == type) && (tag == nil || bookmark.tags.contains(tag?.lowercased() ?? ""))
    }
  }

  public func search(text: String) -> [CodexBookmark] {
    let needle = text.lowercased()
    return bookmarks.filter { bookmark in
      bookmark.text?.lowercased().contains(needle) == true
        || bookmark.name?.lowercased().contains(needle) == true
        || bookmark.description?.lowercased().contains(needle) == true
        || bookmark.tags.contains { $0.contains(needle) }
    }
  }

  public mutating func delete(id: String) -> Bool {
    guard let index = bookmarks.firstIndex(where: { $0.id == id }) else {
      return false
    }
    bookmarks.remove(at: index)
    return true
  }

  public mutating func replaceBookmarks(_ bookmarks: [CodexBookmark]) {
    self.bookmarks = bookmarks
  }
}

public struct CodexBookmarksConfig: Equatable, Codable, Sendable {
  public var bookmarks: [CodexBookmark]

  public init(bookmarks: [CodexBookmark] = []) {
    self.bookmarks = bookmarks
  }
}

public enum CodexBookmarkPersistence {
  public static func url(configDir: String) -> URL {
    URL(fileURLWithPath: configDir, isDirectory: true).appendingPathComponent("bookmarks.json")
  }

  public static func load(configDir: String) throws -> CodexBookmarksConfig {
    try CodexJSONStore<CodexBookmarksConfig>(url: url(configDir: configDir)).load(default: CodexBookmarksConfig())
  }

  public static func save(_ config: CodexBookmarksConfig, configDir: String) throws {
    try CodexJSONStore<CodexBookmarksConfig>(url: url(configDir: configDir)).save(config)
  }

  public static func addBookmark(type: CodexBookmarkType, sessionId: String, messageId: String? = nil, name: String? = nil, description: String? = nil, tags: [String] = [], fromMessageId: String? = nil, toMessageId: String? = nil, configDir: String) throws -> CodexBookmark {
    var config = try load(configDir: configDir)
    var manager = CodexBookmarkManager()
    manager.replaceBookmarks(config.bookmarks)
    let bookmark = try manager.create(type: type, sessionId: sessionId, messageId: messageId, text: description, name: name, description: description, tags: tags, fromMessageId: fromMessageId, toMessageId: toMessageId)
    config.bookmarks = manager.list()
    try save(config, configDir: configDir)
    return bookmark
  }

  public static func getBookmark(id: String, configDir: String) throws -> CodexBookmark? {
    try load(configDir: configDir).bookmarks.first { $0.id == id }
  }

  public static func listBookmarks(sessionId: String? = nil, type: CodexBookmarkType? = nil, tag: String? = nil, configDir: String) throws -> [CodexBookmark] {
    var manager = CodexBookmarkManager()
    manager.replaceBookmarks(try load(configDir: configDir).bookmarks)
    return manager.list(sessionId: sessionId, type: type, tag: tag)
  }

  public static func searchBookmarks(_ text: String, configDir: String) throws -> [CodexBookmark] {
    var manager = CodexBookmarkManager()
    manager.replaceBookmarks(try load(configDir: configDir).bookmarks)
    return manager.search(text: text)
  }

  public static func deleteBookmark(id: String, configDir: String) throws -> Bool {
    var config = try load(configDir: configDir)
    var manager = CodexBookmarkManager()
    manager.replaceBookmarks(config.bookmarks)
    let deleted = manager.delete(id: id)
    config.bookmarks = manager.list()
    try save(config, configDir: configDir)
    return deleted
  }
}

public struct CodexTokenMetadata: Equatable, Codable, Sendable {
  public var id: String
  public var permissions: [String]
  public var revoked: Bool
}

private struct CodexTokenRecord: Equatable, Codable, Sendable {
  var secretHash: String
  var metadata: CodexTokenMetadata
}

public struct CodexTokenManager: Sendable {
  private var tokens: [String: CodexTokenRecord] = [:]

  public init() {}

  public mutating func create(permissions: [String] = ["session:create", "session:read"]) -> (secret: String, metadata: CodexTokenMetadata) {
    let secret = UUID().uuidString
    let metadata = CodexTokenMetadata(id: UUID().uuidString, permissions: Self.normalizePermissions(permissions), revoked: false)
    tokens[metadata.id] = CodexTokenRecord(secretHash: hashSecret(secret), metadata: metadata)
    return (secret, metadata)
  }

  public func verify(id: String, secret: String, permission: String) -> Bool {
    guard let stored = tokens[id], !stored.metadata.revoked else {
      return false
    }
    return stored.secretHash == hashSecret(secret) && permits(stored.metadata.permissions, permission: permission)
  }

  public func listMetadata() -> [CodexTokenMetadata] {
    tokens.values.map(\.metadata).sorted { $0.id < $1.id }
  }

  public static func parsePermissionsCSV(_ text: String) -> [String] {
    normalizePermissions(text.split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty })
  }

  public mutating func revoke(id: String) -> Bool {
    guard var stored = tokens[id] else {
      return false
    }
    stored.metadata.revoked = true
    tokens[id] = stored
    return true
  }

  public mutating func rotate(id: String) -> String? {
    guard var stored = tokens[id], !stored.metadata.revoked else {
      return nil
    }
    let secret = UUID().uuidString
    stored.secretHash = hashSecret(secret)
    tokens[id] = stored
    return secret
  }

  private static func normalizePermissions(_ permissions: [String]) -> [String] {
    var seen: Set<String> = []
    var normalized: [String] = []
    for permission in permissions.map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) }).filter({ !$0.isEmpty }) where !seen.contains(permission) {
      seen.insert(permission)
      normalized.append(permission)
    }
    return normalized
  }

  private func hashSecret(_ secret: String) -> String {
    SHA256.hash(data: Data(secret.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func permits(_ permissions: [String], permission: String) -> Bool {
    permissions.contains(permission) || permissions.contains("*") || permissions.contains(permission.split(separator: ":").first.map { "\($0):*" } ?? "")
  }
}

public struct CodexJSONStore<Value: Codable & Sendable>: Sendable {
  public var url: URL

  public init(url: URL) {
    self.url = url
  }

  public func load(default defaultValue: Value) throws -> Value {
    guard FileManager.default.fileExists(atPath: url.path) else {
      return defaultValue
    }
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(Value.self, from: data)
  }

  public func save(_ value: Value) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(value).write(to: url, options: [.atomic])
  }
}

public enum CodexSessionCommands {
  public static func list(codexHome: String? = nil) -> [CodexSession] {
    listSessions(options: CodexSessionListOptions(codexHome: codexHome)).sessions
  }

  public static func show(sessionId: String, codexHome: String? = nil) -> CodexSession? {
    findSession(id: sessionId, codexHome: codexHome)
  }

  public static func search(query: String, codexHome: String? = nil) throws -> CodexSessionsSearchResult {
    try CodexSessionIndex.searchSessions(query: query, options: CodexSessionListOptions(codexHome: codexHome))
  }

  public static func runArguments(prompt: String, options: CodexProcessOptions = CodexProcessOptions()) -> [String] {
    CodexProcessCommandBuilder.buildExecArguments(prompt: prompt, options: options)
  }

  public static func resumeArguments(sessionId: String, prompt: String? = nil, options: CodexProcessOptions = CodexProcessOptions()) -> [String] {
    CodexProcessCommandBuilder.buildResumeArguments(sessionId: sessionId, prompt: prompt, options: options)
  }
}

public enum CodexOperationalError: Error, Equatable {
  case invalidBookmark
}
