import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRuntimeSupervisorConversationRepository } from "./supervisor-conversations";

describe("createRuntimeSupervisorConversationRepository", () => {
  let dir: string;
  let dbPath: string;
  const loadOptions = () => ({
    env: { DIVEDRA_RUNTIME_DB: dbPath },
    cwd: dir,
  });

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "divedra-supervisor-conv-"));
    await mkdir(path.join(dir, "data"), { recursive: true });
    dbPath = path.join(dir, "data", "divedra.db");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("inserts, loads, and finds a conversation by correlation", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-1";
    const inserted = await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-1",
      bindingId: "bind-1",
      correlationKey: "corr-1",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "artifacts", convId),
      createdAt: now,
      updatedAt: now,
    });
    expect(inserted).toBe("inserted");

    const loaded = await repo.loadConversation(convId);
    expect(loaded).not.toBeNull();
    expect(loaded?.supervisorProfileId).toBe("profile-a");
    expect(loaded?.conversationRevision).toBe(1);

    const found = await repo.findConversationByCorrelation({
      sourceId: "src-1",
      bindingId: "bind-1",
      correlationKey: "corr-1",
    });
    expect(found?.supervisorConversationId).toBe(convId);
  });

  it("applies compare-and-swap updates and rejects stale revisions", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-cas";
    await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-cas",
      correlationKey: "corr-cas",
      conversationRevision: 1,
      selectedManagedRunIdsByWorkflowKey: { code: "run-a" },
      status: "active",
      artifactDir: path.join(dir, "a", convId),
      createdAt: now,
      updatedAt: now,
    });

    const nextTs = new Date().toISOString();
    const updated = await repo.updateConversationCas({
      expectedConversationRevision: 1,
      next: {
        supervisorConversationId: convId,
        supervisorProfileId: "profile-a",
        profileRevision: "rev-1",
        supervisorWorkflowName: "supervisor-wf",
        sourceId: "src-cas",
        correlationKey: "corr-cas",
        conversationRevision: 2,
        selectedManagedRunId: "run-a",
        selectedManagedRunIdsByWorkflowKey: { code: "run-a", docs: "run-b" },
        supervisorExecutionId: "sup-exec-1",
        status: "active",
        artifactDir: path.join(dir, "a", convId),
        createdAt: now,
        updatedAt: nextTs,
      },
    });
    expect(updated).not.toBeNull();
    expect(updated?.conversationRevision).toBe(2);
    expect(updated?.selectedManagedRunId).toBe("run-a");
    expect(updated?.selectedManagedRunIdsByWorkflowKey).toEqual({
      code: "run-a",
      docs: "run-b",
    });
    expect(updated?.supervisorExecutionId).toBe("sup-exec-1");

    const stale = await repo.updateConversationCas({
      expectedConversationRevision: 1,
      next: {
        supervisorConversationId: convId,
        supervisorProfileId: "profile-a",
        profileRevision: "rev-1",
        supervisorWorkflowName: "supervisor-wf",
        sourceId: "src-cas",
        correlationKey: "corr-cas",
        conversationRevision: 99,
        status: "active",
        artifactDir: path.join(dir, "a", convId),
        createdAt: now,
        updatedAt: nextTs,
      },
    });
    expect(stale).toBeNull();

    const current = await repo.loadConversation(convId);
    expect(current?.conversationRevision).toBe(2);
  });

  it("dedupes dispatch decisions by conversation and source message", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-dec";
    await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-d",
      correlationKey: "corr-d",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "d", convId),
      createdAt: now,
      updatedAt: now,
    });

    const decision = {
      decisionId: "dec-1",
      supervisorConversationId: convId,
      sourceMessageId: "msg-1",
      profileRevision: "rev-1",
      conversationRevision: 1,
      status: "applied" as const,
      proposalJson: '{"action":"no-op"}',
      receiptId: "rcpt-1",
      createdAt: now,
      updatedAt: now,
    };
    expect(await repo.insertDispatchDecisionIfAbsent(decision)).toBe(
      "inserted",
    );
    expect(await repo.insertDispatchDecisionIfAbsent(decision)).toBe(
      "duplicate",
    );

    const loaded = await repo.loadDispatchDecisionBySourceMessage({
      supervisorConversationId: convId,
      sourceMessageId: "msg-1",
    });
    expect(loaded?.decisionId).toBe("dec-1");
    expect(loaded?.proposalJson).toBe('{"action":"no-op"}');
  });

  it("upserts and lists managed runs", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-runs";
    await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-r",
      correlationKey: "corr-r",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "r", convId),
      createdAt: now,
      updatedAt: now,
    });

    await repo.upsertManagedRun({
      managedRunId: "mr-1",
      supervisorConversationId: convId,
      managedWorkflowKey: "code",
      targetWorkflowName: "code-review",
      runAlias: "main",
      status: "running",
      restartCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const later = new Date().toISOString();
    await repo.upsertManagedRun({
      managedRunId: "mr-1",
      supervisorConversationId: convId,
      managedWorkflowKey: "code",
      targetWorkflowName: "code-review",
      runAlias: "main",
      activeTargetExecutionId: "exec-9",
      status: "completed",
      restartCount: 0,
      createdAt: now,
      updatedAt: later,
    });

    const runs = await repo.listManagedRuns(convId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("completed");
    expect(runs[0]?.activeTargetExecutionId).toBe("exec-9");
  });

  it("rejects duplicate active supervisor conversations for the same correlation", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const firstId = "conv-dup-a";
    const secondId = "conv-dup-b";
    const inserted = await repo.insertConversation({
      supervisorConversationId: firstId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-dup",
      bindingId: "bind-dup",
      correlationKey: "corr-dup",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "dup", firstId),
      createdAt: now,
      updatedAt: now,
    });
    expect(inserted).toBe("inserted");

    const dup = await repo.insertConversation({
      supervisorConversationId: secondId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-dup",
      bindingId: "bind-dup",
      correlationKey: "corr-dup",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "dup", secondId),
      createdAt: now,
      updatedAt: now,
    });
    expect(dup).toBe("duplicate");
  });

  it("transitions a proposed dispatch decision to applied", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-upd-dec";
    await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-upd",
      correlationKey: "corr-upd",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "upd", convId),
      createdAt: now,
      updatedAt: now,
    });

    expect(
      await repo.insertDispatchDecisionIfAbsent({
        decisionId: "dec-prop",
        supervisorConversationId: convId,
        sourceMessageId: "msg-prop",
        profileRevision: "rev-1",
        conversationRevision: 1,
        status: "proposed",
        proposalJson:
          '{"action":"no-op","reason":"__dispatch_claim__","confidence":1}',
        createdAt: now,
        updatedAt: now,
      }),
    ).toBe("inserted");

    const later = new Date().toISOString();
    const updated = await repo.updateDispatchDecisionFromProposed({
      decisionId: "dec-prop",
      nextStatus: "applied",
      proposalJson: '{"action":"status","reason":"ok","confidence":1}',
      resultSummaryJson: null,
      conversationRevision: 1,
      profileRevision: "rev-1",
      updatedAt: later,
    });
    expect(updated).toBe(true);

    const loaded = await repo.loadDispatchDecisionBySourceMessage({
      supervisorConversationId: convId,
      sourceMessageId: "msg-prop",
    });
    expect(loaded?.status).toBe("applied");
    expect(loaded?.proposalJson).toContain("status");

    const noOp = await repo.updateDispatchDecisionFromProposed({
      decisionId: "dec-prop",
      nextStatus: "rejected",
      proposalJson: '{"action":"no-op"}',
      resultSummaryJson: null,
      conversationRevision: 1,
      profileRevision: "rev-1",
      updatedAt: later,
    });
    expect(noOp).toBe(false);
  });

  it("rejects two managed runs with the same non-null runAlias in one conversation", async () => {
    const repo = createRuntimeSupervisorConversationRepository(loadOptions());
    const now = new Date().toISOString();
    const convId = "conv-alias";
    await repo.insertConversation({
      supervisorConversationId: convId,
      supervisorProfileId: "profile-a",
      profileRevision: "rev-1",
      supervisorWorkflowName: "supervisor-wf",
      sourceId: "src-al",
      correlationKey: "corr-al",
      conversationRevision: 1,
      status: "active",
      artifactDir: path.join(dir, "al", convId),
      createdAt: now,
      updatedAt: now,
    });

    await repo.upsertManagedRun({
      managedRunId: "mr-a",
      supervisorConversationId: convId,
      managedWorkflowKey: "code",
      targetWorkflowName: "wf-a",
      runAlias: "branch-1",
      status: "running",
      restartCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      repo.upsertManagedRun({
        managedRunId: "mr-b",
        supervisorConversationId: convId,
        managedWorkflowKey: "code",
        targetWorkflowName: "wf-b",
        runAlias: "branch-1",
        status: "running",
        restartCount: 0,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow(/duplicate managed run runAlias/i);
  });
});
