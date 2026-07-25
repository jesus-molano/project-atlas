<script setup lang="ts">
import { designIndexSummary } from "@component-atlas/design/browser";
import type {
  DesignFileIndex,
  DesignIndexNode,
  DesignIndexPage,
} from "@component-atlas/design";

const props = defineProps<{
  indexes: DesignFileIndex[];
  initialNodeId?: string;
}>();

const query = ref("");
const fileKey = ref(props.indexes[0]?.file.key ?? "");
const selectedNodeId = ref<string>();
const activeFile = computed(
  () => props.indexes.find((index) => index.file.key === fileKey.value) ?? props.indexes[0],
);
const activeSummary = computed(() =>
  activeFile.value ? designIndexSummary(activeFile.value) : undefined,
);
const filteredNodes = computed(() => {
  const nodes = activeFile.value?.nodes ?? [];
  const term = query.value.trim().toLowerCase();
  if (!term) return nodes;
  return nodes.filter((node) =>
    [
      node.name,
      node.type,
      node.pageName,
      node.path.join(" "),
      node.devStatus,
      ...node.componentNames,
      ...node.variantProperties,
    ]
      .join(" ")
      .toLowerCase()
      .includes(term),
  );
});
const selectedNode = computed<DesignIndexNode | undefined>(
  () =>
    filteredNodes.value.find((node) => node.id === selectedNodeId.value) ??
    filteredNodes.value[0],
);

function selectInitialNode(value: string | undefined): void {
  if (!value) return;
  const separator = value.indexOf("::");
  if (separator > 0) {
    fileKey.value = value.slice(0, separator);
    selectedNodeId.value = value.slice(separator + 2);
  } else {
    selectedNodeId.value = value;
  }
}

watch(
  () => props.initialNodeId,
  selectInitialNode,
  { immediate: true },
);

function statusLabel(status: string): string {
  return status === "ready-for-dev"
    ? "Ready for dev"
    : status === "completed"
      ? "Completed"
      : "No dev status";
}

function nodeStatusLabel(node: DesignIndexNode): string {
  return node.devStatusAvailability === "source-unavailable"
    ? "Status unavailable from source"
    : statusLabel(node.devStatus);
}

function statusClass(node: DesignIndexNode): string {
  return node.devStatusAvailability === "source-unavailable"
    ? "source-unavailable"
    : node.devStatus;
}

function pageStatusLabel(page: DesignIndexPage): string {
  return page.devStatusAvailability === "source-unavailable"
    ? "status unavailable"
    : statusLabel(page.devStatus);
}
</script>

