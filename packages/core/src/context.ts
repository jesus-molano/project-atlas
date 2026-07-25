import {
  componentImpact,
  searchComponents,
  similarComponents,
} from "./graph.js";
import type {
  ComponentContextLink,
  ComponentContextReference,
  ComponentGraph,
  ComponentNode,
  ReuseContextBundle,
} from "./types.js";

function reference(component: ComponentNode): ComponentContextReference {
  return {
    id: component.id,
    name: component.effectiveName,
    path: component.relativePath,
    scope: component.visibility,
    ...(component.feature ? { owner: component.feature } : {}),
  };
}

function link(component: ComponentNode): ComponentContextLink {
  return {
    id: component.id,
    name: component.effectiveName,
    scope: component.visibility,
  };
}

function relatedComponents(
  graph: ComponentGraph,
  componentId: string,
  direction: "renders" | "rendered-by",
): ComponentContextLink[] {
  const byId = new Map(graph.components.map((component) => [component.id, component]));
  const ids = graph.edges
    .filter(
      (edge) =>
        edge.kind === "renders" &&
        (direction === "renders"
          ? edge.source === componentId
          : edge.target === componentId),
    )
    .map((edge) => (direction === "renders" ? edge.target : edge.source));
  return ids
    .map((id) => byId.get(id))
    .filter((component): component is ComponentNode => Boolean(component))
    .map(link)
    .slice(0, 5);
}

export function buildReuseContext(
  graph: ComponentGraph,
  intent: string,
  limit = 3,
): ReuseContextBundle {
  const normalizedIntent = intent.trim();
  if (!normalizedIntent) {
    throw new Error("Reuse context requires a non-empty implementation intent.");
  }
  const candidateLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 5) : 3;
  const candidates = searchComponents(graph, normalizedIntent, candidateLimit).map(
    (result, index) => {
      const impact = componentImpact(graph, result.component.id);
      return {
        rank: index + 1,
        component: reference(result.component),
        match: {
          reasons: result.reasons,
        },
        api: {
          props: result.component.props.slice(0, 8),
          totalProps: result.component.props.length,
          events: result.component.events.map((event) => event.name).slice(0, 8),
          slots: result.component.slots.slice(0, 8),
          models: result.component.models.slice(0, 8),
        },
        relations: {
          renders: relatedComponents(graph, result.component.id, "renders"),
          renderedBy: relatedComponents(graph, result.component.id, "rendered-by"),
          similar: similarComponents(graph, result.component.id)
            .slice(0, 2)
            .map((candidate) => ({
              component: link(candidate.component),
              score: candidate.evidence.score,
              reasons: candidate.evidence.reasons.slice(0, 2),
            })),
        },
        impact: {
          directConsumers: impact.directConsumers.length,
          transitiveConsumers: impact.transitiveConsumers.length,
          direct: impact.directConsumers.map(link).slice(0, 5),
        },
        tests: result.component.testPaths.slice(0, 3),
      };
    },
  );

  const top = candidates[0];
  const nextActions = top
    ? [
        `Inspect ${top.component.name} before creating a new component.`,
        ...(top.component.scope === "feature"
          ? ["Confirm feature ownership before reusing it across boundaries."]
          : []),
        ...(top.impact.transitiveConsumers > 2
          ? ["Analyze change impact before extending its public API."]
          : []),
        "Record one reuse, extend, compose, extract-and-reuse, or create decision.",
      ]
    : [
          "No indexed candidate matched. Broaden the intent with a visual pattern, likely prop, or design-system primitive.",
          "Do not create a component until repository search has also ruled out a differently named implementation.",
        ];

  return {
    schemaVersion: 1,
    intent: normalizedIntent,
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
    },
    index: {
      components: graph.components.length,
      shared: graph.components.filter((item) => item.visibility === "public").length,
      feature: graph.components.filter((item) => item.visibility === "feature").length,
      internal: graph.components.filter((item) => item.visibility === "private").length,
    },
    scopeLegend: {
      public: "Shared, reusable component",
      feature: "Owned by one product area",
      private: "Internal implementation detail",
    },
    candidates,
    nextActions,
  };
}
