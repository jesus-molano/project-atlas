import { tokenize } from "@component-atlas/core";
import { decisionGate, designIndexFindings } from "./findings.js";
import { parseFigmaReference } from "./figma-url.js";
import { DESIGN_INDEX_SCHEMA_VERSION } from "./types.js";
import type {
  DesignCandidate,
  DesignCandidateResult,
  DesignFileIndex,
  DesignFinding,
  DesignIndexNode,
  DesignIndexSummary,
  DesignNodeInspection,
  RankDesignCandidatesOptions,
} from "./types.js";

const CONCEPT_GROUPS = [
  ["coupon", "cupon", "promo", "promotion", "discount", "descuento", "voucher"],
  ["code", "codigo"],
  ["checkout", "cart", "basket", "compra", "pago", "payment"],
  ["mobile", "movil", "phone", "telefono", "ios", "android"],
  ["desktop", "web", "escritorio"],
  ["delete", "remove", "eliminar", "borrar", "destructive"],
  ["login", "signin", "access", "acceso"],
  ["signup", "register", "registro"],
  ["empty", "vacio", "sin-resultados"],
  ["error", "invalid", "fallo"],
  ["loading", "pending", "cargando", "espera"],
  ["salary", "salario", "sueldo"],
  ["dialog", "modal", "sheet"],
  ["input", "field", "campo", "text-field"],
  ["button", "cta", "boton"],
  ["shared", "reusable", "library", "biblioteca", "common"],
];

const conceptByTerm = new Map<string, Set<string>>();
for (const group of CONCEPT_GROUPS) {
  const terms = new Set(group);
  for (const term of group) conceptByTerm.set(term, terms);
}

const STOPWORDS = new Set([
  "a",
  "an",
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
  "un",
  "una",
  "y",
]);

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function normalizedTokens(value: string): string[] {
  return tokenize(normalized(value))
    .filter((token) => !STOPWORDS.has(token))
    .map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    );
}

function expanded(tokens: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const token of tokens) {
    result.add(token);
    for (const related of conceptByTerm.get(token) ?? []) result.add(related);
  }
  return result;
}

function matchField(
  taskTokens: Set<string>,
  taskConcepts: Set<string>,
  value: string,
): { direct: string[]; semantic: string[] } {
  const fieldTokens = new Set(normalizedTokens(value));
  const fieldConcepts = expanded(fieldTokens);
  const direct = [...taskTokens].filter((token) => fieldTokens.has(token));
  const semantic = [...taskTokens].filter(
    (token) => !fieldTokens.has(token) && fieldConcepts.has(token),
  );
  if (direct.length === 0 && semantic.length === 0) {
    const reverse = [...fieldTokens].filter((token) => taskConcepts.has(token));
    semantic.push(...reverse);
  }
  return {
    direct: [...new Set(direct)],
    semantic: [...new Set(semantic)],
  };
}

function canonicalVariantName(value: string): string {
  const ignored = new Set([
    "mobile",
    "movil",
    "phone",
    "desktop",
    "web",
    "tablet",
    "ios",
    "android",
  ]);
  return normalizedTokens(value)
    .filter((token) => !ignored.has(token))
    .join(" ");
}

