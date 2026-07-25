import type {
  ComponentGraph,
  ComponentNode,
  ComponentSearchResult,
  GraphEdge,
  SimilarityEvidence,
} from "./types.js";
import { edgeId, tokenize } from "./text.js";

function jaccard(left: Iterable<string>, right: Iterable<string>): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function intersection(left: Iterable<string>, right: Iterable<string>): string[] {
  const b = new Set(right);
  return [...new Set(left)].filter((value) => b.has(value)).sort();
}

export function compareComponents(
  left: ComponentNode,
  right: ComponentNode,
): SimilarityEvidence {
  const sharedProps = intersection(
    left.props.map((prop) => prop.name),
    right.props.map((prop) => prop.name),
  );
  const sharedRenderedComponents = intersection(
    left.renderedNames,
    right.renderedNames,
  );
  const sharedClassTokens = intersection(left.classTokens, right.classTokens);
  const nameScore = jaccard(tokenize(left.name), tokenize(right.name));
  const propScore = jaccard(
    left.props.map((prop) => prop.name),
    right.props.map((prop) => prop.name),
  );
  const renderScore = jaccard(left.renderedNames, right.renderedNames);
  const classScore = jaccard(left.classTokens, right.classTokens);
  const shapeScore =
    left.props.length === right.props.length &&
    left.slots.length === right.slots.length &&
    left.events.length === right.events.length
      ? 1
      : 0;

  const score = Math.min(
    1,
    nameScore * 0.3 +
      propScore * 0.25 +
      renderScore * 0.2 +
      classScore * 0.15 +
      shapeScore * 0.1,
  );
  const reasons: string[] = [];
  if (nameScore >= 0.4) reasons.push("similar name");
  if (sharedProps.length > 0) reasons.push(`shared props: ${sharedProps.join(", ")}`);
  if (sharedRenderedComponents.length > 0) {
    reasons.push(`shared children: ${sharedRenderedComponents.join(", ")}`);
  }
  if (sharedClassTokens.length >= 2) {
    reasons.push(`shared style tokens: ${sharedClassTokens.slice(0, 5).join(", ")}`);
  }
  if (shapeScore === 1) reasons.push("matching public API shape");

  return {
    score: Number(score.toFixed(4)),
    reasons,
    sharedProps,
    sharedRenderedComponents,
    sharedClassTokens: sharedClassTokens.slice(0, 12),
  };
}

