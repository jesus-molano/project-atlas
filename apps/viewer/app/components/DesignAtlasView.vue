<script setup lang="ts">
import { designIndexSummary } from "@component-atlas/design/browser";
import type {
  DesignFileIndex,
  DesignIndexNode,
  DesignIndexPage,
  DesignVariableToken,
  DesignVariableValue,
} from "@component-atlas/design";
import type { ProjectCapabilityReport } from "@component-atlas/core/browser";

const props = defineProps<{
  indexes: DesignFileIndex[];
  capabilities?: ProjectCapabilityReport;
  initialNodeId?: string;
}>();
const { formatDate, statusLabel: uiStatusLabel, t } = useAtlasI18n();

const query = ref("");
const fileKey = ref(props.indexes[0]?.file.key ?? "");
const selectedNodeId = ref<string>();
const selectedVariableCollectionId = ref<string>();
const selectedVariableId = ref<string>();
const entityList = ref<HTMLElement>();
const detailPane = ref<HTMLElement>();
const inspectorPane = ref<HTMLElement>();
const activeFile = computed(
  () => props.indexes.find((index) => index.file.key === fileKey.value) ?? props.indexes[0],
);
const activeFileIsSimulated = computed(() => {
  const index = activeFile.value;
  if (!index) return false;
  return /\b(?:synthetic|simulated|fake|fixture)\b/i.test(
    [
      index.file.key,
      index.file.name,
      index.file.version,
      index.devStatus.note,
      ...index.nodes.slice(0, 12).map((node) => node.devStatusDescription),
    ]
      .filter(Boolean)
      .join(" "),
  );
});
const activeSummary = computed(() =>
  activeFile.value ? designIndexSummary(activeFile.value) : undefined,
);
const variablesCapability = computed(() =>
  props.capabilities?.observations.find(
    (observation) => observation.id === "figma-variables",
  ),
);
const variableAccessState = computed<
  "global" | "selection-only" | "permission-required" | "unavailable"
