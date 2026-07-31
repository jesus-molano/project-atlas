import type { DatabaseSync } from "node:sqlite";
import type { MemoryItem, MemoryProposal } from "@component-atlas/memory";

interface JsonRow {
  payload: string;
}

export interface AtlasMemoryApplication {
  supersededItems: MemoryItem[];
  appliedItems: MemoryItem[];
  proposal: MemoryProposal;
  origin?: string;
}

interface SaveMemoryApplicationOptions {
  database: DatabaseSync;
  projectId: string;
  application: AtlasMemoryApplication;
  storageIdFor: (item: MemoryItem) => string;
  writeItem: (item: MemoryItem, origin: string) => void;
  rebuildFts: () => void;
}

function validateApplication({
  projectId,
  application,
  storageIdFor,
}: Pick<
  SaveMemoryApplicationOptions,
  "projectId" | "application" | "storageIdFor"
>): void {
  const { supersededItems, appliedItems, proposal } = application;
  if (proposal.projectId !== projectId) {
    throw new Error(
      `Memory proposal ${proposal.id} belongs to a different project scope.`,
    );
  }
  if (proposal.status !== "applied") {
    throw new Error(
      `Memory proposal ${proposal.id} must be applied before it can be saved as an application.`,
    );
  }
  const proposalAppliedIds = proposal.appliedItemIds;
  const expectedAppliedIds = appliedItems.map((item) => item.id);
  if (
    proposalAppliedIds?.length !== expectedAppliedIds.length ||
    proposalAppliedIds.some((id, index) => id !== expectedAppliedIds[index])
  ) {
    throw new Error(
      `Memory proposal ${proposal.id} does not describe the supplied applied items.`,
    );
  }
  const storageIds = new Set<string>();
  for (const item of [...supersededItems, ...appliedItems]) {
    if (item.projectId !== projectId) {
      throw new Error(
        `Memory item ${item.id} belongs to a different project scope.`,
      );
    }
    const storageId = storageIdFor(item);
    if (storageIds.has(storageId)) {
      throw new Error(
        `Memory application contains duplicate storage item ${item.id}.`,
      );
    }
    storageIds.add(storageId);
  }
}

export function saveMemoryApplicationTransaction(
  options: SaveMemoryApplicationOptions,
): void {
  validateApplication(options);
  const {
    database,
    projectId,
    application: {
      supersededItems,
      appliedItems,
      proposal,
      origin = "confirmed",
    },
    writeItem,
    rebuildFts,
  } = options;
  database.exec("BEGIN IMMEDIATE");
  try {
    const currentProposal = database
      .prepare(
        "SELECT payload FROM memory_proposals WHERE project_id = ? AND id = ? AND status = 'pending'",
      )
      .get(projectId, proposal.id) as JsonRow | undefined;
    if (!currentProposal) {
      throw new Error(`Memory proposal ${proposal.id} is no longer pending.`);
    }
    const currentPayload = JSON.parse(currentProposal.payload) as MemoryProposal;
    const expectedPending: MemoryProposal = {
      ...proposal,
      status: "pending",
    };
    delete expectedPending.appliedAt;
    delete expectedPending.appliedItemIds;
    delete expectedPending.appliedTarget;
    delete expectedPending.appliedByOperation;
    if (JSON.stringify(currentPayload) !== JSON.stringify(expectedPending)) {
      throw new Error(
        `Memory proposal ${proposal.id} changed after it was reviewed.`,
      );
    }
    for (const item of supersededItems) writeItem(item, origin);
    for (const item of appliedItems) writeItem(item, origin);
    database
      .prepare(`
        UPDATE memory_proposals
        SET status = ?, payload = ?
        WHERE project_id = ? AND id = ? AND status = 'pending'
      `)
      .run(
        proposal.status,
        JSON.stringify(proposal),
        projectId,
        proposal.id,
      );
    rebuildFts();
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Memory application ${proposal.id} failed and its database rollback was incomplete.`,
        { cause: rollbackError },
      );
    }
    throw error;
  }
}
