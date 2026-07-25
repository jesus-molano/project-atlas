import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectId } from "@component-atlas/core/naming";
import type { PreviewScenario } from "@component-atlas/core/types";
import { AtlasStore } from "@component-atlas/store";

interface ScenarioBody {
  id?: string;
  componentId: string;
  componentName: string;
  name: string;
  props: Record<string, unknown>;
  tokens: Record<string, string>;
  viewport: { width: number; height: number };
  background: string;
  notes?: string;
}

export default defineEventHandler(async (event) => {
  const rootPath = process.env.ATLAS_PROJECT_ROOT;
  if (!rootPath) {
    throw createError({
      statusCode: 503,
      statusMessage: "ATLAS_PROJECT_ROOT is missing.",
    });
  }
  const body = await readBody<ScenarioBody>(event);
  if (!body) {
    throw createError({
      statusCode: 400,
      statusMessage: "Scenario body is required.",
    });
  }
  if (!body.componentId || !body.name.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: "componentId and scenario name are required.",
    });
  }
  if (
    !body.viewport ||
    !Number.isInteger(body.viewport.width) ||
    !Number.isInteger(body.viewport.height) ||
    body.viewport.width < 240 ||
    body.viewport.width > 2560 ||
    body.viewport.height < 200 ||
    body.viewport.height > 1600
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Viewport must be between 240x200 and 2560x1600.",
    });
  }
  const scenarioName = body.name.trim();
  const id = projectId(rootPath);
  const store = new AtlasStore(id);
  const graph = store.loadGraph(id);
  const component = graph?.components.find((item) => item.id === body.componentId);
  if (!component) {
    store.close();
    throw createError({
      statusCode: 404,
      statusMessage: "Indexed component was not found.",
    });
  }
  const now = new Date().toISOString();
  const existing = body.id
    ? store
        .listScenarios(id, body.componentId)
        .find((scenario) => scenario.id === body.id)
    : undefined;
  const scenarioId =
    body.id ??
    createHash("sha256")
      .update(`${id}\0${body.componentId}\0${scenarioName}`)
      .digest("hex")
      .slice(0, 24);
  const scenario: PreviewScenario = {
    id: scenarioId,
    projectId: id,
    componentId: body.componentId,
    name: scenarioName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    props: body.props ?? {},
    tokens: body.tokens ?? {},
    viewport: body.viewport,
    background: body.background,
    ...(body.notes ? { notes: body.notes } : {}),
  };
  try {
    store.saveScenario(scenario);
  } finally {
    store.close();
  }
  const directory = path.join(rootPath, ".component-atlas", "scenarios");
  await mkdir(directory, { recursive: true });
  const fileName = `${body.componentName}-${scenario.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  await writeFile(
    path.join(directory, `${fileName || scenario.id}.json`),
    `${JSON.stringify(scenario, null, 2)}\n`,
    "utf8",
  );
  return scenario;
});