function similarity(left: string, right: string): number {
  const a = new Set(normalizedTokens(left));
  const b = new Set(normalizedTokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

function relatedVariants(
  index: DesignFileIndex,
  target: DesignIndexNode,
): DesignCandidate["relatedVariants"] {
  const canonical = canonicalVariantName(target.name);
  return index.nodes
    .filter(
      (node) =>
        node.id !== target.id &&
        node.pageId === target.pageId &&
        (canonicalVariantName(node.name) === canonical ||
          similarity(node.name, target.name) >= 0.6),
    )
    .slice(0, 4)
    .map((node) => ({
      id: node.id,
      name: node.name,
      url: node.url,
      status: node.devStatus,
      statusAvailability: node.devStatusAvailability,
      statusProvenance: node.devStatusProvenance,
    }));
}

interface ScoredNode {
  node: DesignIndexNode;
  score: number;
  reasons: string[];
  matchedTaskTerms: string[];
  codeMatches: string[];
}

function scoreNode(
  index: DesignFileIndex,
  node: DesignIndexNode,
  taskTokens: Set<string>,
  taskConcepts: Set<string>,
  codeSignals: string[],
): ScoredNode | undefined {
  let score = 0;
  const reasons: string[] = [];
  const matched = new Set<string>();
  const name = matchField(taskTokens, taskConcepts, node.name);
  if (name.direct.length > 0 || name.semantic.length > 0) {
    score += name.direct.length * 5 + name.semantic.length * 3;
    [...name.direct, ...name.semantic].forEach((term) => matched.add(term));
    reasons.push(
      `name matches: ${[...name.direct, ...name.semantic].join(", ")}`,
    );
  }
  const parentPath = node.path.slice(0, -1).join(" ");
  const hierarchy = matchField(taskTokens, taskConcepts, parentPath);
  if (hierarchy.direct.length > 0 || hierarchy.semantic.length > 0) {
    score += hierarchy.direct.length * 2 + hierarchy.semantic.length;
    [...hierarchy.direct, ...hierarchy.semantic].forEach((term) =>
      matched.add(term),
    );
    reasons.push(
      `hierarchy matches: ${[...hierarchy.direct, ...hierarchy.semantic].join(", ")}`,
    );
  }
  const change = matchField(
    taskTokens,
    taskConcepts,
    node.devStatusDescription ?? "",
  );
  if (change.direct.length > 0 || change.semantic.length > 0) {
    score += change.direct.length * 4 + change.semantic.length * 2;
    [...change.direct, ...change.semantic].forEach((term) => matched.add(term));
    reasons.push(
      `Ready for dev description matches: ${[...change.direct, ...change.semantic].join(", ")}`,
    );
  }
  const annotationText = node.annotations
    .map((annotation) => `${annotation.label ?? ""} ${annotation.text}`)
    .join(" ");
  const annotations = matchField(taskTokens, taskConcepts, annotationText);
  if (annotations.direct.length > 0 || annotations.semantic.length > 0) {
    score += annotations.direct.length * 3 + annotations.semantic.length * 1.5;
    [...annotations.direct, ...annotations.semantic].forEach((term) =>
      matched.add(term),
    );
    reasons.push(
      `annotation matches: ${[...annotations.direct, ...annotations.semantic].join(", ")}`,
    );
  }
  const componentText = [
    ...node.componentNames,
    ...node.variantProperties,
    ...node.codeConnections.map((connection) => connection.componentName),
  ].join(" ");
  const components = matchField(taskTokens, taskConcepts, componentText);
  if (components.direct.length > 0 || components.semantic.length > 0) {
    score += components.direct.length * 2 + components.semantic.length;
    [...components.direct, ...components.semantic].forEach((term) =>
      matched.add(term),
    );
    reasons.push(
      `contained components match: ${[...components.direct, ...components.semantic].join(", ")}`,
    );
  }
  const nodeCodeText = [
    componentText,
    ...node.codeConnections.map(
      (connection) => `${connection.componentName} ${connection.source ?? ""}`,
    ),
  ].join(" ");
  const codeMatches = codeSignals.filter(
    (signal) =>
      similarity(signal, nodeCodeText) >= 0.25 ||
      matchField(
        new Set(normalizedTokens(signal)),
        expanded(normalizedTokens(signal)),
        `${node.name} ${nodeCodeText}`,
      ).direct.length > 0,
  );
  if (codeMatches.length > 0) {
    score += Math.min(codeMatches.length, 3) * 2;
    reasons.push(`aligns with Atlas code: ${codeMatches.slice(0, 3).join(", ")}`);
  }
  if (score <= 0) return undefined;
  const taskRequestsMobile = [...taskConcepts].some((term) =>
    ["mobile", "movil", "phone", "telefono", "ios", "android"].includes(term),
  );
  const taskRequestsDesktop = [...taskConcepts].some((term) =>
    ["desktop", "web", "escritorio"].includes(term),
  );
  const taskRequestsShared = [...taskConcepts].some((term) =>
    ["shared", "reusable", "library", "biblioteca", "common"].includes(term),
  );
  const nodeTokens = new Set(normalizedTokens(node.name));
  const nodeIsMobile = [...nodeTokens].some((term) =>
    ["mobile", "movil", "phone", "ios", "android"].includes(term),
  );
  const nodeIsDesktop = [...nodeTokens].some((term) =>
    ["desktop", "web"].includes(term),
  );
  if (taskRequestsMobile) {
    score += nodeIsMobile ? 3 : -2;
    reasons.push(
      nodeIsMobile
        ? "matches requested mobile variant"
        : "device variant is not explicitly mobile",
    );
  }
  if (taskRequestsDesktop) {
    score += nodeIsDesktop ? 3 : nodeIsMobile ? -2 : 0;
    if (nodeIsDesktop) reasons.push("matches requested desktop variant");
  }
  if (taskRequestsShared) {
    const nodeIsReusable =
      node.type === "COMPONENT" ||
      node.type === "COMPONENT_SET" ||
      /library|biblioteca|shared|common/i.test(node.pageName);
    score += nodeIsReusable ? 3 : -1;
    reasons.push(
      nodeIsReusable
        ? "matches requested shared/library scope"
        : "belongs to a product frame rather than the shared library",
    );
  }
  if (node.devStatus === "ready-for-dev") {
    score += 2;
    reasons.push("Ready for dev");
  } else if (node.devStatus === "completed") {
    score += 0.25;
    reasons.push("Completed reference");
  }
  const page = index.pages.find((item) => item.id === node.pageId);
  if (
    node.devStatus !== "ready-for-dev" &&
    page?.devStatus === "ready-for-dev"
  ) {
    score += 1;
    reasons.push("Parent page is Ready for dev");
  }
  if (node.componentNames.length > 0) {
    reasons.push(
      `contains: ${node.componentNames.slice(0, 4).join(", ")}`,
    );
  }
  return {
    node,
    score: Number(score.toFixed(2)),
    reasons: reasons.slice(0, 6),
    matchedTaskTerms: [...matched],
    codeMatches,
  };
}

function confidence(score: number): DesignCandidate["confidence"] {
  return score >= 10 ? "high" : score >= 5 ? "medium" : "low";
}

function selectionFindings(
  task: string,
  scored: ScoredNode[],
  codeSignals: string[],
): DesignFinding[] {
  const top = scored[0];
  if (!top) {
    return [
      {
        id: "no-design-match:task",
        level: "decision-required",
        code: "no-design-match",
        title: "No cached Figma node matches the task",
        evidence: [
          `Task: ${task}`,
          "No page, hierarchy, frame, annotation, component, or Ready for dev description produced a semantic match.",
        ],
        recommendation:
          "Provide a concrete frame link or broaden the task intent with the product area and visual pattern before loading deep design context.",
        question:
          "Which Figma frame should represent this task, or should the task proceed without Figma context?",
      },
    ];
  }
  const second = scored[1];
  const ambiguous =
    confidence(top.score) === "low" ||
    (second !== undefined && top.score - second.score < 2);
  const findings: DesignFinding[] = [
    ambiguous
      ? {
          id: `ambiguous-design-target:${scored
            .slice(0, 3)
            .map((item) => item.node.id)
            .join(",")}`,
          level: "decision-required",
          code: "ambiguous-design-target",
          title: "Several design nodes plausibly match the task",
          evidence: scored
            .slice(0, 3)
            .map(
              (item) =>
                `${item.node.name} (${item.node.id}) scored ${item.score}: ${item.reasons.slice(0, 2).join("; ")}`,
            ),
          recommendation:
            "Prefer the candidate in the correct product area and choose a device variant explicitly when the task is device-specific. Use Ready for dev only as supporting evidence or a tie-breaker.",
          question: `Which node should be the implementation source: ${scored
            .slice(0, 3)
            .map((item) => item.node.name)
            .join(", ")}?`,
          nodeIds: scored.slice(0, 3).map((item) => item.node.id),
        }
      : {
          id: `confirm-design-target:${top.node.id}`,
          level: "decision-required",
          code: "confirm-design-target",
          title: `Confirm the proposed design target: ${top.node.name}`,
          evidence: [
            `${top.node.path.join(" / ")} scored ${top.score} (${confidence(top.score)} confidence).`,
            ...top.reasons.slice(0, 3),
          ],
          recommendation:
            "Confirm this node before requesting deep design context, variables, or a screenshot; otherwise provide a different node link.",
          question: `Should ${top.node.name} (${top.node.id}) be the confirmed implementation frame?`,
          nodeIds: [top.node.id],
        },
  ];
  if (codeSignals.length > 0 && top.codeMatches.length === 0) {
    findings.push({
      id: `figma-code-mismatch:${top.node.id}`,
      level: "warning",
      code: "figma-code-mismatch",
      title: "Top Figma candidate has no clear Atlas component match",
      evidence: [
        `Design candidate: ${top.node.name} (${top.node.id}).`,
        `Nearest Atlas signals: ${codeSignals.slice(0, 3).join(", ")}.`,
        "No component name or Code Connect mapping linked both sides.",
      ],
      recommendation:
        "Inspect the confirmed frame and nearest Atlas components before creating a new component; treat this as missing evidence, not proof of mismatch.",
      nodeIds: [top.node.id],
    });
  }
  return findings;
}

export function rankDesignCandidates(
  index: DesignFileIndex,
  task: string,
  options: RankDesignCandidatesOptions = {},
): DesignCandidateResult {
  const normalizedTask = task.trim();
  if (!normalizedTask) throw new Error("Design candidate search requires a task.");
  const limit =
    Number.isInteger(options.limit) && (options.limit ?? 0) > 0
      ? Math.min(options.limit ?? 5, 10)
      : 5;
  const taskTokens = new Set(normalizedTokens(normalizedTask));
  const taskConcepts = expanded(taskTokens);
  const codeSignals = (options.codeSignals ?? []).filter(Boolean);
  const scored = index.nodes
    .filter((node) => node.type !== "INSTANCE")
    .map((node) => scoreNode(index, node, taskTokens, taskConcepts, codeSignals))
    .filter((item): item is ScoredNode => Boolean(item))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.node.depth - right.node.depth ||
        left.node.name.localeCompare(right.node.name),
    );
  const candidates = scored.slice(0, limit).map((item, indexPosition) => {
    const page = index.pages.find(
      (candidate) => candidate.id === item.node.pageId,
    );
    return {
      rank: indexPosition + 1,
      confidence: confidence(item.score),
      score: item.score,
      node: {
        id: item.node.id,
        name: item.node.name,
        type: item.node.type,
        url: item.node.url,
        page: item.node.pageName,
        path: item.node.path.join(" / "),
        status: item.node.devStatus,
        statusAvailability: item.node.devStatusAvailability,
        statusProvenance: item.node.devStatusProvenance,
        pageStatus: page?.devStatus ?? "none",
        pageStatusAvailability:
          page?.devStatusAvailability ?? "source-unavailable",
        pageStatusProvenance:
          page?.devStatusProvenance ?? "source-unavailable",
      },
      reasons: item.reasons,
      matchedTaskTerms: item.matchedTaskTerms,
      relatedVariants: relatedVariants(index, item.node),
    };
  });
  const selectedIds = new Set(candidates.map((candidate) => candidate.node.id));
  const relevantIndexFindings = designIndexFindings(index).filter(
    (finding) =>
      !finding.nodeIds ||
      finding.nodeIds.some((nodeId) => selectedIds.has(nodeId)),
  );
  const findings = [
    ...selectionFindings(normalizedTask, scored, codeSignals),
    ...relevantIndexFindings,
  ];
  return {
    candidates,
    findings,
    gate: decisionGate(findings),
  };
}

function mainNodes(index: DesignFileIndex, pageId: string) {
  return index.nodes
    .filter((node) => node.pageId === pageId)
    .sort(
      (left, right) =>
        Number(right.devStatus === "ready-for-dev") -
          Number(left.devStatus === "ready-for-dev") ||
        left.depth - right.depth ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 10)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      status: node.devStatus,
      statusAvailability: node.devStatusAvailability,
      statusProvenance: node.devStatusProvenance,
      url: node.url,
    }));
}