export function buildGraphEdges(
  components: ComponentNode[],
  similarityThreshold = 0.32,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const byName = new Map<string, ComponentNode[]>();
  for (const component of components) {
    for (const alias of [component.name, component.effectiveName]) {
      const existing = byName.get(alias) ?? [];
      existing.push(component);
      byName.set(alias, existing);
    }
  }

  for (const component of components) {
    for (const renderedName of new Set(component.renderedNames)) {
      const targets = byName.get(renderedName) ?? [];
      for (const target of targets) {
        if (target.id === component.id) continue;
        edges.push({
          id: edgeId("renders", component.id, target.id),
          kind: "renders",
          source: component.id,
          target: target.id,
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    const left = components[leftIndex];
    if (!left) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < components.length;
      rightIndex += 1
    ) {
      const right = components[rightIndex];
      if (!right) continue;
      const evidence = compareComponents(left, right);
      if (evidence.score < similarityThreshold) continue;
      edges.push({
        id: edgeId("similar_to", left.id, right.id),
        kind: "similar_to",
        source: left.id,
        target: right.id,
        evidence,
      });
    }
  }

  for (const component of components) {
    for (const testPath of component.testPaths) {
      const target = `test:${testPath}`;
      edges.push({
        id: edgeId("tested_by", component.id, target),
        kind: "tested_by",
        source: component.id,
        target,
      });
    }
  }

  return dedupeEdges(edges);
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  return [...new Map(edges.map((edge) => [edge.id, edge])).values()];
}

function includesTerm(component: ComponentNode, term: string): string[] {
  const hits: string[] = [];
  if (component.name.toLowerCase().includes(term)) hits.push("name");
  if (component.effectiveName.toLowerCase().includes(term)) hits.push("runtime name");
  if (component.relativePath.toLowerCase().includes(term)) hits.push("path");
  if (component.props.some((prop) => prop.name.toLowerCase().includes(term))) {
    hits.push("prop");
  }
  if (component.renderedNames.some((name) => name.toLowerCase().includes(term))) {
    hits.push("rendered component");
  }
  if (component.imports.some((name) => name.toLowerCase().includes(term))) {
    hits.push("import");
  }
  if (component.testPaths.some((testPath) => testPath.toLowerCase().includes(term))) {
    hits.push("test");
  }
  return hits;
}

export function searchComponents(
  graph: ComponentGraph,
  query: string,
  limit = 10,
): ComponentSearchResult[] {
  const queryStopwords = new Set([
    "and",
    "de",
    "del",
    "el",
    "en",
    "for",
    "la",
    "las",
    "los",
    "of",
    "para",
    "por",
    "the",
    "to",
    "una",
  ]);
  const conceptGroups = [
    ["dialog", "modal", "sheet", "confirm", "confirmation"],
    ["delete", "remove", "destroy", "eliminar", "borrar"],
    ["fingerprint", "biometric", "biometrics", "finger", "huella"],
    ["authentication", "security", "twofactor", "2fa"],
    ["input", "field", "textbox", "campo"],
    ["button", "action", "cta", "boton"],
  ];
  const directTerms = tokenize(query).filter(
    (term) => !queryStopwords.has(term),
  );
  const terms = [
    ...new Set(
      directTerms.flatMap((term) => {
        const group = conceptGroups.find((candidate) =>
          candidate.includes(term),
        );
        return group ?? [term];
      }),
    ),
  ];
  if (terms.length === 0) return [];

  return graph.components
    .filter((component) => (component.kind ?? "component") === "component")
    .map((component) => {
      const reasons = terms.flatMap((term) => includesTerm(component, term));
      const nameTokens = tokenize(`${component.name} ${component.effectiveName}`);
      const matchedNameTerms = terms.filter((term) =>
        nameTokens.some((token) => token.includes(term) || term.includes(token)),
      );
      const matchScore =
        matchedNameTerms.length * 4 +
        reasons.filter((reason) => reason === "name").length * 3 +
        reasons.filter((reason) => reason === "runtime name").length * 2 +
        reasons.filter((reason) => reason === "import").length * 2 +
        reasons.length;
      let score = matchScore;
      if (component.visibility === "public") score += 1.5;
      if (component.visibility === "private") score -= 0.25;
      return {
        component,
        score: matchScore > 0 ? score : 0,
        reasons: [...new Set(reasons)],
      };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.component.name.localeCompare(right.component.name),
    )
    .slice(0, limit);
}

export function findComponent(
  graph: ComponentGraph,
  selector: string,
): ComponentNode | undefined {
  const normalized = selector.toLowerCase();
  return graph.components.find(
    (component) =>
      component.id === selector ||
      component.name.toLowerCase() === normalized ||
      component.effectiveName.toLowerCase() === normalized ||
      component.relativePath.toLowerCase() === normalized,
  );
}

export function similarComponents(
  graph: ComponentGraph,
  componentId: string,
): Array<{ component: ComponentNode; evidence: SimilarityEvidence }> {
  const byId = new Map(graph.components.map((component) => [component.id, component]));
  return graph.edges
    .filter(
      (edge) =>
        edge.kind === "similar_to" &&
        (edge.source === componentId || edge.target === componentId) &&
        edge.evidence,
    )
    .map((edge) => {
      const otherId = edge.source === componentId ? edge.target : edge.source;
      return { component: byId.get(otherId), evidence: edge.evidence };
    })
    .filter(
      (
        result,
      ): result is { component: ComponentNode; evidence: SimilarityEvidence } =>
        Boolean(result.component && result.evidence),
    )
    .sort((left, right) => right.evidence.score - left.evidence.score);
}

export function componentImpact(
  graph: ComponentGraph,
  componentId: string,
): {
  directConsumers: ComponentNode[];
  transitiveConsumers: ComponentNode[];
} {
  const byId = new Map(graph.components.map((component) => [component.id, component]));
  const reverse = new Map<string, Set<string>>();
  for (const edge of graph.edges.filter((edge) => edge.kind === "renders")) {
    const consumers = reverse.get(edge.target) ?? new Set<string>();
    consumers.add(edge.source);
    reverse.set(edge.target, consumers);
  }
  const directIds = [...(reverse.get(componentId) ?? [])];
  const visited = new Set<string>(directIds);
  const queue = [...directIds];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const parent of reverse.get(current) ?? []) {
      if (visited.has(parent)) continue;
      visited.add(parent);
      queue.push(parent);
    }
  }
  return {
    directConsumers: directIds
      .map((id) => byId.get(id))
      .filter((node): node is ComponentNode => Boolean(node)),
    transitiveConsumers: [...visited]
      .map((id) => byId.get(id))
      .filter((node): node is ComponentNode => Boolean(node)),
  };
}
