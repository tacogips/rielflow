import Foundation
import XCTest
@testable import CodexAgent
@testable import RielflowCore

final class CodexAgentCompatibilityTests: XCTestCase {
  func testParseRolloutLineNormalizesReferenceRolloutAndExecEvents() throws {
    let sessionMeta = parseRolloutLine(
      """
      {"timestamp":"2025-05-07T17:24:21.123Z","type":"session_meta","payload":{"meta":{"id":"session-1","timestamp":"2025-05-07T17:24:21.123Z","cwd":"/tmp/project","originator":"codex-cli","cli_version":"0.1.0","source":"cli","model_provider":"openai"},"git":{"sha":"abc123","branch":"main","origin_url":"https://example.test/repo.git"}}}
      """
    )
    XCTAssertEqual(sessionMeta?.type, "session_meta")
    XCTAssertEqual(sessionMeta?.provenance?.origin, .frameworkEvent)

    let execStarted = parseRolloutLine(#"{"type":"thread.started","thread_id":"exec-thread-1"}"#)
    XCTAssertEqual(execStarted?.type, "session_meta")
    XCTAssertEqual(CodexRolloutReader.parseSessionMeta(from: try XCTUnwrap(execStarted))?.source, .exec)

    let execMessage = parseRolloutLine(#"{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"hello from exec stream"}}"#)
    XCTAssertEqual(execMessage?.type, "event_msg")
    XCTAssertEqual(execMessage?.provenance?.role, "assistant")

    XCTAssertNil(parseRolloutLine(""))
    XCTAssertNil(parseRolloutLine(#"{"type":"unknown"}"#))
  }

  func testReadRolloutSessionMessagesAndSystemInjectedFiltering() throws {
    let root = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: root)
    }
    let rollout = root.appendingPathComponent("rollout-test.jsonl")
    try [
      #"{"timestamp":"2025-05-07T17:24:21.123Z","type":"session_meta","payload":{"meta":{"id":"session-1","timestamp":"2025-05-07T17:24:21.123Z","cwd":"/tmp/project","cli_version":"0.1.0","source":"cli"}}}"#,
      "{\"timestamp\":\"2025-05-07T17:24:22.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"UserMessage\",\"message\":\"# AGENTS.md instructions for /tmp/project\"}}",
      #"{"timestamp":"2025-05-07T17:24:23.000Z","type":"event_msg","payload":{"type":"UserMessage","message":"Fix the auth bug"}}"#,
      #"{"timestamp":"2025-05-07T17:24:24.000Z","type":"event_msg","payload":{"type":"AgentMessage","message":"I will fix it."}}"#,
      #"{"timestamp":"2025-05-07T17:24:25.000Z","type":"response_item","payload":{"type":"function_call","name":"read_file","arguments":"{\"path\":\"README.md\"}","call_id":"call-1"}}"#,
      #"{"timestamp":"2025-05-07T17:24:26.000Z","type":"event_msg","payload":{"type":"ExecCommandEnd","command":["echo","hello"],"exit_code":0,"aggregated_output":"hello\n"}}"#,
    ].joined(separator: "\n").write(to: rollout, atomically: true, encoding: .utf8)

    XCTAssertEqual(try extractFirstUserMessage(path: rollout.path), "Fix the auth bug")
    let allMessages = try getSessionMessages(path: rollout.path)
    XCTAssertEqual(allMessages.count, 5)
    XCTAssertTrue(allMessages.contains { $0.category == .assistantToolResponse })
    XCTAssertTrue(allMessages.contains { $0.category == .toolUserResponse && $0.text == "hello\n" })

    let filtered = try getSessionMessages(path: rollout.path, options: CodexSessionMessageOptions(excludeToolRelated: true, excludeSystemInjected: true))
    XCTAssertEqual(filtered.map(\.text), ["Fix the auth bug", "I will fix it."])
  }

  func testSessionIndexListsFiltersFindsLatestAndSearchesTranscripts() throws {
    let home = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: home)
    }
    let day1 = home.appendingPathComponent("sessions/2025/05/07", isDirectory: true)
    let day2 = home.appendingPathComponent("sessions/2025/05/08", isDirectory: true)
    try FileManager.default.createDirectory(at: day1, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: day2, withIntermediateDirectories: true)
    let session1 = "aaaa0000-0000-0000-0000-000000000001"
    let session2 = "bbbb0000-0000-0000-0000-000000000002"
    let session3 = "cccc0000-0000-0000-0000-000000000003"
    try writeRollout(day1.appendingPathComponent("rollout-2025-05-07T17-24-21-\(session1).jsonl"), id: session1, cwd: "/tmp/project-a", source: "cli", branch: "main", message: "Fix bug in auth")
    try writeRollout(day1.appendingPathComponent("rollout-2025-05-07T18-00-00-\(session2).jsonl"), id: session2, cwd: "/tmp/project-b", source: "vscode", branch: "develop", message: "Add tests")
    try writeRollout(day2.appendingPathComponent("rollout-2025-05-08T10-00-00-\(session3).jsonl"), id: session3, cwd: "/tmp/project-a", source: "exec", branch: nil, message: "日本語 transcript")

    let paths = discoverRolloutPaths(codexHome: home.path)
    XCTAssertEqual(paths.count, 3)
    XCTAssertTrue(paths[0].contains(session3))

    let all = listSessions(options: CodexSessionListOptions(codexHome: home.path))
    XCTAssertEqual(all.total, 3)
    XCTAssertEqual(listSessions(options: CodexSessionListOptions(codexHome: home.path, source: .cli)).sessions.map(\.id), [session1])
    XCTAssertEqual(listSessions(options: CodexSessionListOptions(codexHome: home.path, branch: "develop")).sessions.map(\.id), [session2])
    XCTAssertEqual(findSession(id: session2, codexHome: home.path)?.source, .vscode)
    XCTAssertEqual(findLatestSession(codexHome: home.path, cwd: "/tmp/project-a")?.id, session3)

    let search = try CodexSessionIndex.searchSessions(query: "日本語", options: CodexSessionListOptions(codexHome: home.path))
    XCTAssertEqual(search.sessionIds, [session3])

    let truncated = try CodexSessionIndex.searchSessions(
      query: "auth",
      options: CodexSessionListOptions(codexHome: home.path),
      searchOptions: CodexSessionTranscriptSearchOptions(maxEvents: 1)
    )
    XCTAssertEqual(truncated.scannedSessions, 1)
    XCTAssertTrue(truncated.truncated)

    let timedOut = try CodexSessionIndex.searchSessions(
      query: "auth",
      options: CodexSessionListOptions(codexHome: home.path),
      searchOptions: CodexSessionTranscriptSearchOptions(timeoutMs: 0)
    )
    XCTAssertTrue(timedOut.timedOut)
  }

