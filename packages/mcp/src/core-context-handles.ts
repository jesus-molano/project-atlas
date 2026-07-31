import {
  fitBudgetedResponse,
  loadProjectGraph,
} from "@component-atlas/runtime";

function relatedHandle(
  graph: Awaited<ReturnType<typeof loadProjectGraph>>,
  id: string,
): string | undefined {
  const component = graph.components.find((candidate) => candidate.id === id);
  if (component) return `code:${component.id}`;
  const entity = graph.entities.find((candidate) => candidate.id === id);
  return entity ? `entity:${entity.id}` : undefined;
}

export async function expandEntityContext(
  rootPath: string,
  entityId: string,
  budgetChars: number,
) {
  const graph = await loadProjectGraph(rootPath);
  const entity = graph.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`Frontend entity "${entityId}" was not found.`);
  const relations = graph.edges
    .filter((edge) => edge.source === entity.id || edge.target === entity.id)
    .slice(0, 20)
    .map((edge) => {
      const neighborId = edge.source === entity.id ? edge.target : edge.source;
      return {
        kind: edge.kind,
        direction: edge.source === entity.id ? "outgoing" : "incoming",
        neighborId,
        handle: relatedHandle(graph, neighborId),
        resolution: edge.resolution,
        provenance: edge.provenance,
      };
    });
  const handles = relations.flatMap((relation) =>
    relation.handle ? [relation.handle] : [],
  );
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      entity: {
        ...entity,
        handle: `entity:${entity.id}`,
      },
      relations,
      nextAction:
        "Expand only one typed neighboring handle when it can change the implementation decision.",
    },
    {
      budgetChars,
      totalMatches: relations.length,
      expandableIds: handles,
      preserveKeys: ["entity", "relations"],
    },
  );
}
