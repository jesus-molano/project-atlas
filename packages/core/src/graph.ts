import type {
  ComponentGraph,
  ComponentNode,
  ComponentSearchResult,
  GraphEdge,
  SimilarityEvidence,
} from "./types.js";
import { edgeId, tokenize } from "./text.js";

const MAX_SIMILARITY_NEIGHBORS_PER_SIGNAL = 20;
const MAX_SIMILARITY_CANDIDATES_PER_COMPONENT = 8;

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

function routingScope(component: ComponentNode): string {
  const normalized = component.relativePath.replaceAll("\\", "/").toLowerCase();
  const markers = [
    "src/app/",
    "app/",
    "src/pages/",
    "pages/",
    "src/layouts/",
    "layouts/",
  ];
  const matches = markers
    .flatMap((marker) => {
      const atRoot = normalized.startsWith(marker) ? 0 : -1;
      const nested = normalized.indexOf(`/${marker}`);
      const index = atRoot >= 0 ? atRoot : nested >= 0 ? nested + 1 : -1;
      return index >= 0 ? [{ index, marker }] : [];
    })
    .sort((left, right) => left.index - right.index);
  const match = matches[0];
  if (!match) return normalized.split("/").slice(0, -1).join("/");
  const packageScope = normalized.slice(0, match.index);
  if (component.framework !== "react") return packageScope;
  return `${packageScope}#${
    match.marker === "src/app/" || match.marker === "app/" ? "app" : "pages"
  }`;
}