  func testRolloutWatcherAndSQLiteSessionIndexFallbackContracts() throws {
    let home = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: home)
    }
    let rollout = home.appendingPathComponent("sessions/2025/05/07/rollout-2025-05-07T17-24-21-session-watch.jsonl")
    try FileManager.default.createDirectory(at: rollout.deletingLastPathComponent(), withIntermediateDirectories: true)
    try "".write(to: rollout, atomically: true, encoding: .utf8)

    let watcher = CodexRolloutWatcher()
    watcher.watchFile(path: rollout.path)
    try #"{"timestamp":"2025-05-07T17:24:23.000Z","type":"event_msg","payload":{"type":"UserMessage","message":"hello"}}"#.appendLine(to: rollout)
    let events = watcher.flush()
    XCTAssertEqual(events.count, 1)
    if case let .line(path, line) = try XCTUnwrap(events.first) {
      XCTAssertEqual(path, rollout.path)
      XCTAssertEqual(line.type, "event_msg")
    } else {
      XCTFail("expected appended line event")
    }
    watcher.stop()
    XCTAssertTrue(watcher.isClosed)
    XCTAssertTrue(CodexRolloutWatcher.sessionsWatchDir(codexHome: home.path).hasSuffix("/sessions"))

    let state = home.appendingPathComponent("state")
    try runSQLite(state.path, "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT NOT NULL, model_provider TEXT, cwd TEXT NOT NULL, cli_version TEXT NOT NULL, title TEXT, first_user_message TEXT, archived_at TEXT, git_sha TEXT, git_branch TEXT, git_origin_url TEXT);")
    try runSQLite(state.path, "INSERT INTO threads VALUES ('sqlite-session','/tmp/rollout.jsonl','2026-02-20T10:00:00Z','2026-02-20T10:05:00Z','cli','openai','/tmp/project','1.0.0','SQLite title','Hello',NULL,'abc','main','https://example.test/repo.git');")

    XCTAssertEqual(CodexSessionSQLiteIndex.openCodexDb(codexHome: home.path), state.path)
    let sqliteSessions = try XCTUnwrap(CodexSessionSQLiteIndex.listSessionsSqlite(codexHome: home.path))
    XCTAssertEqual(sqliteSessions.sessions.map(\.id), ["sqlite-session"])
    XCTAssertEqual(findSession(id: "sqlite-session", codexHome: home.path)?.git?.branch, "main")
  }

  func testProcessManagerRunAgentAndOperationalStores() throws {
    let manager = CodexProcessManager(executableName: "codex-dev") { arguments, _, environment in
      XCTAssertEqual(arguments.prefix(3), ["codex-dev", "exec", "--json"])
      XCTAssertEqual(environment["CODEX_TEST"], "1")
      return CodexProcessExecution(
        stdout: #"{"timestamp":"2025-05-07T17:24:23.000Z","type":"event_msg","payload":{"type":"AgentMessage","message":"done"}}"#,
        exitCode: 0
      )
    }
    let streamed = manager.spawnExecStream(prompt: "hello", options: CodexProcessOptions(environmentVariables: ["CODEX_TEST": "1"]))
    XCTAssertEqual(streamed.completionExitCode, 0)
    XCTAssertEqual(streamed.lines.first?.type, "event_msg")
    XCTAssertEqual(manager.list().first?.status, .exited)
    XCTAssertFalse(manager.kill(id: streamed.process.id))

    let rawLine = CodexRolloutLine(timestamp: "2025-05-07T17:24:23.000Z", type: "event_msg", payload: .object(["type": .string("AgentMessage"), "message": .string("hello")]))
    let runner = createMockCodexSessionRunner(startSessions: [MockCodexRunningSession(sessionId: "session-sdk", messages: [rawLine])])
    let events = try CodexAgentSDK.runAgent(request: CodexAgentSDK.Request(prompt: "hello", streamMode: .normalized), runner: runner)
    XCTAssertTrue(events.contains { $0.type == "assistant.snapshot" })

    var queues = CodexQueueRepository()
    let queue = queues.createQueue(name: "work")
    let prompt = try XCTUnwrap(queues.addPrompt(queueId: queue.id, prompt: "ship", imagePaths: ["/tmp/a.png"]))
    XCTAssertTrue(queues.updatePrompt(queueId: queue.id, promptId: prompt.id, status: .completed))
    XCTAssertEqual(queues.listQueues().first?.prompts.first?.status, .completed)

    var groups = CodexGroupRepository()
    let group = groups.createGroup(name: "batch")
    XCTAssertTrue(groups.addSession(groupId: group.id, sessionId: "session-sdk"))
    XCTAssertEqual(groups.listGroups().first?.sessionIds, ["session-sdk"])

    var bookmarks = CodexBookmarkManager()
    let bookmark = try bookmarks.create(type: .message, sessionId: "session-sdk", messageId: "message-1", text: "important", tags: ["Review"])
    XCTAssertEqual(bookmarks.list(tag: "review"), [bookmark])

    var tokens = CodexTokenManager()
    let token = tokens.create(permissions: ["session:*"])
    XCTAssertTrue(tokens.verify(id: token.metadata.id, secret: token.secret, permission: "session:read"))
    XCTAssertEqual(tokens.listMetadata().first?.permissions, ["session:*"])

    XCTAssertEqual(CodexSessionCommands.runArguments(prompt: "hello").prefix(2), ["exec", "--json"])
    XCTAssertEqual(CodexSessionCommands.resumeArguments(sessionId: "session-sdk").prefix(3), ["exec", "resume", "--json"])
  }

  func testProcessManagerResumeStreamAndProductionRunAgentRunner() throws {
    let manager = CodexProcessManager(executableName: "codex-dev") { arguments, prompt, _ in
      XCTAssertEqual(arguments.prefix(4), ["codex-dev", "exec", "resume", "--json"])
      XCTAssertTrue(arguments.contains("session-prod"))
      XCTAssertEqual(prompt, "continue")
      return CodexProcessExecution(
        stdout: [
          #"{"timestamp":"2025-05-07T17:24:21.123Z","type":"session_meta","payload":{"meta":{"id":"session-prod","timestamp":"2025-05-07T17:24:21.123Z","cwd":"/tmp/project","cli_version":"0.1.0","source":"exec"}}}"#,
          #"{"timestamp":"2025-05-07T17:24:23.000Z","type":"event_msg","payload":{"type":"AgentMessage","message":"resumed"}}"#,
        ].joined(separator: "\n"),
        exitCode: 0
      )
    }

    let runner = CodexProcessSessionRunner(processManager: manager)
    let events = try CodexAgentSDK.runAgent(request: CodexAgentSDK.Request(prompt: "continue", sessionId: "session-prod"), runner: runner)
    XCTAssertTrue(events.contains { $0.type == "session.started" && $0.sessionId == "session-prod" })
    let assistantEvents = events.filter { $0.type == "assistant.snapshot" }
    XCTAssertTrue(assistantEvents.contains { event in
      event.payload["content"] == .string("resumed")
    })
    XCTAssertEqual(manager.list().first?.command, #"codex-dev exec resume --json -- session-prod continue"#)
  }

  func testQueueGroupBookmarkAndTokenFocusedMutations() throws {
    var queues = CodexQueueRepository()
    let queue = queues.createQueue(name: "release")
    let firstPrompt = try XCTUnwrap(queues.addPrompt(queueId: queue.id, prompt: "one"))
    let secondPrompt = try XCTUnwrap(queues.addPrompt(queueId: queue.id, prompt: "two"))
    XCTAssertEqual(queues.findQueue("release")?.id, queue.id)
    XCTAssertTrue(queues.pauseQueue(id: queue.id))
    XCTAssertEqual(queues.getQueue(id: queue.id)?.paused, true)
    XCTAssertTrue(queues.resumeQueue(id: queue.id))
    XCTAssertTrue(queues.movePrompt(queueId: queue.id, promptId: secondPrompt.id, toIndex: 0))
    XCTAssertEqual(queues.getQueue(id: queue.id)?.prompts.map(\.id), [secondPrompt.id, firstPrompt.id])
    XCTAssertTrue(queues.setMode(queueId: queue.id, mode: .manual))
    let runPrompts = queues.runQueue(id: queue.id) { prompt in
      XCTAssertEqual(prompt.id, secondPrompt.id)
      return 0
    }
    XCTAssertEqual(runPrompts.map(\.id), [secondPrompt.id])
    XCTAssertEqual(queues.getQueue(id: queue.id)?.prompts.first?.resultExitCode, 0)
    XCTAssertTrue(queues.removePrompt(queueId: queue.id, promptId: firstPrompt.id))
    XCTAssertEqual(queues.getQueue(id: queue.id)?.prompts.map(\.id), [secondPrompt.id])
    XCTAssertTrue(queues.deleteQueue(id: queue.id))
    XCTAssertNil(queues.getQueue(id: queue.id))

    var groups = CodexGroupRepository()
    let group = groups.createGroup(name: "parallel")
    XCTAssertEqual(groups.findGroup("parallel")?.id, group.id)
    XCTAssertTrue(groups.addSession(groupId: group.id, sessionId: "session-a"))
    XCTAssertTrue(groups.addSession(groupId: group.id, sessionId: "session-b"))
    XCTAssertTrue(groups.addSession(groupId: group.id, sessionId: "session-a"))
    XCTAssertEqual(groups.getGroup(id: group.id)?.sessionIds, ["session-a", "session-b"])
    let groupResults = groups.runGroup(id: group.id, maxConcurrent: 1) { sessionId in
      XCTAssertEqual(sessionId, "session-a")
      return 0
    }
    XCTAssertEqual(groupResults.map(\.sessionId), ["session-a"])
    XCTAssertTrue(groups.pauseGroup(id: group.id))
    XCTAssertEqual(groups.getGroup(id: group.id)?.paused, true)
    XCTAssertTrue(groups.resumeGroup(id: group.id))
    XCTAssertTrue(groups.removeSession(groupId: group.id, sessionId: "session-a"))
    XCTAssertEqual(groups.getGroup(id: group.id)?.sessionIds, ["session-b"])
    XCTAssertTrue(groups.deleteGroup(id: group.id))

    var bookmarks = CodexBookmarkManager()
    XCTAssertThrowsError(try bookmarks.create(type: .message, sessionId: "session-a"))
    XCTAssertThrowsError(try bookmarks.create(type: .session, sessionId: "session-a", messageId: "message-a"))
    XCTAssertThrowsError(try bookmarks.create(type: .range, sessionId: "session-a", startLine: 5, endLine: 4))
    let bookmark = try bookmarks.create(type: .range, sessionId: "session-a", text: "important", tags: ["Ship", "ship"], startLine: 1, endLine: 4)
    XCTAssertEqual(bookmarks.list(tag: "SHIP"), [bookmark])
    XCTAssertEqual(bookmarks.get(id: bookmark.id), bookmark)
    XCTAssertEqual(bookmark.tags, ["ship"])
    XCTAssertEqual(bookmarks.search(text: "port").map(\.id), [bookmark.id])
    XCTAssertTrue(bookmarks.delete(id: bookmark.id))
    XCTAssertEqual(bookmarks.list(sessionId: "session-a"), [])

    var tokens = CodexTokenManager()
    XCTAssertEqual(CodexTokenManager.parsePermissionsCSV("session:read, queue:* ,"), ["session:read", "queue:*"])
    let token = tokens.create(permissions: ["session:read"])
    XCTAssertTrue(tokens.verify(id: token.metadata.id, secret: token.secret, permission: "session:read"))
    XCTAssertFalse(tokens.verify(id: token.metadata.id, secret: token.secret, permission: "session:write"))
    XCTAssertFalse(String(describing: tokens.listMetadata()).contains(token.secret))
    let rotated = try XCTUnwrap(tokens.rotate(id: token.metadata.id))
    XCTAssertFalse(tokens.verify(id: token.metadata.id, secret: token.secret, permission: "session:read"))
    XCTAssertTrue(tokens.verify(id: token.metadata.id, secret: rotated, permission: "session:read"))
    XCTAssertTrue(tokens.revoke(id: token.metadata.id))
    XCTAssertFalse(tokens.verify(id: token.metadata.id, secret: rotated, permission: "session:read"))
    XCTAssertTrue(try XCTUnwrap(tokens.listMetadata().first).revoked)

    let temp = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: temp)
    }
    let queueStore = CodexJSONStore<[CodexQueue]>(url: temp.appendingPathComponent("queues.json"))
    try queueStore.save([CodexQueue(id: "queue-1", name: "persisted", prompts: [], paused: false)])
    XCTAssertEqual(try queueStore.load(default: []).first?.name, "persisted")
  }

  func testPersistentQueueAndBookmarkRepositoriesMirrorReferenceConfigFiles() throws {
    let configDir = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: configDir)
    }

    XCTAssertEqual(try CodexQueuePersistence.load(configDir: configDir.path).queues, [])
    let queue = try CodexQueuePersistence.createQueue(name: "persisted", projectPath: "/project/path", configDir: configDir.path)
    XCTAssertEqual(queue.projectPath, "/project/path")
    let prompt = try XCTUnwrap(CodexQueuePersistence.addPrompt(queueId: queue.id, prompt: "Analyze screenshots", imagePaths: ["./a.png", "./b.png"], configDir: configDir.path))
    XCTAssertEqual(prompt.imagePaths, ["./a.png", "./b.png"])
    XCTAssertEqual(try CodexQueuePersistence.findQueue("persisted", configDir: configDir.path)?.prompts.count, 1)
    var completed = prompt
    completed.status = .completed
    completed.resultExitCode = 0
    XCTAssertTrue(try CodexQueuePersistence.updateQueuePrompts(queueId: queue.id, prompts: [completed], configDir: configDir.path))
    XCTAssertEqual(try CodexQueuePersistence.findQueue(queue.id, configDir: configDir.path)?.prompts.first?.status, .completed)
    let rawQueues = try String(contentsOf: CodexQueuePersistence.url(configDir: configDir.path), encoding: .utf8)
    XCTAssertNoThrow(try JSONDecoder().decode(CodexQueuesConfig.self, from: Data(rawQueues.utf8)))
    XCTAssertTrue(try CodexQueuePersistence.removeQueue(queue.id, configDir: configDir.path))
    XCTAssertEqual(try CodexQueuePersistence.listQueues(configDir: configDir.path), [])

    let sessionBookmark = try CodexBookmarkPersistence.addBookmark(type: .session, sessionId: "session-1", name: "important session", description: "Detailed postmortem", tags: ["Priority", "review"], configDir: configDir.path)
    XCTAssertEqual(try CodexBookmarkPersistence.getBookmark(id: sessionBookmark.id, configDir: configDir.path)?.name, "important session")
    _ = try CodexBookmarkPersistence.addBookmark(type: .message, sessionId: "session-2", messageId: "message-1", name: "message two", tags: ["beta"], configDir: configDir.path)
    XCTAssertEqual(try CodexBookmarkPersistence.listBookmarks(sessionId: "session-1", configDir: configDir.path).map(\.id), [sessionBookmark.id])
    XCTAssertEqual(try CodexBookmarkPersistence.listBookmarks(type: .message, configDir: configDir.path).count, 1)
    XCTAssertEqual(try CodexBookmarkPersistence.searchBookmarks("postmortem", configDir: configDir.path).map(\.id), [sessionBookmark.id])
    XCTAssertTrue(try CodexBookmarkPersistence.deleteBookmark(id: sessionBookmark.id, configDir: configDir.path))
    XCTAssertNil(try CodexBookmarkPersistence.getBookmark(id: sessionBookmark.id, configDir: configDir.path))
  }

  func testGraphQLVariablesFileChangesAndTranscriptSearchBudgets() throws {
    XCTAssertEqual(try CodexGraphQLCommandExecutor.parseVariables(#"{"id":"session-1","limit":5}"#)["id"], .string("session-1"))
    XCTAssertThrowsError(try CodexGraphQLCommandExecutor.parseVariables(#"["not-object"]"#)) { error in
      XCTAssertEqual(error as? CodexGraphQLError, .variablesMustBeObject)
    }

    let applyPatch = CodexRolloutLine(timestamp: "now", type: "event_msg", payload: .object(["patch": .string("*** Update File: Sources/Existing.swift\n*** Delete File: Sources/Old.swift\n")]))
    XCTAssertEqual(
      CodexFileChanges.extract(from: applyPatch),
      [
        CodexFileChange(path: "Sources/Existing.swift", operation: .modified, source: .applyPatch),
        CodexFileChange(path: "Sources/Old.swift", operation: .deleted, source: .applyPatch),
      ]
    )

    let shellChange = CodexRolloutLine(timestamp: "now", type: "event_msg", payload: .object(["file_changes": .array([.object(["path": .string("README.md"), "operation": .string("modified"), "source": .string("shell")])])]))
    XCTAssertEqual(CodexFileChanges.extract(from: shellChange), [CodexFileChange(path: "README.md", operation: .modified, source: .shell)])
    let failedShell = CodexRolloutLine(timestamp: "now", type: "event_msg", payload: .object(["exit_code": .number(1), "file_changes": .array([.object(["path": .string("FAILED.md"), "operation": .string("modified"), "source": .string("shell")])])]))
    XCTAssertEqual(CodexFileChanges.extract(from: failedShell), [])
    let movedPatch = CodexRolloutLine(timestamp: "now", type: "event_msg", payload: .object(["patch": .string("*** Update File: Old.md\n*** Move to: New.md\n")]))
    let index = CodexFileChangeIndex.rebuild(from: [applyPatch, movedPatch])
    XCTAssertEqual(index.find("Old.md")?.operation, .moved)
    XCTAssertEqual(index.find("New.md")?.previousPath, "Old.md")
    XCTAssertTrue(index.listChangedFiles().contains("New.md"))

    let home = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: home)
    }
    let day = home.appendingPathComponent("sessions/2025/05/07", isDirectory: true)
    try FileManager.default.createDirectory(at: day, withIntermediateDirectories: true)
    let sessionId = "dddd0000-0000-0000-0000-000000000004"
    let rollout = day.appendingPathComponent("rollout-2025-05-07T17-24-21-\(sessionId).jsonl")
    try [
      #"{"timestamp":"2025-05-07T17:24:21.123Z","type":"session_meta","payload":{"meta":{"id":"\#(sessionId)","timestamp":"2025-05-07T17:24:21.123Z","cwd":"/tmp/project","cli_version":"0.1.0","source":"cli"}}}"#,
      #"{"timestamp":"2025-05-07T17:25:00.000Z","type":"event_msg","payload":{"type":"UserMessage","message":"Alpha request"}}"#,
      #"{"timestamp":"2025-05-07T17:25:01.000Z","type":"event_msg","payload":{"type":"AgentMessage","message":"beta response"}}"#,
    ].joined(separator: "\n").write(to: rollout, atomically: true, encoding: .utf8)

    XCTAssertEqual(try CodexSessionIndex.searchSessions(query: "alpha", options: CodexSessionListOptions(codexHome: home.path), searchOptions: CodexSessionTranscriptSearchOptions(role: "user")).sessionIds, [sessionId])
    XCTAssertEqual(try CodexSessionIndex.searchSessions(query: "alpha", options: CodexSessionListOptions(codexHome: home.path), searchOptions: CodexSessionTranscriptSearchOptions(caseSensitive: true)).sessionIds, [])
    XCTAssertEqual(try CodexSessionIndex.searchSessions(query: "response", options: CodexSessionListOptions(codexHome: home.path), searchOptions: CodexSessionTranscriptSearchOptions(role: "assistant", limit: 1, offset: 0)).sessionIds, [sessionId])
  }

  func testActivityMockRunnerEmitterToolRegistryAttachmentsAndOps() throws {
    let lines = [
      CodexRolloutLine(timestamp: "2025-05-07T17:24:24.000Z", type: "event_msg", payload: .object(["type": .string("TurnStarted")])),
      CodexRolloutLine(timestamp: "2025-05-07T17:24:25.000Z", type: "event_msg", payload: .object(["type": .string("ExecApprovalRequest")])),
    ]
    let activity = CodexSessionIndex.deriveActivityEntry(sessionId: "session-1", lines: lines)
    XCTAssertEqual(activity.status, .waitingApproval)

    let runningSession = MockCodexRunningSession(sessionId: "session-1", messages: lines)
    let runner = createMockCodexSessionRunner(startSessions: [runningSession])
    let started = try runner.startSession(config: CodexSessionConfig(prompt: "hello"))
    XCTAssertEqual(started.sessionId, "session-1")
    XCTAssertEqual(runner.startSessionCalls.map(\.config.prompt), ["hello"])
    XCTAssertEqual(started.messages().count, 2)
    XCTAssertEqual(started.waitForCompletion().exitCode, 0)

    let emitter = BasicCodexSDKEventEmitter()
    var seenPayload: JSONObject?
    let id = emitter.on(.sessionStarted) { payload in
      seenPayload = payload
    }
    emitter.emit(.sessionStarted, payload: ["sessionId": .string("session-1")])
    XCTAssertEqual(seenPayload?["sessionId"], .string("session-1"))
    emitter.off(.sessionStarted, id: id)

    var registry = CodexToolRegistry()
    registry.register(name: "read_file", definition: ["description": .string("Read a file")])
    XCTAssertEqual(registry.listNames(), ["read_file"])

    let temp = try makeTemporaryDirectory()
    addTeardownBlock {
      try? FileManager.default.removeItem(at: temp)
    }
    let paths = try CodexAgentAttachments.imagePathArguments(
      from: [.path("/tmp/source.png"), .base64(data: Data("png".utf8).base64EncodedString(), mediaType: "image/png", filename: "../unsafe name.png")],
      tempDirectory: temp
    )
    XCTAssertEqual(paths.first, "/tmp/source.png")
    XCTAssertTrue(FileManager.default.fileExists(atPath: paths[1]))
    CodexAgentAttachments.cleanup(paths: [paths[1]])
    XCTAssertFalse(FileManager.default.fileExists(atPath: paths[1]))

    XCTAssertEqual(CodexCLICompatibility.parseProcessOptions(["--model", "gpt-5.5", "--sandbox", "read-only", "--full-auto"]).model, "gpt-5.5")
    XCTAssertEqual(try CodexCLICompatibility.parseCommand(["queue", "move", "queue-1", "prompt-1", "0"]).family, .queue)
    XCTAssertThrowsError(try CodexCLICompatibility.parseCommand(["queue", "unknown"]))
    XCTAssertTrue(CodexCLICompatibility.usage().contains("graphql"))
    XCTAssertEqual(CodexGraphQLCommandExecutor.normalizeDocument("session.list"), "query { session.list }")
    XCTAssertEqual(try CodexGraphQLCommandExecutor.parseParams(["limit=5", "tag=ship"])["limit"], .number(5))
    XCTAssertEqual(CodexGraphQLCommandExecutor.execute(command: "version.get").errors, [])
    XCTAssertEqual(CodexGraphQLCommandExecutor.execute(command: "unknown.command").errors, ["Unknown command: unknown.command"])
    XCTAssertEqual(CodexGraphQLCommandExecutor.execute(command: "subscription { queue.run }").errors, ["Unsupported subscription command: queue.run"])
    let runResult = CodexGraphQLCommandExecutor.execute(command: "session.run", variables: ["prompt": .string("hello"), "model": .string("gpt-5.5"), "fullAuto": .bool(true)])
    if case let .object(data) = runResult.data, case let .array(arguments) = data["arguments"] {
      XCTAssertTrue(arguments.contains(.string("--model")))
      XCTAssertTrue(arguments.contains(.string("gpt-5.5")))
      XCTAssertTrue(arguments.contains(.string("--dangerously-bypass-approvals-and-sandbox")))
      XCTAssertFalse(arguments.contains(.string("--stream-granularity")))
    } else {
      XCTFail("expected session.run arguments")
    }
    XCTAssertTrue(CodexGraphQLCommandExecutor.supportedCommandNames.isSuperset(of: ["queue.move", "bookmark.search", "token.rotate", "files.rebuild", "session.watch"]))
    XCTAssertEqual(CodexMarkdown.parseTasks("# Work\n- [ ] one\n- [x] two").map(\.checked), [false, true])
    XCTAssertEqual(CodexMarkdown.parseSections("# Work\nBody\n## Next\nMore").map(\.heading), ["Work", "Next"])
    let changes = CodexFileChanges.extract(from: CodexRolloutLine(timestamp: "now", type: "event_msg", payload: .object(["patch": .string("*** Add File: Sources/New.swift\n")])))
    XCTAssertEqual(changes, [CodexFileChange(path: "Sources/New.swift", operation: .created, source: .applyPatch)])
  }
}

