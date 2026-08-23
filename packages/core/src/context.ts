import {
  componentImpact,
  findComponent,
  searchComponents,
  similarComponents,
} from "./graph.js";
import type {
  CompactComponentSearchResult,
  ChangeSurfaceBundle,
  ComponentContextBundle,
  ComponentImpactContext,
  ComponentContextLink,
  ComponentContextReference,
  ComponentGraph,
  ComponentNode,
  ComponentSimilarityContext,
  ReuseContextCandidate,
  ReuseContextArea,
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
    kind: component.kind ?? "component",
    ...(component.role ? { role: component.role } : {}),
    ...(component.runtime ? { runtime: component.runtime } : {}),
    ...(component.routePath ? { routePath: component.routePath } : {}),
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
    kind: component.kind ?? "component",
  };
}

function compactProjectProfile(graph: ComponentGraph) {
  if (!graph.project.profile && !graph.project.scan?.coverage) return undefined;
  return {
    frameworks: graph.project.profile?.frameworks ?? [graph.project.framework],
    metaFrameworks: [
      ...new Set(
        graph.project.profile?.packages.flatMap((packageProfile) =>
          packageProfile.metaFramework ? [packageProfile.metaFramework] : [],
        ) ?? [],
      ),
    ],
    confidence: graph.project.profile?.confidence ?? "low",
    ...(graph.project.scan?.coverage
      ? {
          coverage: {
            candidateFiles: graph.project.scan.coverage.candidateFiles,
            parsedFiles: graph.project.scan.coverage.parsedFiles,
            skippedFiles: graph.project.scan.coverage.skippedFiles,
            errorFiles: graph.project.scan.coverage.errorFiles,
            complete: graph.project.scan.coverage.complete,
          },
        }
      : {}),
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
  const projectProfile = compactProjectProfile(graph);
  return {
    schemaVersion: 1,
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
      ...(projectProfile ? { profile: projectProfile } : {}),
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
  const exclusions = [
    ...normalizedIntent.matchAll(
      /(?:\bexclude\b|\bexcluding\b|\bexcept\b|\bwithout\b|\bdo not touch\b|\bdon't touch\b|\boutside (?:the )?scope\b|\bfuera de alcance\b|\bsin\b)\s+([^,.;]+)/giu,
    ),
  ].flatMap((match) =>
    (match[1] ?? "")
      .split(/\s+/u)
      .map((term) => term.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, ""))
      .filter(
        (term) =>
          term.length > 2 &&
          !["and", "con", "del", "from", "the", "todo", "touch"].includes(term),
      ),
  );
  const rankedCandidates = searchComponents(
    graph,
    normalizedIntent,
    50,
  )
    .filter((result) => {
      if (exclusions.length === 0) return true;
      const searchable = [
        result.component.name,
        result.component.effectiveName,
        result.component.relativePath,
        ...result.component.imports,
        ...result.component.renderedNames,
      ]
        .join(" ")
        .toLowerCase();
      return !exclusions.some((term) => searchable.includes(term));
    });
  const areaId = (component: ComponentNode): string => {
    if (component.feature?.trim()) return component.feature.trim().toLowerCase();
    const featurePath = component.relativePath
      .replaceAll("\\", "/")
      .match(/(?:^|\/)features\/([^/]+)/iu)?.[1];
    if (featurePath) return featurePath.toLowerCase();
    return component.visibility === "public" ? "shared" : "unowned";
  };
  const areaCandidates = new Map<string, typeof rankedCandidates>();
  for (const candidate of rankedCandidates) {
    const id = areaId(candidate.component);
    const existing = areaCandidates.get(id) ?? [];
    existing.push(candidate);
    areaCandidates.set(id, existing);
  }
  const areas: ReuseContextArea[] = [...areaCandidates.entries()]
    .slice(0, 8)
    .map(([id, matches]) => ({
      id,
      candidateCount: matches.length,
      topCandidateIds: matches.slice(0, 2).map((match) => match.component.id),
    }));
  const selected = [] as typeof rankedCandidates;
  const selectedIds = new Set<string>();
  const selectedAreas = new Set<string>();
  for (const candidate of rankedCandidates) {
    const id = areaId(candidate.component);
    if (selectedAreas.has(id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.component.id);
    selectedAreas.add(id);
    if (selected.length >= candidateLimit) break;
  }
  for (const candidate of rankedCandidates) {
    if (selected.length >= candidateLimit) break;
    if (selectedIds.has(candidate.component.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.component.id);
  }
  const candidates = selected.map((result, index) =>
    candidateContext(graph, result.component, index + 1, result.reasons),
  );

  const top = candidates[0];
  const nextActions = top
    ? [
        ...(areas.length > 1
          ? [
              `Compare the leading candidates across ${areas
                .slice(0, 4)
                .map((area) => area.id)
                .join(", ")} before selecting one component.`,
            ]
          : []),
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
  const projectProfile = compactProjectProfile(graph);
  const reusableComponents = graph.components.filter(
    (component) => (component.kind ?? "component") === "component",
  );

  return {
    schemaVersion: 1,
    intent: normalizedIntent,
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
      ...(projectProfile ? { profile: projectProfile } : {}),
    },
    index: {
      components: reusableComponents.length,
      shared: reusableComponents.filter((item) => item.visibility === "public").length,
      feature: reusableComponents.filter((item) => item.visibility === "feature").length,
      internal: reusableComponents.filter((item) => item.visibility === "private").length,
    },
    scopeLegend: {
      public: "Shared, reusable component",
      feature: "Owned by one product area",
      private: "Internal implementation detail",
    },
    areas,
    candidates,
    nextActions,
  };
}

export function buildChangeSurface(
  graph: ComponentGraph,
  intent: string,
  options: {
    primaryComponent?: string;
    secondaryComponents?: string[];
    outOfScope?: string[];
    primarySurface?: NonNullable<ChangeSurfaceBundle["primarySurface"]>;
    allowedFiles?: string[];
  } = {},
): ChangeSurfaceBundle {
  const normalizedIntent = intent.trim();
  if (!normalizedIntent) {
    throw new Error("Change surface requires a non-empty implementation intent.");
  }
  const ranked = options.primarySurface
    ? []
    : searchComponents(graph, normalizedIntent, 4);
  const explicitPrimary = options.primaryComponent
    ? findComponent(graph, options.primaryComponent)
    : undefined;
  if (options.primaryComponent && !explicitPrimary) {
    throw new Error(
      `Primary component "${options.primaryComponent}" was not found.`,
    );
  }
  const primary = explicitPrimary ?? ranked[0]?.component;
  const primaryContext = primary
    ? candidateContext(
        graph,
        primary,
        1,
        explicitPrimary
          ? ["Explicit primary implementation scope"]
          : ranked[0]?.reasons ?? [],
      )
    : undefined;
  const explicitSecondary = (options.secondaryComponents ?? [])
    .slice(0, 2)
    .map((selector) => {
      const component = findComponent(graph, selector);
      if (!component) {
        throw new Error(`Secondary component "${selector}" was not found.`);
      }
      return component;
    });
  const secondaryIds = new Set(explicitSecondary.map((item) => item.id));
  const excludedIds = new Set(
    (options.outOfScope ?? [])
      .map((selector) => findComponent(graph, selector)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const alternatives = ranked
    .map((item) => item.component)
    .filter(
      (item) =>
        item.id !== primary?.id &&
        !secondaryIds.has(item.id) &&
        !excludedIds.has(item.id),
    )
    .slice(0, explicitSecondary.length > 0 ? 0 : 2);
  const references: ChangeSurfaceBundle["references"] = [
    ...explicitSecondary.map((component) => ({
      component: componentContextReference(component),
      role: "secondary-reference" as const,
      reasons: ["Explicit reference only; do not expand its feature scope."],
    })),
    ...alternatives.map((component) => ({
      component: componentContextReference(component),
      role: "alternative" as const,
      reasons:
        ranked.find((item) => item.component.id === component.id)?.reasons.slice(
          0,
          2,
        ) ?? [],
    })),
  ];
  const files: ChangeSurfaceBundle["files"] = [];
  const addFile = (
    filePath: string | undefined,
    role: ChangeSurfaceBundle["files"][number]["role"],
    componentId?: string,
  ) => {
    if (!filePath || files.some((item) => item.path === filePath)) return;
    files.push({
      path: filePath,
      role,
      ...(componentId ? { componentId } : {}),
    });
  };
  if (primary && primaryContext) {
    addFile(primary.relativePath, "implementation", primary.id);
    for (const test of primaryContext.tests.slice(0, 4)) {
      addFile(test, "test", primary.id);
    }
    for (const relation of primaryContext.relations.renders.slice(0, 4)) {
      const dependency = graph.components.find(
        (component) => component.id === relation.id,
      );
      addFile(dependency?.relativePath, "dependency-reference", relation.id);
    }
    for (const relation of primaryContext.impact.direct.slice(0, 3)) {
      const consumer = graph.components.find(
        (component) => component.id === relation.id,
      );
      addFile(consumer?.relativePath, "consumer-reference", relation.id);
    }
  }
  for (const allowedFile of options.allowedFiles ?? []) {
    const normalized = allowedFile.trim().replaceAll("\\", "/");
    if (normalized) addFile(normalized, "authorized");
  }
  const impact = primaryContext
    ? {
        level:
          primaryContext.impact.transitiveConsumers > 10
            ? ("high" as const)
            : primaryContext.impact.transitiveConsumers > 2
              ? ("shared" as const)
              : ("contained" as const),
        directConsumers: primaryContext.impact.directConsumers,
        transitiveConsumers: primaryContext.impact.transitiveConsumers,
      }
    : undefined;
  return {
    schemaVersion: 1,
    intent: normalizedIntent,
    selection: options.primarySurface
      ? "non-component"
      : explicitPrimary
        ? "explicit"
        : primary
          ? "ranked"
          : "unresolved",
    ...(options.primarySurface ? { primarySurface: options.primarySurface } : {}),
    ...(primary ? { primary: componentContextReference(primary) } : {}),
    references,
    files: files.slice(0, 12),
    authorizedFiles: [
      ...new Set(
        (options.allowedFiles ?? [])
          .map((file) => file.trim().replaceAll("\\", "/").replace(/^\.\//u, ""))
          .filter(Boolean),
      ),
    ].slice(0, 32),
    ...(primaryContext
      ? {
          publicApi: {
            props: primaryContext.api.props.slice(0, 8),
            events: primaryContext.api.events.slice(0, 6),
            slots: primaryContext.api.slots.slice(0, 6),
            models: primaryContext.api.models.slice(0, 4),
          },
        }
      : {}),
    ...(impact ? { impact } : {}),
    outOfScope: [
      ...new Set(
        (options.outOfScope ?? [])
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, 8),
    nextActions: primary
      ? [
          "Inspect only the primary implementation and listed dependency references.",
          "Keep secondary components reference-only unless scope is explicitly invalidated.",
          ...(impact?.level === "high"
            ? ["Run shared API impact analysis before editing."]
            : []),
        ]
      : [
          "Resolve one primary component before broadening repository search.",
        ],
  };
}