<template>
  <div v-if="!indexes.length" class="section-empty">
    <span class="empty-code">DE / 00</span>
    <h2>No design metadata is indexed</h2>
    <p>
      Map sparse Figma metadata from the CLI or MCP. Ready for dev improves
      ranking, but it is never required.
    </p>
    <code>project-atlas design map --figma-url &lt;url&gt; --metadata &lt;file&gt;</code>
  </div>

  <div v-else class="atlas-workspace three-pane">
    <aside class="index-pane">
      <label class="field-label">
        Design file
        <select v-model="fileKey">
          <option
            v-for="index in indexes"
            :key="index.file.key"
            :value="index.file.key"
          >
            {{ index.file.name ?? index.file.key }}
          </option>
        </select>
      </label>
      <label class="filter-input">
        <span>Filter</span>
        <input v-model="query" type="search" placeholder="Frame, page, component…" >
      </label>
      <div class="index-summary">
        <span>{{ activeFile?.stats.pages }} pages</span>
        <span>{{ activeFile?.stats.nodes }} nodes</span>
        <span>{{ activeFile?.stats.readyForDev }} ready</span>
      </div>
      <div class="entity-list">
        <button
          v-for="node in filteredNodes"
          :key="node.id"
          :class="{ active: selectedNode?.id === node.id }"
          @click="selectedNodeId = node.id"
        >
          <span :class="['entity-mark', statusClass(node)]" />
          <span>
            <strong>{{ node.name }}</strong>
            <small>{{ node.pageName }} · {{ node.type }}</small>
          </span>
          <em>{{ nodeStatusLabel(node) }}</em>
        </button>
      </div>
    </aside>

    <section class="detail-pane">
      <template v-if="selectedNode">
        <header class="entity-heading">
          <div>
            <span class="eyebrow">{{ selectedNode.type }} / {{ selectedNode.id }}</span>
            <h2>{{ selectedNode.name }}</h2>
            <p>{{ selectedNode.path.join(" / ") }}</p>
          </div>
          <a :href="selectedNode.url" target="_blank" rel="noreferrer">
            Open in Figma ↗
          </a>
        </header>
        <div class="status-line">
          <span :class="['status-chip', statusClass(selectedNode)]">
            {{ nodeStatusLabel(selectedNode) }}
          </span>
          <span>Indexed evidence only</span>
        </div>
        <p v-if="selectedNode.devStatusDescription" class="evidence-note">
          {{ selectedNode.devStatusDescription }}
        </p>

        <section class="detail-block">
          <header><h3>Implementation signals</h3></header>
          <dl class="fact-grid">
            <div>
              <dt>Components</dt>
              <dd>{{ selectedNode.componentNames.join(", ") || "None indexed" }}</dd>
            </div>
            <div>
              <dt>Variants</dt>
              <dd>{{ selectedNode.variantProperties.join(", ") || "None indexed" }}</dd>
            </div>
            <div>
              <dt>Code connections</dt>
              <dd>{{ selectedNode.codeConnections.length }}</dd>
            </div>
            <div>
              <dt>Children</dt>
              <dd>{{ selectedNode.childIds.length }}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-block">
          <header><h3>Annotations & resources</h3></header>
          <div v-if="selectedNode.annotations.length || selectedNode.resources.length" class="evidence-stack">
            <p v-for="(annotation, index) in selectedNode.annotations" :key="`a:${index}`">
              {{ annotation.label ? `${annotation.label}: ${annotation.text}` : annotation.text }}
            </p>
            <a
              v-for="resource in selectedNode.resources"
              :key="resource.url"
              :href="resource.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ resource.name ?? resource.url }}
            </a>
          </div>
          <p v-else class="muted-copy">No annotations or resources were present in the sparse metadata.</p>
        </section>
      </template>
    </section>

    <aside class="inspector-pane">
      <section>
        <span class="eyebrow">File provenance</span>
        <h3>{{ activeFile?.file.name ?? activeFile?.file.key }}</h3>
        <dl class="stacked-facts">
          <div><dt>Indexed</dt><dd>{{ activeFile?.indexedAt }}</dd></div>
          <div><dt>Modified</dt><dd>{{ activeFile?.file.lastModified ?? "Unknown" }}</dd></div>
          <div><dt>Version</dt><dd>{{ activeFile?.file.version ?? "Unknown" }}</dd></div>
          <div>
            <dt>Dev status</dt>
            <dd>{{ activeFile?.devStatus.availability ?? "source-unavailable" }}</dd>
          </div>
        </dl>
        <p v-if="activeFile?.devStatus.note" class="evidence-note">
          {{ activeFile.devStatus.note }}
        </p>
      </section>
      <section>
        <span class="eyebrow">Pages</span>
        <h3>{{ activeFile?.pages.length ?? 0 }} indexed</h3>
        <div class="token-list">
          <div v-for="page in activeFile?.pages" :key="page.id">
            <strong>{{ page.name }}</strong>
            <span>{{ pageStatusLabel(page) }} · {{ page.readyForDev }} ready nodes</span>
          </div>
        </div>
      </section>
      <section>
        <span class="eyebrow">Global variables</span>
        <h3>{{ activeFile?.variables.collections.length }} collections</h3>
        <p>{{ activeFile?.variables.note ?? "Availability follows the connected Figma permissions." }}</p>
        <div class="token-list">
          <div v-for="collection in activeFile?.variables.collections" :key="collection.id">
            <strong>{{ collection.name }}</strong>
            <span>{{ collection.modes.map((mode) => mode.name).join(" / ") }}</span>
          </div>
        </div>
        <small>
          {{ activeFile?.variables.availability }} ·
          {{ activeFile?.variables.valuesIncluded ? "values indexed" : "values on demand" }}
        </small>
      </section>
      <section>
        <span class="eyebrow">Design families</span>
        <h3>{{ activeSummary?.families.length ?? 0 }} grouped</h3>
        <div v-if="activeSummary?.families.length" class="token-list">
          <div v-for="family in activeSummary.families" :key="family.id">
            <strong>{{ family.name }}</strong>
            <span>
              {{ family.kind }} ·
              {{ family.viewportWidths.length ? `${family.viewportWidths.join(" / ")}px` : "no viewport evidence" }}
            </span>
            <small v-if="family.observedStates.length">
              States: {{ family.observedStates.join(", ") }}
            </small>
            <small v-if="family.missingCommonStates.length">
              Not evidenced: {{ family.missingCommonStates.join(", ") }}
            </small>
          </div>
        </div>
        <p v-else class="muted-copy">
          No responsive or storyboard family can be inferred from the sparse index.
        </p>
      </section>
    </aside>
  </div>
</template>