>(() => {
  const availability = activeFile.value?.variables.availability;
  if (availability === "global") return "global";
  if (availability === "selection-only") return "selection-only";
  return variablesCapability.value?.state === "permission-required"
    ? "permission-required"
    : "unavailable";
});
const variableCollections = computed(
  () => activeFile.value?.variables.collections ?? [],
);
const activeVariableCollection = computed(
  () =>
    variableCollections.value.find(
      (collection) => collection.id === selectedVariableCollectionId.value,
    ) ?? variableCollections.value[0],
);
const collectionVariables = computed(() =>
  (activeFile.value?.variables.variables ?? []).filter(
    (variable) => variable.collectionId === activeVariableCollection.value?.id,
  ),
);
const selectedVariable = computed<DesignVariableToken | undefined>(
  () =>
    collectionVariables.value.find(
      (variable) => variable.id === selectedVariableId.value,
    ) ?? collectionVariables.value[0],
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
const durableResources = computed(() =>
  (selectedNode.value?.resources ?? []).filter((resource) => {
    try {
      const parsed = new URL(resource.url);
      return (
        ["https:", "http:"].includes(parsed.protocol) &&
        !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      );
    } catch {
      return false;
    }
  }),
);
const emptyStateTitle = computed(() => t("No design metadata is indexed"));
const emptyStateCopy = computed(() =>
  t("Index a Figma file with the Atlas CLI, then refresh this local view."),
);
const variableCatalogHeading = computed(() => {
  const collectionCount = variableCollections.value.length;
  const tokenCount = activeFile.value?.variables.variables.length ?? 0;
  return t("{collections} · {tokens}", {
    collections: t(
      collectionCount === 1 ? "{count} collection" : "{count} collections",
      { count: collectionCount },
    ),
    tokens: t(
      tokenCount === 1 ? "{count} shared token" : "{count} shared tokens",
      { count: tokenCount },
    ),
  });
});

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
watch(
  () => activeFile.value?.file.key,
  () => {
    if (
      selectedNodeId.value &&
      !activeFile.value?.nodes.some((node) => node.id === selectedNodeId.value)
    ) {
      selectedNodeId.value = activeFile.value?.nodes[0]?.id;
    }
    selectedVariableCollectionId.value =
      activeFile.value?.variables.collections[0]?.id;
    selectedVariableId.value = activeFile.value?.variables.variables[0]?.id;
  },
  { immediate: true },
);
watch(
  () => activeVariableCollection.value?.id,
  () => {
    if (
      !collectionVariables.value.some(
        (variable) => variable.id === selectedVariableId.value,
      )
    ) {
      selectedVariableId.value = collectionVariables.value[0]?.id;
    }
  },
);
watch(
  () => selectedNode.value?.id,
  () => {
    nextTick(() => {
      if (detailPane.value) detailPane.value.scrollTop = 0;
    });
  },
);

function statusLabel(status: string): string {
  return status === "ready-for-dev"
    ? t("Ready for dev")
    : status === "completed"
      ? t("Completed")
      : t("No dev status");
}

function nodeStatusLabel(node: DesignIndexNode): string {
  if (node.devStatusProvenance === "user-confirmed") {
    return t("{status} · user confirmed", { status: statusLabel(node.devStatus) });
  }
  if (node.devStatusProvenance === "source-unavailable") {
    return t("Status not exposed by source");
  }
  if (node.devStatusProvenance === "absent") return t("No dev status observed");
  return t("{status} · indexed metadata", { status: statusLabel(node.devStatus) });
}

function nodeCompactStatusLabel(node: DesignIndexNode): string {
  if (node.devStatusProvenance === "source-unavailable") {
    return t("Not exposed");
  }
  if (node.devStatus === "ready-for-dev") return t("Ready");
  if (node.devStatus === "completed") return t("Completed");
  return t("Not observed");
}

function statusClass(node: DesignIndexNode): string {
  return node.devStatusProvenance === "source-unavailable"
    ? "source-unavailable"
    : node.devStatus;
}

function pageStatusLabel(page: DesignIndexPage): string {
  if (page.devStatusProvenance === "user-confirmed") {
    return t("{status} · user confirmed", { status: statusLabel(page.devStatus) });
  }
  if (page.devStatusProvenance === "source-unavailable") {
    return t("status not exposed by source");
  }
  if (page.devStatusProvenance === "absent") return t("no dev status observed");
  return t("{status} · indexed metadata", { status: statusLabel(page.devStatus) });
}

function durableFigmaUrl(value: string | undefined): string | undefined {
  if (!value || activeFileIsSimulated.value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol === "https:" &&
      /(^|\.)figma\.com$/i.test(parsed.hostname)
    ) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function copySelectedUrl(): Promise<void> {
  const url = durableFigmaUrl(selectedNode.value?.url);
  if (url) await navigator.clipboard.writeText(url);
}

function variableAccessLabel(): string {
  const labels = {
    global: "Global file variables",
    "selection-only": "Selection-only fallback",
    "permission-required": "Permission required",
    unavailable: "Global variables unavailable",
  } as const;
  return t(labels[variableAccessState.value]);
}

function variableAccessCopy(): string {
  const copy = {
    global:
      "Global collections and shared tokens are indexed independently of the selected frame. Exact values appear only when the authorized source included them.",
    "selection-only":
      "The source exposes variables only for a confirmed selection. This fallback is not a global file catalog and is kept separate from global variables.",
    "permission-required":
      "The connected Figma source requires permission before Atlas can read global variable collections. No absence is inferred.",
    unavailable:
      "The indexed source did not expose a global variable catalog. This does not mean the file has no variables.",
  } as const;
  return t(copy[variableAccessState.value]);
}

function variableValueLabel(value: DesignVariableValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if ("aliasTo" in value) {
    return t("Alias to {id}", { id: value.aliasTo });
  }
  const channel = (component: number) =>
    Math.round(Math.min(1, Math.max(0, component)) * 255);
  return t("Color channels: {red}, {green}, {blue}, alpha {alpha}", {
    red: channel(value.r),
    green: channel(value.g),
    blue: channel(value.b),
    alpha: value.a ?? 1,
  });
}

function variableModeName(modeId: string): string {
  return (
    activeVariableCollection.value?.modes.find((mode) => mode.id === modeId)
      ?.name ?? modeId
  );
}

function selectNode(node: DesignIndexNode, revealDetail = false): void {
  selectedNodeId.value = node.id;
  if (!revealDetail) return;
  nextTick(() => {
    const workspace = detailPane.value?.closest(".design-atlas");
    if (!workspace || !detailPane.value) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const detailBounds = detailPane.value.getBoundingClientRect();
    const visibleTop = Math.max(0, workspaceBounds.top);
    const visibleBottom = Math.min(window.innerHeight, workspaceBounds.bottom);
    if (
      detailBounds.top >= visibleTop &&
      detailBounds.top < visibleBottom - 96
    ) {
      return;
    }
    detailPane.value.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  });
}

function focusIndexedControl(
  owner: HTMLElement | undefined,
  selector: string,
  index: number,
): void {
  nextTick(() => {
    owner
      ?.querySelectorAll<HTMLElement>(selector)
      .item(index)
      ?.focus();
  });
}

function handleNodeKeydown(event: KeyboardEvent, index: number): void {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const last = filteredNodes.value.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowDown"
          ? Math.min(last, index + 1)
          : Math.max(0, index - 1);
  const nextNode = filteredNodes.value[nextIndex];
  if (!nextNode) return;
  selectNode(nextNode);
  focusIndexedControl(entityList.value, "[role=\"option\"]", nextIndex);
}

function handleVariableCollectionKeydown(
  event: KeyboardEvent,
  index: number,
): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const last = variableCollections.value.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowRight"
          ? (index + 1) % variableCollections.value.length
          : (index - 1 + variableCollections.value.length) %
            variableCollections.value.length;
  const nextCollection = variableCollections.value[nextIndex];
  if (!nextCollection) return;
  selectedVariableCollectionId.value = nextCollection.id;
  focusIndexedControl(
    inspectorPane.value,
    ".variable-collection-tabs [role=\"tab\"]",
    nextIndex,
  );
}

function handleVariableKeydown(event: KeyboardEvent, index: number): void {
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const last = collectionVariables.value.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowDown"
          ? Math.min(last, index + 1)
          : Math.max(0, index - 1);
  const nextVariable = collectionVariables.value[nextIndex];
  if (!nextVariable) return;
  selectedVariableId.value = nextVariable.id;
  focusIndexedControl(
    inspectorPane.value,
    ".variable-token-list [role=\"option\"]",
    nextIndex,
  );
}

function designFamilyKindLabel(kind: "viewport" | "flow"): string {
  return kind === "viewport" ? t("Responsive widths") : t("Flow");
}
</script>

<template>
  <div
    v-if="!indexes.length"
    class="section-empty"
    role="status"
    aria-live="polite"
  >
    <AtlasIcon name="design" />
    <h2>{{ emptyStateTitle }}</h2>
    <p>{{ emptyStateCopy }}</p>
  </div>

  <div v-else class="design-atlas-shell">
    <div
      class="atlas-workspace three-pane design-atlas"
    >
    <aside class="index-pane" :aria-label="t('Design catalog')">
      <label class="field-label">
        {{ t("Design file") }}
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
        <span>{{ t("Filter") }}</span>
        <input v-model="query" type="search" :placeholder="t('Frame, page, component…')">
      </label>
      <div
        id="design-result-summary"
        class="index-summary"
        role="status"
        aria-live="polite"
      >
        <span>{{ t("{count} pages", { count: activeFile?.stats.pages ?? 0 }) }}</span>
        <span>{{ t("{count} matching nodes", { count: filteredNodes.length }) }}</span>
        <span>{{ t("{count} ready claims", { count: activeFile?.stats.readyForDev ?? 0 }) }}</span>
      </div>
      <div
        ref="entityList"
        class="entity-list"
        role="listbox"
        tabindex="-1"
        :aria-label="t('Design catalog results')"
        aria-describedby="design-result-summary"
      >
        <button
          v-for="(node, index) in filteredNodes"
          :key="node.id"
          type="button"
          role="option"
          :class="{ active: selectedNode?.id === node.id }"
          :aria-selected="selectedNode?.id === node.id"
          :aria-label="`${node.name}, ${node.pageName}, ${node.type}, ${nodeStatusLabel(node)}`"
          aria-controls="design-node-detail"
          :tabindex="selectedNode?.id === node.id ? 0 : -1"
          :title="`${node.name} · ${nodeStatusLabel(node)}`"
          @click="selectNode(node, true)"
          @keydown="handleNodeKeydown($event, index)"
        >
          <span :class="['entity-mark', statusClass(node)]" aria-hidden="true" />
          <span>
            <strong>{{ node.name }}</strong>
            <small>{{ node.pageName }} · {{ node.type }}</small>
          </span>
          <em aria-hidden="true">{{ nodeCompactStatusLabel(node) }}</em>
        </button>
        <div v-if="!filteredNodes.length" class="empty-results" role="status">
          <strong>{{ t("No design node matches this filter.") }}</strong>
          <span>{{ t("Try another search or clear the filter to see indexed nodes.") }}</span>
        </div>
      </div>
    </aside>

    <section
      id="design-node-detail"
      ref="detailPane"
      class="detail-pane"
      tabindex="-1"
      :aria-label="t('Selected design node details')"
    >
      <template v-if="selectedNode">
        <header class="entity-heading">
          <div>
            <span class="eyebrow">{{ selectedNode.type }} / {{ selectedNode.id }}</span>
            <h2>{{ selectedNode.name }}</h2>
            <p>{{ selectedNode.path.join(" / ") }}</p>
          </div>
          <div class="entity-actions">
            <a
              v-if="durableFigmaUrl(selectedNode.url)"
              :href="durableFigmaUrl(selectedNode.url)"
              target="_blank"
              rel="noreferrer"
            >
              {{ t("Open URL") }} ↗
            </a>
            <button
              v-if="durableFigmaUrl(selectedNode.url)"
              class="text-button"
              @click="copySelectedUrl"
            >
              {{ t("Copy URL") }}
            </button>
          </div>
        </header>
        <div class="status-line">
          <span :class="['status-chip', statusClass(selectedNode)]">
            {{ nodeStatusLabel(selectedNode) }}
          </span>
          <span>{{ t("Indexed evidence only") }}</span>
        </div>
        <p v-if="activeFileIsSimulated" class="evidence-note">
          {{ t("Synthetic lab evidence. Ready for Dev, Code Connect, variables, and connector states below are fixture claims, not live Figma verification.") }}
        </p>
        <p v-if="selectedNode.devStatusDescription" class="evidence-note">
          {{ selectedNode.devStatusDescription }}
        </p>

        <section class="detail-block">
          <header><h3>{{ t("Implementation signals") }}</h3></header>
          <dl class="fact-grid">
            <div>
              <dt>{{ t("Components") }}</dt>
              <dd>{{ selectedNode.componentNames.join(", ") || t("None indexed") }}</dd>
            </div>
            <div>
              <dt>{{ t("Variants") }}</dt>
              <dd>{{ selectedNode.variantProperties.join(", ") || t("None indexed") }}</dd>
            </div>
            <div>
              <dt>{{ t("Indexed code mappings") }}</dt>
              <dd>
                {{ selectedNode.codeConnections.length }}
                <template v-if="activeFileIsSimulated"> · {{ t("simulated") }}</template>
              </dd>
            </div>
            <div>
              <dt>{{ t("Children") }}</dt>
              <dd>{{ selectedNode.childIds.length }}</dd>
            </div>
          </dl>
        </section>

        <section class="detail-block">
          <header><h3>{{ t("Annotations & resources") }}</h3></header>
          <div v-if="selectedNode.annotations.length || durableResources.length" class="evidence-stack">
            <p v-for="(annotation, index) in selectedNode.annotations" :key="`a:${index}`">
              {{ annotation.label ? `${annotation.label}: ${annotation.text}` : annotation.text }}
            </p>
            <a
              v-for="resource in durableResources"
              :key="resource.url"
              :href="resource.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ resource.name ?? resource.url }}
            </a>
          </div>
          <p v-else class="muted-copy">{{ t("No annotations or resources were present in the sparse metadata.") }}</p>
        </section>
      </template>
      <div v-else class="panel-empty" role="status">
        <AtlasIcon name="design" />
        <h2>{{ t("No design node selected") }}</h2>
        <p>
          {{
            query
              ? t("Try another search or clear the filter to see indexed nodes.")
              : t("This design file has no indexed nodes.")
          }}
        </p>
      </div>
    </section>

    <aside
      ref="inspectorPane"
      class="inspector-pane"
      tabindex="-1"
      :aria-label="t('Design file details')"
    >
      <section>
        <span class="eyebrow">{{ t("File provenance") }}</span>
        <h3>{{ activeFile?.file.name ?? activeFile?.file.key }}</h3>
        <dl class="stacked-facts">
          <div><dt>{{ t("Indexed") }}</dt><dd>{{ formatDate(activeFile?.indexedAt) }}</dd></div>
          <div><dt>{{ t("Modified") }}</dt><dd>{{ activeFile?.file.lastModified ? formatDate(activeFile.file.lastModified) : t("Unknown") }}</dd></div>
          <div><dt>{{ t("Version") }}</dt><dd>{{ activeFile?.file.version ?? t("Unknown") }}</dd></div>
          <div>
            <dt>{{ t("Indexed status availability") }}</dt>
            <dd>{{ uiStatusLabel(activeFile?.devStatus.availability ?? "source-unavailable") }}</dd>
          </div>
        </dl>
        <p v-if="activeFile?.devStatus.note" class="evidence-note">
          {{ activeFile.devStatus.note }}
        </p>
      </section>
      <section v-if="activeFile?.sources.length">
        <span class="eyebrow">{{ t("Source receipts") }}</span>
        <div
          v-for="source in activeFile.sources"
          :key="source.receipt.id"
          class="evidence-note"
        >
          <strong>
            {{ statusLabel(source.receipt.coverage) }}
            · {{ statusLabel(source.receipt.freshness) }}
          </strong>
          <code>{{ source.receipt.id }}</code>
          <small>
            {{ t("Requested") }}: {{ source.receipt.requested.canonicalId }}
          </small>
          <small>
            {{ t("Resolved") }}: {{ source.receipt.resolved.canonicalId }}
          </small>
        </div>
      </section>
      <section>
        <span class="eyebrow">{{ t("Pages") }}</span>
        <h3>
          {{
            t(
              activeFile?.pages.length === 1
                ? "{count} page indexed"
                : "{count} pages indexed",
              { count: activeFile?.pages.length ?? 0 },
            )
          }}
        </h3>
        <div class="token-list">
          <div v-for="page in activeFile?.pages" :key="page.id">
            <strong>{{ page.name }}</strong>
            <span>
              {{ pageStatusLabel(page) }} ·
              {{
                t(
                  page.readyForDev === 1
                    ? "{count} ready node"
                    : "{count} ready nodes",
                  { count: page.readyForDev },
                )
              }}
            </span>
          </div>
        </div>
      </section>
      <section class="design-variable-browser">
        <header class="variable-browser-heading">
          <div>
            <span class="eyebrow">{{ t("Global Figma variables") }}</span>
            <h3>{{ variableCatalogHeading }}</h3>
          </div>
          <span :class="['status-chip', `variable-${variableAccessState}`]">
            {{ variableAccessLabel() }}
          </span>
        </header>
        <p v-if="variableAccessState === 'global'">{{ variableAccessCopy() }}</p>

        <template v-if="variableAccessState === 'global'">
          <div
            class="variable-collection-tabs"
            role="tablist"
            :aria-label="t('Global variable collections')"
          >
            <button
              v-for="(collection, index) in variableCollections"
              :id="`design-variable-collection-${index}`"
              :key="collection.id"
              type="button"
              role="tab"
              :aria-selected="activeVariableCollection?.id === collection.id"
              aria-controls="design-variable-token-browser"
              :tabindex="activeVariableCollection?.id === collection.id ? 0 : -1"
              :title="collection.name"
              @click="selectedVariableCollectionId = collection.id"
              @keydown="handleVariableCollectionKeydown($event, index)"
            >
              <strong>{{ collection.name }}</strong>
              <span>
                {{
                  t("{count} tokens · {modes}", {
                    count: collection.variableCount,
                    modes:
                      collection.modes.map((mode) => mode.name).join(" / ")
                      || t("No modes exposed"),
                  })
                }}
              </span>
            </button>
          </div>

          <div
            v-if="activeVariableCollection"
            id="design-variable-token-browser"
            class="variable-token-browser"
            role="tabpanel"
            :aria-labelledby="`design-variable-collection-${Math.max(0, variableCollections.findIndex((collection) => collection.id === activeVariableCollection?.id))}`"
          >
            <div class="variable-token-list" role="listbox" :aria-label="t('Shared tokens')">
              <button
                v-for="(variable, index) in collectionVariables"
                :key="variable.id"
                type="button"
                role="option"
                :aria-selected="selectedVariable?.id === variable.id"
                :tabindex="selectedVariable?.id === variable.id ? 0 : -1"
                :title="variable.name"
                @click="selectedVariableId = variable.id"
                @keydown="handleVariableKeydown($event, index)"
              >
                <span class="variable-type">{{ variable.resolvedType }}</span>
                <strong>{{ variable.name }}</strong>
                <small>
                  {{
                    variable.scopes.length
                      ? t("Used for {scopes}", {
                          scopes: variable.scopes.join(", "),
                        })
                      : t("Usage scope not exposed")
                  }}
                </small>
              </button>
              <p v-if="!collectionVariables.length" class="muted-copy">
                {{
                  t(
                    "The collection summary is available, but token names were not included in the bounded response.",
                  )
                }}
              </p>
            </div>

            <article
              v-if="selectedVariable"
              class="variable-token-detail"
              aria-live="polite"
            >
              <span class="eyebrow">{{ t("Selected shared token") }}</span>
              <h4 :title="selectedVariable.name">{{ selectedVariable.name }}</h4>
              <dl class="stacked-facts">
                <div>
                  <dt>{{ t("Collection") }}</dt>
                  <dd>{{ activeVariableCollection.name }}</dd>
                </div>
                <div>
                  <dt>{{ t("Type") }}</dt>
                  <dd>{{ selectedVariable.resolvedType }}</dd>
                </div>
                <div>
                  <dt>{{ t("Origin") }}</dt>
                  <dd>{{ uiStatusLabel(selectedVariable.origin) }}</dd>
                </div>
                <div>
                  <dt>{{ t("Usage scopes") }}</dt>
                  <dd>
                    {{
                      selectedVariable.scopes.length
                        ? selectedVariable.scopes.join(", ")
                        : t("Not exposed")
                    }}
                  </dd>
                </div>
              </dl>
              <template
                v-if="
                  activeFile?.variables.valuesIncluded
                  && selectedVariable.valuesByMode
                "
              >
                <span class="field-label">{{ t("Authorized mode values") }}</span>
                <div class="variable-mode-values">
                  <div
                    v-for="(value, modeId) in selectedVariable.valuesByMode"
                    :key="modeId"
                  >
                    <strong>{{ variableModeName(modeId) }}</strong>
                    <code>{{ variableValueLabel(value) }}</code>
                  </div>
                </div>
              </template>
              <p v-else class="evidence-note">
                {{
                  t(
                    "Exact values were not persisted. Retrieve them only on demand for a confirmed task and authorized source.",
                  )
                }}
              </p>
            </article>
          </div>
        </template>

        <div v-else class="variable-access-state" role="status">
          <AtlasIcon
            :name="
              variableAccessState === 'permission-required'
                ? 'risk'
                : 'design'
            "
          />
          <span>
            <strong>{{ variableAccessLabel() }}</strong>
            <small>{{ variableAccessCopy() }}</small>
          </span>
        </div>
        <small>
          {{
            activeFile?.variables.valuesIncluded
              ? t("Authorized values indexed")
              : t("Catalog summary only · values on demand")
          }}
        </small>
      </section>
      <section>
        <span class="eyebrow">{{ t("Design families") }}</span>
        <h3>{{ t("{count} grouped", { count: activeSummary?.families.length ?? 0 }) }}</h3>
        <div v-if="activeSummary?.families.length" class="token-list">
          <div v-for="family in activeSummary.families" :key="family.id">
            <strong>{{ family.name }}</strong>
            <span>
              {{ designFamilyKindLabel(family.kind) }} ·
              {{ family.viewportWidths.length ? `${family.viewportWidths.join(" / ")}px` : t("no viewport evidence") }}
            </span>
            <small v-if="family.observedStates.length">
              {{ t("States") }}: {{ family.observedStates.join(", ") }}
            </small>
            <small v-if="family.missingCommonStates.length">
              {{ t("Not evidenced") }}: {{ family.missingCommonStates.join(", ") }}
            </small>
          </div>
        </div>
        <p v-else class="muted-copy">
          {{ t("No responsive or storyboard family can be inferred from the sparse index.") }}
        </p>
      </section>
    </aside>
    </div>
  </div>
</template>
