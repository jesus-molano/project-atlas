import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ComponentGraph } from "@component-atlas/core";
import {
  AtlasStore,
  projectStorageDirectory,
} from "@component-atlas/store";
import { copyFixture } from "../../../scripts/test-fixture-copy.mjs";
import {
  applyMemoryUpdate,
  proposeMemoryUpdate,
  recordProjectOutcome,
  scanProject,
} from "./index.js";

const vueFixture = fileURLToPath(
  new URL("../../../fixtures/vue-nuxt", import.meta.url),
);

describe.sequential("atomic memory application", () => {
  let rootPath: string;
  let dataHome: string;
  let previousDataHome: string | undefined;
  let graph: ComponentGraph;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-memory-atomic-"));
    dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-memory-data-"));
    previousDataHome = process.env.PROJECT_ATLAS_HOME;
    process.env.PROJECT_ATLAS_HOME = dataHome;
    await copyFixture(vueFixture, rootPath);
    graph = await scanProject(rootPath);
  });

  afterEach(async () => {
    if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
    else process.env.PROJECT_ATLAS_HOME = previousDataHome;
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(dataHome, { recursive: true, force: true }),
    ]);
  });

  it("rejects a symlinked destination without changing DB or proposal state", async () => {
    const proposed = await proposeMemoryUpdate({
      rootPath,
      rationale: "Exercise the memory filesystem boundary.",
      items: [
        {
          id: "atomic-symlink-guard",
          type: "constraint",
          title: "Memory symlink guard",
          summary: "Managed memory files must remain inside Atlas storage.",
          confidence: 1,
          authority: "verified",
        },
      ],
    });
    const storageRoot = projectStorageDirectory(graph.project.id);
    const localDirectory = path.join(storageRoot, "memory", "local");
    const outsideDirectory = path.join(dataHome, "outside-atlas-storage");
    await Promise.all([
      mkdir(path.dirname(localDirectory), { recursive: true }),
      mkdir(outsideDirectory, { recursive: true }),
    ]);
    await symlink(
      outsideDirectory,
      localDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      applyMemoryUpdate(rootPath, proposed.proposal.id, {
        confirmed: true,
        target: "local",
      }),
    ).rejects.toThrow(/symlink or non-directory/);
    expect(await readdir(outsideDirectory)).toEqual([]);

    const store = new AtlasStore(graph.project.id);
    try {
      expect(
        store.loadMemoryProposal(graph.project.id, proposed.proposal.id),
      ).toMatchObject({ status: "pending" });
      expect(
        store
          .listMemoryItems(
            graph.project.id,
            graph.project.identity?.checkoutId,
          )
          .some((item) => item.id === "atomic-symlink-guard"),
      ).toBe(false);
    } finally {
      store.close();
    }
  });

  it("rejects a non-regular destination without replacing it", async () => {
    const proposed = await proposeMemoryUpdate({
      rootPath,
      rationale: "Exercise the regular-file boundary.",
      items: [
        {
          id: "atomic-non-regular",
          type: "constraint",
          title: "Memory regular-file guard",
          summary: "A managed memory destination must be a regular file.",
          confidence: 1,
          authority: "verified",
        },
      ],
    });
    const destination = path.join(
      projectStorageDirectory(graph.project.id),
      "memory",
      "local",
      "atomic-non-regular.md",
    );
    await mkdir(destination, { recursive: true });

    await expect(
      applyMemoryUpdate(rootPath, proposed.proposal.id, {
        confirmed: true,
        target: "local",
      }),
    ).rejects.toThrow(/non-regular memory file/);
    expect((await lstat(destination)).isDirectory()).toBe(true);

    const store = new AtlasStore(graph.project.id);
    try {
      expect(
        store.loadMemoryProposal(graph.project.id, proposed.proposal.id),
      ).toMatchObject({ status: "pending" });
      expect(
        store.loadMemoryItem(
          graph.project.id,
          "atomic-non-regular",
          graph.project.identity?.checkoutId,
        ),
      ).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("rejects normalized and case-insensitive filename collisions preflight", async () => {
    const proposed = await proposeMemoryUpdate({
      rootPath,
      rationale: "Exercise deterministic memory filename mapping.",
      items: [
        {
          id: "Atomic:Collision",
          type: "note",
          title: "First collision candidate",
          summary: "The first candidate maps punctuation to a dash.",
          confidence: 1,
          authority: "verified",
        },
        {
          id: "atomic-collision",
          type: "note",
          title: "Second collision candidate",
          summary: "The second candidate differs only by normalized casing.",
          confidence: 1,
          authority: "verified",
        },
      ],
    });

    await expect(
      applyMemoryUpdate(rootPath, proposed.proposal.id, {
        confirmed: true,
        target: "local",
      }),
    ).rejects.toThrow(/same case-insensitive path/);
    const localDirectory = path.join(
      projectStorageDirectory(graph.project.id),
      "memory",
      "local",
    );
    await expect(lstat(localDirectory)).rejects.toMatchObject({ code: "ENOENT" });

    const store = new AtlasStore(graph.project.id);
    try {
      expect(
        store.loadMemoryProposal(graph.project.id, proposed.proposal.id),
      ).toMatchObject({ status: "pending" });
      expect(
        store
          .listMemoryItems(
            graph.project.id,
            graph.project.identity?.checkoutId,
          )
          .filter((item) =>
            ["Atomic:Collision", "atomic-collision"].includes(item.id),
          ),
      ).toEqual([]);
    } finally {
      store.close();
    }
  });

  it("restores every file and DB row after a multi-item DB failure", async () => {
    const seed = await proposeMemoryUpdate({
      rootPath,
      rationale: "Create an existing managed item for rollback coverage.",
      items: [
        {
          id: "atomic-rollback-seed",
          type: "decision",
          title: "Atomic rollback seed",
          summary: "This original content must survive a failed batch.",
          confidence: 1,
          authority: "verified",
        },
      ],
    });
    const seeded = await applyMemoryUpdate(rootPath, seed.proposal.id, {
      confirmed: true,
      target: "local",
    });
    const seedPath = path.join(
      projectStorageDirectory(graph.project.id),
      seeded.applied[0]!.path.replace(/^atlas-storage[/\\]/u, ""),
    );
    const originalSeedMarkdown = await readFile(seedPath, "utf8");

    const proposed = await proposeMemoryUpdate({
      rootPath,
      rationale: "Exercise rollback after all filesystem swaps.",
      items: [
        {
          id: "atomic-rollback-first",
          type: "decision",
          title: "Atomic rollback replacement",
          summary: "This item must not remain after the injected DB failure.",
          confidence: 1,
          authority: "verified",
          supersedes: ["atomic-rollback-seed"],
        },
        {
          id: "atomic-rollback-second",
          type: "note",
          title: "Atomic rollback companion",
          summary: "No sibling item may survive a failed batch.",
          confidence: 1,
          authority: "verified",
        },
      ],
    });
    const failingStore = new AtlasStore(graph.project.id);
    try {
      failingStore.database.exec(`
        CREATE TRIGGER fail_memory_application
        BEFORE UPDATE OF status ON memory_proposals
        WHEN NEW.status = 'applied'
        BEGIN
          SELECT RAISE(ABORT, 'forced memory application failure');
        END;
      `);
    } finally {
      failingStore.close();
    }

    await expect(
      applyMemoryUpdate(rootPath, proposed.proposal.id, {
        confirmed: true,
        target: "local",
      }),
    ).rejects.toThrow(/forced memory application failure/);
    expect(await readFile(seedPath, "utf8")).toBe(originalSeedMarkdown);
    expect(await readdir(path.dirname(seedPath))).toEqual([
      path.basename(seedPath),
    ]);

    const store = new AtlasStore(graph.project.id);
    try {
      expect(
        store.loadMemoryProposal(graph.project.id, proposed.proposal.id),
      ).toMatchObject({ status: "pending" });
      const restoredSeed = store.loadMemoryItem(
        graph.project.id,
        "atomic-rollback-seed",
        graph.project.identity?.checkoutId,
      );
      expect(restoredSeed).toMatchObject({ status: "active" });
      expect(restoredSeed?.supersededBy).toBeUndefined();
      const ids = store
        .listMemoryItems(
          graph.project.id,
          graph.project.identity?.checkoutId,
        )
        .map((item) => item.id);
      expect(ids).not.toContain("atomic-rollback-first");
      expect(ids).not.toContain("atomic-rollback-second");
    } finally {
      store.close();
    }
  });

  it("does not leave an episodic file when the outcome DB write fails", async () => {
    const failingStore = new AtlasStore(graph.project.id);
    try {
      failingStore.database.exec(`
        CREATE TRIGGER fail_outcome_insert
        BEFORE INSERT ON memory_items
        WHEN NEW.origin = 'outcome'
        BEGIN
          SELECT RAISE(ABORT, 'forced outcome failure');
        END;
      `);
    } finally {
      failingStore.close();
    }

    await expect(
      recordProjectOutcome({
        rootPath,
        taskId: "atomic-outcome-failure",
        task: "Exercise episodic rollback",
        result: "failure",
        summary: "The injected DB failure must roll the file back.",
      }),
    ).rejects.toThrow(/forced outcome failure/);

    const localDirectory = path.join(
      projectStorageDirectory(graph.project.id),
      "memory",
      "local",
    );
    await expect(lstat(localDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const store = new AtlasStore(graph.project.id);
    try {
      expect(
        store
          .listMemoryItems(
            graph.project.id,
            graph.project.identity?.checkoutId,
          )
          .some((item) => item.provenance.kind === "task-outcome"),
      ).toBe(false);
    } finally {
      store.close();
    }
  });
});
