import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentAdapter,
  AgentAdapterStatus,
  AgentRunEvent,
  AgentRunRequest,
} from "@component-atlas/agent";
import { listAgentRunAudits, scanProject } from "@component-atlas/runtime";
import {
  cancelAgentRun,
  clearAgentRuns,
  getAgentRun,
  listAgentRuns,
  replaceAgentAdapter,
  resumeAgentRun,
  startAgentRun,
} from "./agent-runs";
import { loadProjectAtlasSnapshot } from "./project";

const fixture = fileURLToPath(
  new URL("../../../../fixtures/vue-nuxt", import.meta.url),
);

function compactResult() {
  return {
    status: "completed" as const,
    summary: "Prepared bounded evidence.",
    brief: ["Inspect the selected component."],
    evidence: [],
    decisions: [],
    risks: [],
    memoryCloseout: {
      status: "none" as const,
      summary: "No durable project knowledge was detected.",
      candidates: [],
      confirmationRequired: false,
      confirmationPrompt: "",
    },
  };
}

class CompletingAdapter implements AgentAdapter {
  readonly id = "fake";
  request?: AgentRunRequest;

  async status(): Promise<AgentAdapterStatus> {
    return {
      id: this.id,
      label: "Fake adapter",
      state: "detected",
      authentication: "unknown",
      checkedAt: new Date().toISOString(),
    };
  }

  run(request: AgentRunRequest) {
    this.request = request;
    return {
      cancel() {},
      events: (async function* (): AsyncGenerator<AgentRunEvent> {
        yield {
          type: "run-started",
          at: new Date().toISOString(),
          threadId: "thread-fixture",
          message: "Started.",
        };
        yield {
          type: "completed",
          at: new Date().toISOString(),
          threadId: "thread-fixture",
          result: compactResult(),
        };
      })(),
    };
  }
}

class BlockingAdapter extends CompletingAdapter {
  private release!: () => void;
  private cancelled = false;

  override run(request: AgentRunRequest) {
    this.request = request;
    const wait = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    const owner = this;
    return {
      cancel() {
        owner.cancelled = true;
        owner.release();
      },
      events: (async function* (): AsyncGenerator<AgentRunEvent> {
        yield {
          type: "run-started",
          at: new Date().toISOString(),
          threadId: "thread-blocking",
          message: "Started.",
        };
        await wait;
        if (owner.cancelled) {
          yield {
            type: "cancelled",
            at: new Date().toISOString(),
            message: "Cancelled.",
          };
        }
      })(),
    };
  }
}

