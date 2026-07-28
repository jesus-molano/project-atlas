import { reviewMemoryProposal } from "@component-atlas/runtime";
import { projectRootPath } from "../../utils/project";

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const proposalId =
    typeof query.proposalId === "string" ? query.proposalId.trim() : "";
  const target = query.target === "canonical" ? "canonical" : "local";
  if (!proposalId) {
    throw createError({
      statusCode: 400,
      statusMessage: "A proposalId query parameter is required.",
    });
  }
  return reviewMemoryProposal(projectRootPath(), proposalId, { target });
});