const FLOW_STATES = [
  ["entry", /password|contrase(?:n|ñ)a|start|inicio/i],
  ["selection", /select|selection|finger|dedo/i],
  ["capture", /capture|scan|captura|registr/i],
  ["success", /success|registered|complete|correct|exito|registrad/i],
  ["error", /error|invalid|failed|fallo/i],
] as const;

function observedFlowStates(nodes: DesignIndexNode[]): string[] {
  const evidence = nodes
    .map((node) =>
      [
        node.name,
        node.devStatusDescription ?? "",
        ...node.annotations.map((annotation) => annotation.text),
      ].join(" "),
    )
    .join(" ");
  return FLOW_STATES.filter(([, pattern]) => pattern.test(evidence)).map(
    ([state]) => state,
  );
}

function designFamilies(index: DesignFileIndex): DesignIndexSummary["families"] {
  const byId = new Map(index.nodes.map((node) => [node.id, node]));
  const viewportGroups = new Map<string, DesignIndexNode[]>();
  for (const node of index.nodes) {
    if (node.type !== "FRAME" || node.width === undefined) continue;
    const key = `${node.pageId}:${node.parentId ?? "page"}:${canonicalVariantName(node.name)}`;
    const group = viewportGroups.get(key) ?? [];
    group.push(node);
    viewportGroups.set(key, group);
  }
  const viewportFamilies = [...viewportGroups.entries()]
    .filter(
      ([, nodes]) =>
        new Set(nodes.map((node) => node.width)).size > 1,
    )
    .map(([id, nodes]) => ({
      id: `viewport:${id}`,
      name: canonicalVariantName(nodes[0]?.name ?? "viewport family"),
      kind: "viewport" as const,
      nodeIds: nodes.map((node) => node.id),
      viewportWidths: [...new Set(nodes.map((node) => node.width!))].sort(
        (left, right) => left - right,
      ),
      observedStates: observedFlowStates(nodes),
      missingCommonStates: [] as string[],
    }));
  const flowGroups = new Map<string, DesignIndexNode[]>();
  for (const node of index.nodes) {
    if (node.type !== "FRAME" || !node.parentId) continue;
    const group = flowGroups.get(node.parentId) ?? [];
    group.push(node);
    flowGroups.set(node.parentId, group);
  }
  const flowFamilies = [...flowGroups.entries()]
    .map(([parentId, nodes]) => ({
      parentId,
      nodes,
      states: observedFlowStates(nodes),
    }))
    .filter(({ nodes, states }) => nodes.length > 1 && states.length >= 2)
    .map(({ parentId, nodes, states }) => ({
      id: `flow:${parentId}`,
      name:
        byId.get(parentId)?.name ??
        `${nodes[0]?.pageName ?? "Design"} flow`,
      kind: "flow" as const,
      nodeIds: nodes.map((node) => node.id),
      viewportWidths: [...new Set(
        nodes
          .map((node) => node.width)
          .filter((width): width is number => width !== undefined),
      )].sort((left, right) => left - right),
      observedStates: states,
      missingCommonStates: FLOW_STATES.map(([state]) => state).filter(
        (state) => !states.includes(state),
      ),
    }));
  return [...viewportFamilies, ...flowFamilies].slice(0, 12);
}