function routeContains(parentPath: string, childPath: string): boolean {
  const normalizedParent = parentPath.replace(/\/$/u, "") || "/";
  return (
    normalizedParent === "/" ||
    childPath === normalizedParent ||
    childPath.startsWith(`${normalizedParent}/`)
  );
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
  const bySourcePath = new Map<string, ComponentNode[]>();
  for (const component of components) {
    for (const alias of new Set([component.name, component.effectiveName])) {
      const existing = byName.get(alias) ?? [];
      existing.push(component);
      byName.set(alias, existing);
    }
    const sourceKey = component.sourcePath.replaceAll("\\", "/").toLowerCase();
    const sourceNodes = bySourcePath.get(sourceKey) ?? [];
    sourceNodes.push(component);
    bySourcePath.set(sourceKey, sourceNodes);
  }

  for (const component of components) {
    for (const renderedName of new Set(component.renderedNames)) {
      const sameFileTargets = (bySourcePath.get(
        component.sourcePath.replaceAll("\\", "/").toLowerCase(),
      ) ?? []).filter(
        (target) =>
          target.id !== component.id &&
          [target.name, target.effectiveName].includes(renderedName),
      );
      const binding = component.importBindings?.find(
        (candidate) => candidate.local === renderedName,
      );
      const importedTargets = binding?.resolvedPath
        ? (bySourcePath.get(
            binding.resolvedPath.replaceAll("\\", "/").toLowerCase(),
          ) ?? []).filter(
            (target) =>
              (binding.imported === "default" && target.exportName === "default") ||
              [target.name, target.effectiveName].includes(binding.imported),
          )
        : [];
      const exactTargets = [...sameFileTargets, ...importedTargets].filter(
        (target, index, collection) =>
          collection.findIndex((candidate) => candidate.id === target.id) === index,
      );
      const conventionalTargets = byName.get(renderedName) ?? [];
      const targets =
        exactTargets.length > 0
          ? exactTargets
          : conventionalTargets.length === 1
            ? conventionalTargets
            : [];
      for (const target of targets) {
        if (target.id === component.id) continue;
        const resolution =
          exactTargets.length > 0 ? ("exact" as const) : ("framework-convention" as const);
        edges.push({
          id: edgeId("renders", component.id, target.id),
          kind: "renders",
          source: component.id,
          target: target.id,
          resolution,
          provenance: {
            sourcePath: component.relativePath,
            symbol: renderedName,
          },
        });
        if (component.kind === "route" && target.kind === "layout") {
          edges.push({
            id: edgeId("uses_layout", component.id, target.id),
            kind: "uses_layout",
            source: component.id,
            target: target.id,
            resolution,
            provenance: {
              sourcePath: component.relativePath,
              symbol: renderedName,
            },
          });
        }
        const directive = component.renderReferences?.find(
          (reference) => reference.name === renderedName,
        )?.directive;
        if (directive?.startsWith("client:") || directive === "server:defer") {
          const kind = directive === "server:defer" ? "defers" : "hydrates";
          edges.push({
            id: edgeId(kind, component.id, target.id),
            kind,
            source: component.id,
            target: target.id,
            resolution,
            provenance: {
              sourcePath: component.relativePath,
              symbol: directive,
            },
          });
        }
      }
    }
  }

  const layouts = components.filter(
    (component) => component.kind === "layout" && component.routePath !== undefined,
  );
  const routes = components.filter(
    (component) => component.kind === "route" && component.routePath !== undefined,
  );
  for (const route of routes) {
    const routePath = route.routePath ?? "/";
    const scope = routingScope(route);
    const layout = layouts
      .filter(
        (candidate) =>
          candidate.framework === route.framework &&
          routingScope(candidate) === scope &&
          routeContains(candidate.routePath ?? "/", routePath),
      )
      .sort(
        (left, right) =>
          (right.routePath?.length ?? 0) - (left.routePath?.length ?? 0),
      )[0];
    if (layout) {
      edges.push({
        id: edgeId("uses_layout", route.id, layout.id),
        kind: "uses_layout",
        source: route.id,
        target: layout.id,
        resolution: "framework-convention",
        provenance: { sourcePath: route.relativePath },
      });
    }
    const parent = routes
      .filter(
        (candidate) =>
          candidate.id !== route.id &&
          candidate.framework === route.framework &&
          routingScope(candidate) === scope &&
          candidate.routePath !== undefined &&
          candidate.routePath !== routePath &&
          routePath.startsWith(
            candidate.routePath === "/"
              ? "/"
              : `${candidate.routePath.replace(/\/$/u, "")}/`,
          ),
      )
      .sort(
        (left, right) =>
          (right.routePath?.length ?? 0) - (left.routePath?.length ?? 0),
      )[0];
    if (parent) {
      edges.push({
        id: edgeId("route_parent", route.id, parent.id),
        kind: "route_parent",
        source: route.id,
        target: parent.id,
        resolution: "framework-convention",
        provenance: { sourcePath: route.relativePath },
      });
    }
  }

  edges.push(
    ...boundedSimilarityEdges(components, similarityThreshold),
  );

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

function similaritySignals(component: ComponentNode): string[] {
  const signals = [
    ...tokenize(`${component.name} ${component.effectiveName}`).map(
      (value) => `name:${value}`,
    ),
    ...component.props.map((prop) => `prop:${prop.name.toLowerCase()}`),
    ...component.renderedNames.map(
      (value) => `render:${value.toLowerCase()}`,
    ),
    ...component.classTokens
      .slice(0, 12)
      .map((value) => `class:${value.toLowerCase()}`),
    `shape:${component.props.length}:${component.slots.length}:${component.events.length}`,
  ];
  return [...new Set(signals)];
}

function boundedSimilarityEdges(
  components: ComponentNode[],
  similarityThreshold: number,
): GraphEdge[] {
  const reusableComponents = components.filter(
    (component) => (component.kind ?? "component") === "component",
  );
  const byId = new Map(
    reusableComponents.map((component) => [component.id, component]),
  );
  const buckets = new Map<string, string[]>();
  for (const component of reusableComponents) {
    for (const signal of similaritySignals(component)) {
      const bucket = buckets.get(signal) ?? [];
      bucket.push(component.id);
      buckets.set(signal, bucket);
    }
  }
  const candidates = new Map<string, Set<string>>();
  for (const bucket of buckets.values()) {
    const ids = [...new Set(bucket)].sort();
    for (let index = 0; index < ids.length; index += 1) {
      const source = ids[index]!;
      const sourceCandidates = candidates.get(source) ?? new Set<string>();
      const start = Math.max(
        0,
        index - MAX_SIMILARITY_NEIGHBORS_PER_SIGNAL,
      );
      const end = Math.min(
        ids.length,
        index + MAX_SIMILARITY_NEIGHBORS_PER_SIGNAL + 1,
      );
      for (let neighbor = start; neighbor < end; neighbor += 1) {
        const target = ids[neighbor]!;
        if (target !== source) sourceCandidates.add(target);
      }
      candidates.set(source, sourceCandidates);
    }
  }

  const evidenceByPair = new Map<
    string,
    {
      source: string;
      target: string;
      evidence: SimilarityEvidence;
    }
  >();
  const selectedPairIds = new Set<string>();
  for (const component of reusableComponents) {
    const ranked = [...(candidates.get(component.id) ?? [])]
      .map((candidateId) => {
        const candidate = byId.get(candidateId);
        if (!candidate) return undefined;
        const [source, target] = [component.id, candidate.id].sort();
        const pairId = edgeId("similar_to", source!, target!);
        let pair = evidenceByPair.get(pairId);
        if (!pair) {
          pair = {
            source: source!,
            target: target!,
            evidence: compareComponents(component, candidate),
          };
          evidenceByPair.set(pairId, pair);
        }
        return { pairId, candidateId, evidence: pair.evidence };
      })
      .filter(
        (
          result,
        ): result is {
          pairId: string;
          candidateId: string;
          evidence: SimilarityEvidence;
        } =>
          Boolean(result && result.evidence.score >= similarityThreshold),
      )
      .sort(
        (left, right) =>
          right.evidence.score - left.evidence.score ||
          left.candidateId.localeCompare(right.candidateId),
      )
      .slice(0, MAX_SIMILARITY_CANDIDATES_PER_COMPONENT);
    for (const result of ranked) selectedPairIds.add(result.pairId);
  }
  return [...selectedPairIds]
    .map((pairId) => {
      const pair = evidenceByPair.get(pairId)!;
      return {
        id: pairId,
        kind: "similar_to" as const,
        source: pair.source,
        target: pair.target,
        evidence: pair.evidence,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
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
  const searchable = graph.components.filter(
    (component) => (component.kind ?? "component") === "component",
  );
  const normalizedQuery = query.trim().replace(/\\/gu, "/").toLowerCase();
  const exactMatches = searchable
    .map((component) => {
      const path = component.relativePath.replace(/\\/gu, "/").toLowerCase();
      const basename = path.split("/").at(-1) ?? path;
      const exactName =
        component.name.toLowerCase() === normalizedQuery ||
        component.effectiveName.toLowerCase() === normalizedQuery;
      const exactPath =
        path === normalizedQuery || basename === normalizedQuery;
      return exactName || exactPath
        ? {
            component,
            score: exactPath ? 102 : 100,
            reasons: [exactPath ? "exact path" : "exact name"],
          }
        : undefined;
    })
    .filter((result): result is ComponentSearchResult => Boolean(result))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.component.name.localeCompare(right.component.name),
    );
  if (exactMatches.length > 0) return exactMatches.slice(0, limit);

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

  return searchable
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
  const directIds = [...(reverse.get(componentId) ?? [])].filter(
    (id) => id !== componentId,
  );
  const visited = new Set<string>([componentId, ...directIds]);
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
      .filter((id) => id !== componentId)
      .map((id) => byId.get(id))
      .filter((node): node is ComponentNode => Boolean(node)),
  };
}
