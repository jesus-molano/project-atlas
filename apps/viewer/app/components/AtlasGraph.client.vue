<script setup lang="ts">
import type {
  ComponentNode,
  GraphEdge,
} from "@component-atlas/core/types";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";

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
      label: component.effectiveName,
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
        score: edge.evidence?.score ?? 0,
      },
    }));
  return [...nodes, ...edges];
}

function renderGraph(): void {
  if (!container.value) return;
  cy?.destroy();
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
          color: "#c1bbab",
          "text-valign": "bottom",
          "text-margin-y": 7,
          "text-background-color": "#201f1a",
          "text-background-opacity": 0.9,
          "text-background-padding": "3px",
          "background-color": "#8fb9b2",
          "border-width": 2,
          "border-color": "#2a2821",
        },
      },
      {
        selector: 'node[visibility = "public"]',
        style: {
          "background-color": "#92bb98",
          "border-color": "#465a49",
        },
      },
      {
        selector: 'node[visibility = "feature"]',
        style: {
          "background-color": "#d2a45e",
          "border-color": "#5d4930",
        },
      },
      {
        selector: 'node[visibility = "private"]',
        style: {
          "background-color": "#c28f91",
          "border-color": "#593f41",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          opacity: 0.42,
          "line-color": "#756d5c",
          "target-arrow-color": "#756d5c",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: 'edge[kind = "similar_to"]',
        style: {
          "line-style": "dashed",
          "line-color": "#8fb1aa",
          "target-arrow-shape": "none",
          opacity: 0.35,
        },
      },
      {
        selector: "node:selected",
        style: {
          width: 39,
          height: 39,
          "border-width": 4,
          "border-color": "#f0ebdd",
          "overlay-color": "#d89a68",
          "overlay-opacity": 0.1,
          color: "#f0ebdd",
          "font-size": 12,
        },
      },
      {
        selector: ".faded",
        style: { opacity: 0.08 },
      },
      {
        selector: ".neighbor",
        style: { opacity: 1 },
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
  if (!cy || !props.selectedId) return;
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

function fitSelection(): void {
  if (!cy || !props.selectedId) return;
  const node = cy.getElementById(props.selectedId);
  if (node.empty()) return;
  cy.stop();
  cy.animate({
    center: { eles: node },
    zoom: Math.min(1.25, Math.max(0.7, cy.zoom())),
    duration: 180,
  });
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
    aria-label="Interactive component relationship map"
  />
</template>
