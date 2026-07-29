<script setup lang="ts">
import type {
  ComponentNode,
  GraphEdge,
} from "@component-atlas/core/types";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";

const { t } = useAtlasI18n();

const props = defineProps<{
  components: ComponentNode[];
  edges: GraphEdge[];
  selectedId?: string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const container = ref<HTMLElement>();
let cy: Core | undefined;
let resizeObserver: ResizeObserver | undefined;

function graphLabel(value: string): string {
  return value.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, "\u200b");
}

function graphElements(): ElementDefinition[] {
  const componentIds = new Set(props.components.map((component) => component.id));
  const degrees = new Map<string, number>();
  for (const edge of props.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  const nodes: ElementDefinition[] = props.components.map((component) => ({
    data: {
      id: component.id,
      label: graphLabel(component.effectiveName),
      visibility: component.visibility,
      feature: component.feature ?? "shared",
      degree: degrees.get(component.id) ?? 0,
    },
  }));
  const edges: ElementDefinition[] = props.edges
    .filter(
      (edge) =>
        edge.kind !== "tested_by" &&
        componentIds.has(edge.source) &&
        componentIds.has(edge.target),
    )
    .map((edge) => ({
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        resolution: edge.resolution ?? "inferred",
        score: edge.evidence?.score ?? 0,
      },
    }));
  return [...nodes, ...edges];
}

function graphToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function renderGraph(): void {
  if (!container.value) return;
  cy?.destroy();
  const graphColors = {
    label: graphToken("--atlas-graph-label"),
    labelBackground: graphToken("--atlas-graph-label-background"),
    node: graphToken("--atlas-graph-node"),
    nodeBorder: graphToken("--atlas-graph-node-border"),
    publicNode: graphToken("--atlas-graph-public"),
    publicBorder: graphToken("--atlas-graph-public-border"),
    featureNode: graphToken("--atlas-graph-feature"),
    featureBorder: graphToken("--atlas-graph-feature-border"),
    privateNode: graphToken("--atlas-graph-private"),
    privateBorder: graphToken("--atlas-graph-private-border"),
    edge: graphToken("--atlas-graph-edge"),
    similarEdge: graphToken("--atlas-graph-similar-edge"),
    selected: graphToken("--atlas-graph-selected"),
    selectedOverlay: graphToken("--atlas-graph-selected-overlay"),
  };
  cy = cytoscape({
    container: container.value,
    elements: graphElements(),
    minZoom: 0.15,
    maxZoom: 2.4,
    style: [
      {
        selector: "node",
        style: {
          width: "mapData(degree, 0, 12, 22, 42)",
          height: "mapData(degree, 0, 12, 22, 42)",
          label: "data(label)",
          "font-family": "Inter, ui-sans-serif, system-ui",
          "font-size": 10,
          "font-weight": 600,
          color: graphColors.label,
          "text-valign": "bottom",
          "text-margin-y": 7,
          "text-background-color": graphColors.labelBackground,
          "text-background-opacity": 0.9,
          "text-background-padding": "3px",
          "background-color": graphColors.node,
          "border-width": 2,
          "border-color": graphColors.nodeBorder,
        },
      },
      {
        selector: 'node[visibility = "public"]',
        style: {
          "background-color": graphColors.publicNode,
          "border-color": graphColors.publicBorder,
        },
      },
      {
        selector: 'node[visibility = "feature"]',
        style: {
          "background-color": graphColors.featureNode,
          "border-color": graphColors.featureBorder,
        },
      },
      {
        selector: 'node[visibility = "private"]',
        style: {
          "background-color": graphColors.privateNode,
          "border-color": graphColors.privateBorder,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          opacity: 0.42,
          "line-color": graphColors.edge,
          "target-arrow-color": graphColors.edge,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: 'edge[kind = "similar_to"]',
        style: {
          "line-style": "dashed",
          "line-color": graphColors.similarEdge,
          "target-arrow-shape": "none",
          opacity: 0.35,
        },
      },
      {
        selector: 'edge[resolution = "framework-convention"]',
        style: {
          "line-style": "dashed",
          opacity: 0.32,
        },
      },
      {
        selector: "node:selected",
        style: {
          width: 42,
          height: 42,
          "border-width": 4,
          "border-color": graphColors.selected,
          "overlay-color": graphColors.selectedOverlay,
          "overlay-opacity": 0.1,
          color: graphColors.selected,
          "font-size": 12,
          "text-halign": "center",
          "text-valign": "bottom",
          "text-margin-y": 13,
          "text-wrap": "wrap",
          "text-max-width": "100px",
          "text-background-padding": "5px",
          "text-opacity": 1,
          "z-index": 10,
        },
      },
      {
        selector: ".faded",
        style: { opacity: 0.08 },
      },
      {
        selector: ".neighbor",
        style: {
          opacity: 1,
          "text-opacity": 0.45,
        },
      },
      {
        selector: "node:selected",
        style: {
          "text-opacity": 1,
          "z-index": 10,
        },
      },
    ],
    layout: {
      name: "cose",
      animate: false,
      fit: true,
      padding: 45,
      nodeRepulsion: () => 7200,
      idealEdgeLength: () => 86,
    },
  });
  cy.on("tap", "node", (event) => {
    emit("select", event.target.id());
  });
  cy.on("select", "node", (event) => {
    const selected = event.target;
    const neighborhood = selected.closedNeighborhood();
    cy?.elements().addClass("faded");
    neighborhood.removeClass("faded").addClass("neighbor");
  });
  cy.on("unselect", "node", () => {
    cy?.elements().removeClass("faded neighbor");
  });
  selectCurrent();
}

function selectCurrent(): void {
  if (!cy) return;
  if (!props.selectedId) {
    cy.elements().unselect();
    cy.elements().removeClass("faded neighbor");
    return;
  }
  const node = cy.getElementById(props.selectedId);
  if (node.nonempty()) {
    cy.elements().unselect();
    node.select();
    cy.stop();
    cy.animate({
      center: { eles: node },
      zoom: Math.min(1.15, Math.max(0.68, cy.zoom())),
      duration: 160,
    });
  }
}

function fitGraph(): void {
  if (!cy) return;
  cy.stop();
  cy.animate({ fit: { eles: cy.nodes(), padding: 42 }, duration: 180 });
}

function fitSelection(offsetX = 0): void {
  if (!cy || !props.selectedId) return;
  const node = cy.getElementById(props.selectedId);
  if (node.empty()) return;
  cy.stop();
  cy.center(node);
  cy.zoom(Math.min(1.25, Math.max(0.7, cy.zoom())));
  if (offsetX) cy.panBy({ x: offsetX, y: 0 });
}

function resetView(): void {
  if (!cy) return;
  cy.stop();
  cy.zoom(1);
  cy.center(cy.nodes());
}

watch(
  () => [props.components, props.edges],
  () => nextTick(renderGraph),
  { deep: false, flush: "post" },
);
watch(() => props.selectedId, selectCurrent);
onMounted(async () => {
  await nextTick();
  renderGraph();
  if (container.value) {
    resizeObserver = new ResizeObserver(() => {
      cy?.resize();
    });
    resizeObserver.observe(container.value);
  }
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  cy?.destroy();
});

defineExpose({ fitGraph, fitSelection, resetView, resize: () => cy?.resize() });
</script>

<template>
  <div
    ref="container"
    class="atlas-graph"
    role="application"
    :aria-label="t('Interactive component relationship map')"
  />
</template>
