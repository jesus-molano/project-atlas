import { indexProjectMemory } from "@component-atlas/runtime";
import { runBoundedProcess } from "../utils/bounded-process";
import { projectAtlasCliEntry, projectRootPath } from "../utils/project";

interface RefreshBody {
  source?: "repository" | "memory";
}

function isGraphSummary(value: unknown): value is {
  scannedAt: string;
  components: number;
  edges: Record<string, number>;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.scannedAt === "string" &&
    typeof candidate.components === "number" &&
    candidate.edges !== null &&
    typeof candidate.edges === "object" &&
    Object.values(candidate.edges as Record<string, unknown>).every(
      (count) => typeof count === "number" && Number.isFinite(count),
    )
  );
}

async function refreshRepository(rootPath: string, signal?: AbortSignal) {
  const entry = projectAtlasCliEntry();
  const { stdout } = await runBoundedProcess(
    process.execPath,
    [entry, "scan", rootPath],
    { signal },
  );
  const graphSummary = JSON.parse(stdout) as unknown;
  if (!isGraphSummary(graphSummary)) {
    throw new Error("Atlas scan returned an invalid graph summary.");
  }
  return {
    source: "repository",
    status: "refreshed",
    indexedAt: graphSummary.scannedAt,
    components: graphSummary.components,
    relations: Object.values(graphSummary.edges).reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RefreshBody>(event);
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: "Request body is required." });
  }
  const rootPath = projectRootPath();
  if (body.source === "repository") {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const request = event.node?.req;
    request?.once("aborted", abort);
    try {
      return await refreshRepository(rootPath, controller.signal);
    } finally {
      request?.removeListener("aborted", abort);
    }
  }
  if (body.source === "memory") {
    return indexProjectMemory(rootPath);
  }
  throw createError({
    statusCode: 400,
    statusMessage: "Only repository and memory indexes can refresh locally.",
  });
});