private extension String {
  func appendLine(to url: URL) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer {
      try? handle.close()
    }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data((self + "\n").utf8))
  }
}

private func makeTemporaryDirectory() throws -> URL {
  let repoTmp = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true).appendingPathComponent("tmp/codex-agent-tests", isDirectory: true)
  try FileManager.default.createDirectory(at: repoTmp, withIntermediateDirectories: true)
  let url = repoTmp.appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func writeRollout(_ url: URL, id: String, cwd: String, source: String, branch: String?, message: String) throws {
  let git = branch.map { #","git":{"sha":"abc123","branch":"\#($0)","origin_url":"https://example.test/repo.git"}"# } ?? ""
  try [
    #"{"timestamp":"2025-05-07T17:24:21.123Z","type":"session_meta","payload":{"meta":{"id":"\#(id)","timestamp":"2025-05-07T17:24:21.123Z","cwd":"\#(cwd)","originator":"codex-cli","cli_version":"0.1.0","source":"\#(source)","model_provider":"openai"}\#(git)}}"#,
    #"{"timestamp":"2025-05-07T17:25:00.000Z","type":"event_msg","payload":{"type":"UserMessage","message":"\#(message)"}}"#,
  ].joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8)
}

private func runSQLite(_ path: String, _ sql: String) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/sqlite3")
  process.arguments = [path, sql]
  process.standardOutput = Pipe()
  process.standardError = Pipe()
  try process.run()
  process.waitUntilExit()
  XCTAssertEqual(process.terminationStatus, 0)
}
