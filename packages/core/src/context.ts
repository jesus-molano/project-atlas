import {
  componentImpact,
  findComponent,
  searchComponents,
  similarComponents,
} from "./graph.js";
import type {
  CompactComponentSearchResult,
  ComponentContextBundle,
  ComponentImpactContext,
  ComponentContextLink,
  ComponentContextReference,
  ComponentGraph,
  ComponentNode,
  ComponentSimilarityContext,
  ReuseContextCandidate,
  ReuseContextBundle,
} from "./types.js";

export function componentContextReference(
  component: ComponentNode,
): ComponentContextReference {
  return {
    id: component.id,
    name: component.effectiveName,
    path: component.relativePath,
    scope: component.visibility,
    ...(component.feature ? { owner: component.feature } : {}),
  };
}

export function componentContextLink(
  component: ComponentNode,
): ComponentContextLink {
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
    .map(componentContextLink)
    .slice(0, 5);
}

function boundedLimit(value: number, fallback: number, maximum: number): number {
  return Number.isInteger(value) && value > 0
    ? Math.min(value, maximum)
    : fallback;
}

function componentApi(component: ComponentNode): ReuseContextCandidate["api"] {
  return {
    props: component.props.slice(0, 8),
    totalProps: component.props.length,
    events: component.events.slice(0, 8),
    totalEvents: component.events.length,
    slots: component.slots.slice(0, 8),
    models: component.models.slice(0, 8),
  };
}

function candidateContext(
  graph: ComponentGraph,
  component: ComponentNode,
  rank: number,
  reasons: string[],
): ReuseContextCandidate {
  const impact = componentImpact(graph, component.id);
  return {
    rank,
    component: componentContextReference(component),
    match: { reasons },
    api: componentApi(component),
    relations: {
      renders: relatedComponents(graph, component.id, "renders"),
      renderedBy: relatedComponents(graph, component.id, "rendered-by"),
      similar: similarComponents(graph, component.id)
        .slice(0, 2)
        .map((candidate) => ({
          component: componentContextLink(candidate.component),
          score: candidate.evidence.score,
          reasons: candidate.evidence.reasons.slice(0, 2),
        })),
    },
    impact: {
      directConsumers: impact.directConsumers.length,
      transitiveConsumers: impact.transitiveConsumers.length,
      direct: impact.directConsumers.map(componentContextLink).slice(0, 5),
    },
    tests: component.testPaths.slice(0, 3),
  };
}

export function searchComponentContext(
  graph: ComponentGraph,
  query: string,
  limit = 10,
): CompactComponentSearchResult[] {
  return searchComponents(graph, query, boundedLimit(limit, 10, 50)).map((result) => ({
    component: componentContextReference(result.component),
    score: result.score,
    reasons: result.reasons,
  }));
}

export function buildComponentContext(
  graph: ComponentGraph,
  selector: string,
): ComponentContextBundle {
  const component = findComponent(graph, selector);
  if (!component) {
    throw new Error(`Component "${selector}" was not found in ${graph.project.name}.`);
  }
  const candidate = candidateContext(graph, component, 1, ["exact component"]);
  const guidance = [
    ...(component.visibility === "private"
      ? ["Do not reuse this internal component across feature boundaries."]
      : []),
    ...(component.visibility === "feature"
      ? ["Confirm feature ownership before cross-feature reuse."]
      : []),
    ...(candidate.impact.transitiveConsumers > 2
      ? ["Analyze change impact before modifying its public API."]
      : []),
  ];
  return {
    schemaVersion: 1,
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
    },
    component: candidate.component,
    api: candidate.api,
    relations: candidate.relations,
    impact: candidate.impact,
    tests: candidate.tests,
    guidance,
  };
}

export function buildImpactContext(
  graph: ComponentGraph,
  selector: string,
): ComponentImpactContext {
  const component = findComponent(graph, selector);
  if (!component) {
    throw new Error(`Component "${selector}" was not found in ${graph.project.name}.`);
  }
  const impact = componentImpact(graph, component.id);
  const total = impact.transitiveConsumers.length;
  return {
    component: componentContextReference(component),
    api: componentApi(component),
    tests: component.testPaths.slice(0, 3),
    risk: total >= 8 ? "high" : total >= 3 ? "moderate" : "contained",
    directConsumers: impact.directConsumers.length,
    transitiveConsumers: total,
    direct: impact.directConsumers.map(componentContextLink).slice(0, 10),
    transitive: impact.transitiveConsumers.map(componentContextLink).slice(0, 20),
  };
}

export function buildSimilarityContext(
  graph: ComponentGraph,
  selector: string,
  limit = 5,
): ComponentSimilarityContext {
  const component = findComponent(graph, selector);
  if (!component) {
    throw new Error(`Component "${selector}" was not found in ${graph.project.name}.`);
  }
  return {
    component: componentContextReference(component),
    candidates: similarComponents(graph, component.id)
      .slice(0, boundedLimit(limit, 5, 20))
      .map((candidate) => ({
        component: componentContextReference(candidate.component),
        score: candidate.evidence.score,
        reasons: candidate.evidence.reasons.slice(0, 3),
      })),
  };
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
  const candidateLimit = boundedLimit(limit, 3, 5);
  const candidates = searchComponents(graph, normalizedIntent, candidateLimit).map(
    (result, index) =>
      candidateContext(graph, result.component, index + 1, result.reasons),
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
