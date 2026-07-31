import {
  applyMemoryUpdate,
  combineMemoryProposals,
  rejectMemoryUpdate,
  reviseMemoryProposal,
} from "@component-atlas/runtime";
import type { MemoryItemDraft } from "@component-atlas/memory";
import { assertLocalSession } from "../utils/local-session";
import { projectRootPath } from "../utils/project";

type MemoryProposalAction =
  | {
      action: "apply";
      proposalId: string;
      confirmed: boolean;
      target?: "local" | "canonical";
      canonicalConfirmed?: boolean;
    }
  | {
      action: "reject";
      proposalId: string;
      confirmed: boolean;
      reason: string;
    }
  | {
      action: "revise";
      proposalId: string;
      rationale: string;
      evidence?: string[];
      items: MemoryItemDraft[];
    }
  | {
      action: "combine";
      proposalId: string;
      sourceProposalId: string;
      confirmed: boolean;
    };

export default defineEventHandler(async (event) => {
  assertLocalSession(event);
  const body = await readBody<MemoryProposalAction>(event);
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: "Request body is required." });
  }
  const rootPath = projectRootPath();
  switch (body.action) {
    case "apply":
      return applyMemoryUpdate(rootPath, body.proposalId, {
        confirmed: body.confirmed,
        ...(body.target ? { target: body.target } : {}),
        ...(body.canonicalConfirmed !== undefined
          ? { canonicalConfirmed: body.canonicalConfirmed }
          : {}),
      });
    case "reject":
      return rejectMemoryUpdate(rootPath, body.proposalId, {
        confirmed: body.confirmed,
        reason: body.reason,
      });
    case "revise":
      return reviseMemoryProposal({
        rootPath,
        proposalId: body.proposalId,
        rationale: body.rationale,
        ...(body.evidence ? { evidence: body.evidence } : {}),
        items: body.items,
      });
    case "combine":
      return combineMemoryProposals({
        rootPath,
        targetProposalId: body.proposalId,
        sourceProposalId: body.sourceProposalId,
        confirmed: body.confirmed,
      });
  }
});
