import { spawn } from "node:child_process";
import { indexProjectMemory } from "@component-atlas/runtime";
import { projectAtlasCliEntry, projectRootPath } from "../utils/project";

interface RefreshBody {
  source?: "repository" | "memory";
}

async function refreshRepository(rootPath: string) {
  const entry = projectAtlasCliEntry();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "scan", rootPath], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Atlas scan exited with code ${code}.`));
    });
  });
  const graphSummary = JSON.parse(output) as {
    scannedAt: string;
    components: number;
    edges: Record<string, number>;
  };
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
    return refreshRepository(rootPath);
  }
  if (body.source === "memory") {
    return indexProjectMemory(rootPath);
  }
  throw createError({
    statusCode: 400,
    statusMessage: "Only repository and memory indexes can refresh locally.",
  });
});