describe.sequential("viewer agent run ownership", () => {
  let rootPath: string;
  let dataHome: string;
  let previousDataHome: string | undefined;
  let restoreAdapter: (() => void) | undefined;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-agent-viewer-"));
    dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-agent-data-"));
    previousDataHome = process.env.COMPONENT_ATLAS_HOME;
    process.env.COMPONENT_ATLAS_HOME = dataHome;
    await cp(fixture, rootPath, { recursive: true });
    await scanProject(rootPath);
    process.env.ATLAS_PROJECT_ROOT = rootPath;
  });

  afterEach(async () => {
    try {
      clearAgentRuns();
    } catch {
      // A failed test may leave a fake run active; process teardown owns it.
    }
    restoreAdapter?.();
    restoreAdapter = undefined;
    delete process.env.ATLAS_PROJECT_ROOT;
    if (previousDataHome === undefined) delete process.env.COMPONENT_ATLAS_HOME;
    else process.env.COMPONENT_ATLAS_HOME = previousDataHome;
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(dataHome, { recursive: true, force: true }),
    ]);
  });

  it("regenerates compact context and carries reviewed selection handles", async () => {
    const adapter = new CompletingAdapter();
    restoreAdapter = replaceAgentAdapter(adapter);
    const snapshot = loadProjectAtlasSnapshot();
    const selected = snapshot.graph.components[0]!;
    const started = startAgentRun({
      task: "Review a small interface change",
      objectiveConfirmed: false,
      sourceDecisions: [],
      budgetChars: 2_400,
      topK: 3,
      selectedHandles: [`code:${selected.id}`],
      expectedFingerprint: snapshot.fingerprint,
    });

    await expect
      .poll(() => getAgentRun(started.id).state)
      .toBe("completed");
    expect(adapter.request?.compactContext).toContain(selected.id);
    expect(adapter.request?.compactContext.length).toBeLessThanOrEqual(2_400);
    expect(getAgentRun(started.id).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ type: "completed" }),
        }),
      ]),
    );
    const audits = await listAgentRunAudits(rootPath);
    expect(audits[0]).toMatchObject({
      id: started.id,
      state: "completed",
      sourceKinds: [],
      selectedKinds: ["code"],
      resultStatus: "completed",
    });
    expect(JSON.stringify(audits[0])).not.toContain("Review a small interface change");
  });

  it("locks one checkout and supports real cancellation", async () => {
    const adapter = new BlockingAdapter();
    restoreAdapter = replaceAgentAdapter(adapter);
    const snapshot = loadProjectAtlasSnapshot();
    const started = startAgentRun({
      task: "Make a bounded local change",
      objectiveConfirmed: false,
      sourceDecisions: [],
      budgetChars: 2_400,
      topK: 3,
      selectedHandles: [],
      expectedFingerprint: snapshot.fingerprint,
    });
    expect(() =>
      startAgentRun({
        task: "Start another task",
        objectiveConfirmed: false,
        sourceDecisions: [],
        budgetChars: 2_400,
        topK: 3,
        selectedHandles: [],
        expectedFingerprint: snapshot.fingerprint,
      }),
    ).toThrow(/active Codex run/i);

    cancelAgentRun(started.id);
    await expect
      .poll(() => getAgentRun(started.id).state)
      .toBe("cancelled");
  });

  it("lists resumable runs and resumes the selected Codex thread with reviewed inputs", async () => {
    const adapter = new CompletingAdapter();
    restoreAdapter = replaceAgentAdapter(adapter);
    const snapshot = loadProjectAtlasSnapshot();
    const started = startAgentRun({
      task: "Prepare the assignment view",
      objectiveConfirmed: false,
      sourceDecisions: [],
      budgetChars: 2_400,
      topK: 3,
      selectedHandles: [],
      expectedFingerprint: snapshot.fingerprint,
    });

    await expect.poll(() => getAgentRun(started.id).state).toBe("completed");
    expect(listAgentRuns()[0]).toMatchObject({
      id: started.id,
      threadId: "thread-fixture",
      resumable: true,
      state: "completed",
      sourceDecisions: [],
    });
    const currentSnapshot = loadProjectAtlasSnapshot();

    resumeAgentRun(started.id, {
      nextStep: "Add the reviewed empty state",
      sourceDecisions: [
        {
          id: "source-jira-fixture",
          kind: "jira",
          reference: "APP-42",
          origin: "manual",
          state: "confirmed",
          required: false,
        },
      ],
      sandbox: "workspace-write",
      budgetChars: 3_600,
      topK: 5,
      selectedHandles: [],
      figmaFile: null,
      expectedFingerprint: currentSnapshot.fingerprint,
    });

    await expect.poll(() => getAgentRun(started.id).state).toBe("completed");
    expect(adapter.request).toMatchObject({
      mode: "continue",
      threadId: "thread-fixture",
      sandbox: "read-only",
      sources: [
        {
          kind: "jira",
          value: "APP-42",
        },
      ],
      contextMetrics: {
        budgetChars: 3_600,
      },
    });
    expect(adapter.request?.task).toContain("Next step: Add the reviewed empty state");
  });

  it("upgrades to workspace write only by resuming a reviewed thread", async () => {
    const adapter = new CompletingAdapter();
    restoreAdapter = replaceAgentAdapter(adapter);
    const snapshot = loadProjectAtlasSnapshot();
    const started = startAgentRun({
      task: "Fix a local button label",
      objectiveConfirmed: false,
      sourceDecisions: [],
      budgetChars: 2_400,
      topK: 3,
      selectedHandles: [],
      expectedFingerprint: snapshot.fingerprint,
    });
    await expect.poll(() => getAgentRun(started.id).state).toBe("completed");

    const resumed = resumeAgentRun(started.id, {
      answer: "Implement the reviewed brief.",
      mode: "implement",
      sandbox: "workspace-write",
    });
    expect(resumed).toMatchObject({
      id: started.id,
      mode: "implement",
      sandbox: "workspace-write",
    });
    await expect.poll(() => getAgentRun(started.id).state).toBe("completed");
    expect(adapter.request).toMatchObject({
      mode: "implement",
      sandbox: "workspace-write",
      threadId: "thread-fixture",
    });

    const corrected = resumeAgentRun(started.id, {
      correction: "Use the newly confirmed ticket.",
      mode: "correct",
      sandbox: "workspace-write",
      sourceDecisions: [
        {
          id: "source-jira-fixture",
          kind: "jira",
          reference: "APP-42",
          origin: "manual",
          state: "confirmed",
          required: false,
        },
      ],
    });
    expect(corrected.sandbox).toBe("read-only");
    await expect.poll(() => getAgentRun(started.id).state).toBe("completed");
    expect(adapter.request).toMatchObject({
      mode: "correct",
      sandbox: "read-only",
      sources: [{ kind: "jira", value: "APP-42" }],
    });
  });
});
