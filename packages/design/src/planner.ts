import type {
  DesignFileIndex,
  DesignIndexNode,
  DesignRetrievalPlan,
  DesignRetrievalPlanRegion,
} from "./types.js";

function digest(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function nodeHash(node: DesignIndexNode): string {
  return digest(
    JSON.stringify({
      id: node.id,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      childIds: node.childIds,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      annotations: node.annotations,
      componentNames: node.componentNames,
      codeConnections: node.codeConnections,
    }),
  );
}

function regionScore(node: DesignIndexNode): number {
  return (
    (node.devStatus === "ready-for-dev" ? 8 : 0) +
    node.codeConnections.length * 6 +
    node.annotations.length * 3 +
    node.componentNames.length * 2 +
    (/^(?:FRAME|SECTION|COMPONENT|COMPONENT_SET)$/u.test(node.type) ? 2 : 0) +
    Math.min(4, node.childIds.length)
  );
}

export function buildDesignRetrievalPlan(
  index: DesignFileIndex,
  target: DesignIndexNode,
): DesignRetrievalPlan {
  const byId = new Map(index.nodes.map((node) => [node.id, node]));
  const direct = target.childIds
    .map((id) => byId.get(id))
    .filter((node): node is DesignIndexNode => Boolean(node));
  const considered =
    direct.length > 0
      ? direct
      : target.parentId
        ? (byId.get(target.parentId)?.childIds ?? [])
            .map((id) => byId.get(id))
            .filter(
              (node): node is DesignIndexNode =>
                Boolean(node) && node?.id === target.id,
            )
        : [target];
  const ranked = [...considered].sort(
    (left, right) =>
      regionScore(right) - regionScore(left) ||
      (left.y ?? 0) - (right.y ?? 0) ||
      (left.x ?? 0) - (right.x ?? 0) ||
      left.id.localeCompare(right.id),
  );
  const selectionCount =
    ranked.length < 3 ? ranked.length : Math.min(6, Math.max(3, ranked.length));
  const selected = ranked.slice(0, selectionCount);
  const selectedIds = new Set(selected.map((node) => node.id));
  const regions: DesignRetrievalPlanRegion[] = ranked.map((node) => ({
    nodeId: node.id,
    status: selectedIds.has(node.id) ? "selected" : "omitted",
    reason: selectedIds.has(node.id)
      ? "Ranked by hierarchy, position, instances, code connections, annotations, and development status."
      : "Outside the bounded 3–6 subtree selection after metadata ranking.",
    confidence:
      node.codeConnections.length > 0 || node.devStatus === "ready-for-dev"
        ? "high"
        : node.annotations.length > 0 || node.componentNames.length > 0
          ? "medium"
          : "low",
    hash: nodeHash(node),
  }));
  const planContent = {
    fileKey: index.file.key,
    targetNodeId: target.id,
    regions,
    selectedNodeIds: selected.map((node) => node.id),
  };
  return {
    schemaVersion: 1,
    id: `design-plan:${digest(JSON.stringify(planContent)).slice(0, 20)}`,
    fileKey: index.file.key,
    targetNodeId: target.id,
    strategy: "metadata-first-bounded-subtrees",
    regions,
    selectedNodeIds: selected.map((node) => node.id),
    calls: [
      {
        tool: "get_metadata",
        nodeId: target.id,
        purpose: "Map lightweight hierarchy before deep retrieval.",
      },
      {
        tool: "get_code_connect_map",
        nodeId: target.id,
        purpose: "Prefer exact Code Connect mappings before design context.",
      },
      ...selected.flatMap((node) => [
        {
          tool: "get_design_context" as const,
          nodeId: node.id,
          purpose: "Retrieve only the selected bounded subtree.",
        },
        {
          tool: "get_screenshot" as const,
          nodeId: node.id,
          purpose: "Validate visual hierarchy for the selected subtree.",
        },
      ]),
    ],
    adaptivePolicy: {
      preserveTarget: true,
      onTruncatedOrExcessive: "split-selected-node-into-smaller-children",
      repeatSameCall: false,
    },
  };
}

export function adaptDesignRetrievalPlan(
  plan: DesignRetrievalPlan,
  failedNodeId: string,
  smallerChildIds: string[],
): DesignRetrievalPlan {
  const children = [...new Set(smallerChildIds)]
    .filter((id) => id && id !== failedNodeId)
    .slice(0, 6);
  if (!plan.selectedNodeIds.includes(failedNodeId) || children.length === 0) {
    throw new Error(
      "Adaptive design splitting requires a selected node and at least one smaller child.",
    );
  }
  const selectedNodeIds = plan.selectedNodeIds.flatMap((id) =>
    id === failedNodeId ? children : [id],
  ).slice(0, 6);
  const regions: DesignRetrievalPlanRegion[] = [
    ...plan.regions.map((region) =>
      region.nodeId === failedNodeId
        ? {
            ...region,
            status: "failed" as const,
            reason:
              "Deep response was truncated or excessive; split into smaller children.",
          }
        : region,
    ),
    ...children.map((nodeId) => ({
      nodeId,
      status: "selected" as const,
      reason: `Adaptive child of ${failedNodeId}; preserves the confirmed target while reducing response size.`,
      confidence: "medium" as const,
      hash: digest(`${plan.id}\0${failedNodeId}\0${nodeId}`),
    })),
  ];
  const content = {
    previousPlanId: plan.id,
    targetNodeId: plan.targetNodeId,
    selectedNodeIds,
    regions,
  };
  return {
    ...plan,
    id: `design-plan:${digest(JSON.stringify(content)).slice(0, 20)}`,
    selectedNodeIds,
    regions,
    calls: [
      {
        tool: "get_metadata",
        nodeId: failedNodeId,
        purpose: "Map smaller children after a truncated or excessive response.",
      },
      ...children.flatMap((nodeId) => [
        {
          tool: "get_design_context" as const,
          nodeId,
          purpose: `Adaptive smaller subtree replacing ${failedNodeId}.`,
        },
        {
          tool: "get_screenshot" as const,
          nodeId,
          purpose: `Visual validation for adaptive child of ${failedNodeId}.`,
        },
      ]),
    ],
  };
}