export function designIndexSummary(
  index: DesignFileIndex,
): DesignIndexSummary {
  const findings = designIndexFindings(index);
  let remainingNodeBudget = 60;
  return {
    schemaVersion: DESIGN_INDEX_SCHEMA_VERSION,
    file: index.file,
    indexedAt: index.indexedAt,
    sources: index.sources.length,
    stats: index.stats,
    devStatus: index.devStatus,
    variables: {
      availability: index.variables.availability,
      collections: index.variables.collections.slice(0, 20).map((collection) => ({
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((mode) => mode.name),
        variableCount: collection.variableCount,
        resolvedTypes: collection.resolvedTypes,
      })),
    },
    findings,
    gate: decisionGate(findings),
    pages: index.pages.slice(0, 30).map((page) => {
      const pageNodes = mainNodes(index, page.id).slice(
        0,
        remainingNodeBudget,
      );
      remainingNodeBudget -= pageNodes.length;
      return {
        id: page.id,
        name: page.name,
        status: page.devStatus,
        statusAvailability: page.devStatusAvailability,
        statusProvenance: page.devStatusProvenance,
        readyForDev: page.readyForDev,
        completed: page.completed,
        mainNodes: pageNodes,
      };
    }),
    families: designFamilies(index),
    nextActions: [
      "Use find_design_candidates with a concrete task before loading any deep Figma context.",
      "Confirm one node, then use inspect_design_node to obtain the exact Figma retrieval plan.",
      ...(index.variables.availability === "global"
        ? [
            "Use the global collection and mode summary for theme context; retrieve exact values only for the confirmed node.",
          ]
        : [
            "Global variables are unavailable; retrieve exact node variables with get_variable_defs after confirmation.",
          ]),
      ...(index.devStatus.availability === "source-unavailable"
        ? [
            "Ready for Dev status is unavailable through this metadata source. Use a REST or enriched source, or confirm the selected node in Figma; do not infer that no status exists.",
          ]
        : []),
    ],
  };
}

function resolveNode(
  index: DesignFileIndex,
  selector: string,
): DesignIndexNode {
  let nodeId: string | undefined;
  if (/^https?:\/\//i.test(selector)) {
    const reference = parseFigmaReference(selector);
    if (reference.fileKey !== index.file.key) {
      throw new Error(
        `The selected node belongs to Figma file ${reference.fileKey}, not ${index.file.key}.`,
      );
    }
    nodeId = reference.nodeId;
    if (!nodeId) throw new Error("The Figma URL must include a node-id.");
  }
  const normalizedSelector = normalized(selector);
  const matches = index.nodes.filter(
    (node) =>
      node.id === (nodeId ?? selector) ||
      normalized(node.name) === normalizedSelector ||
      normalized(node.path.join(" / ")) === normalizedSelector,
  );
  if (matches.length === 0) {
    throw new Error(
      `Design node "${selector}" was not found in ${index.file.name ?? index.file.key}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Design node "${selector}" is ambiguous: ${matches
        .slice(0, 5)
        .map((node) => `${node.name} (${node.id})`)
        .join(", ")}. Confirm a node ID or URL.`,
    );
  }
  return matches[0]!;
}

export function inspectDesignNode(
  index: DesignFileIndex,
  selector: string,
): DesignNodeInspection {
  const node = resolveNode(index, selector);
  const byId = new Map(index.nodes.map((item) => [item.id, item]));
  const breadcrumbs: DesignNodeInspection["breadcrumbs"] = [];
  const visited = new Set<string>([node.id]);
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current) {
    if (visited.has(current.id)) {
      throw new Error(
        `Design index contains a cyclic parent relationship at node ${current.id}.`,
      );
    }
    if (visited.size >= 128) {
      throw new Error(
        "Design index parent hierarchy exceeds the 128-level safety limit.",
      );
    }
    visited.add(current.id);
    breadcrumbs.unshift({
      id: current.id,
      name: current.name,
      type: current.type,
    });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  const relevantFindings = designIndexFindings(index).filter(
    (finding) =>
      !finding.nodeIds ||
      finding.nodeIds.includes(node.id) ||
      finding.nodeIds.some((nodeId) =>
        relatedVariants(index, node).some((variant) => variant.id === nodeId),
      ),
  );
  const recommendedTools = ["get_variable_defs"];
  if (node.codeConnections.length === 0) recommendedTools.push("get_code_connect_map");
  const candidateSubtreeIds = node.childIds
    .map((childId) => byId.get(childId))
    .filter(
      (child): child is DesignIndexNode =>
        Boolean(child) && child?.type !== "INSTANCE",
    )
    .slice(0, 8)
    .map((child) => child.id);
  return {
    file: index.file,
    node,
    breadcrumbs,
    children: node.childIds
      .map((childId) => byId.get(childId))
      .filter((child): child is DesignIndexNode => Boolean(child))
      .map((child) => ({
        id: child.id,
        name: child.name,
        type: child.type,
        status: child.devStatus,
        statusAvailability: child.devStatusAvailability,
        statusProvenance: child.devStatusProvenance,
        url: child.url,
      })),
    relatedVariants: relatedVariants(index, node),
    findings: relevantFindings,
    gate: decisionGate(relevantFindings),
    deepContextRequest: {
      confirmedNodeId: node.id,
      figmaUrl: node.url,
      strategy: "confirmed-subtree",
      orientationNodeId: node.id,
      candidateSubtreeIds,
      requiredTools:
        candidateSubtreeIds.length > 0
          ? ["get_metadata", "get_design_context", "get_screenshot"]
          : ["get_design_context", "get_screenshot"],
      recommendedTools,
      budgetPolicy: {
        preserveTargetFirst: true,
        omitFirst: [
          "application shell",
          "navigation",
          "repeated assets",
          "peripheral siblings",
        ],
        onUnisolatedTarget: "ask-for-selection",
      },
      instruction:
        candidateSubtreeIds.length > 0
          ? "Use this node only for orientation. Inspect its sparse child metadata, identify the smallest subtree that implements the task, and request deep context, screenshot, and exact variables only for that subtree. Preserve the target budget by omitting shell, navigation, repeated assets, and peripheral siblings first. If the relevant subtree cannot be isolated, ask for a manual Figma selection instead of silently returning truncated target context."
          : "The smallest indexed target is confirmed. Retrieve deep context, screenshot, and exact variables only for this node. If the target response itself is truncated, report that limitation and ask for a smaller manual selection rather than treating incomplete context as sufficient.",
    },
  };
}
