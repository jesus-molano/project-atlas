<script setup lang="ts">
import type { SourceHealthViewModel } from "@component-atlas/runtime";

defineProps<{
  sources: SourceHealthViewModel[];
  rootPath: string;
  localHealth: Array<{
    id: string;
    level: "warning";
    title: string;
    detail: string;
    recommendation: string;
  }>;
}>();
const emit = defineEmits<{ refreshed: [] }>();
const pending = ref("");
const message = ref("");
const error = ref("");
const optional = [
  { id: "jira", label: "Jira", status: "optional", detail: "Detected by frontend-task when a connector or ticket link exists." },
  { id: "confluence", label: "Confluence", status: "optional", detail: "Used only when the task supplies relevant documentation." },
  { id: "code-connect", label: "Figma Code Connect", status: "optional", detail: "Adds design-to-code evidence when the organization already maintains mappings." },
];

async function refresh(source: "repository" | "memory"): Promise<void> {
  pending.value = source;
  error.value = "";
  try {
    await $fetch("/api/refresh", { method: "POST", body: { source } });
    message.value = `${source} index refreshed.`;
    emit("refreshed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    pending.value = "";
  }
}
</script>

<template>
  <div class="single-workspace health-grid">
    <section>
      <header class="workspace-toolbar"><div><span class="eyebrow">Local source plane</span><h2>Indexes and freshness</h2></div></header>
      <article v-for="source in sources" :key="source.id" class="health-record">
        <span :class="['health-orb', source.status]" />
        <div><strong>{{ source.label }}</strong><p>{{ source.detail }}</p><small>{{ source.lastIndexedAt ?? "Never indexed" }}</small></div>
        <button
          v-if="source.source === 'repository' || source.source === 'memory'"
          class="secondary-button"
          :disabled="Boolean(pending)"
          @click="refresh(source.source)"
        >
          {{ pending === source.source ? "Refreshing…" : "Refresh" }}
        </button>
        <span v-else class="status-chip">{{ source.status }}</span>
      </article>
      <p v-if="message" class="inline-success">{{ message }}</p>
      <p v-if="error" class="inline-error">{{ error }}</p>
      <article
        v-for="finding in localHealth"
        :key="finding.id"
        class="health-record optional"
      >
        <span class="health-orb stale" />
        <div>
          <strong>{{ finding.title }}</strong>
          <p>{{ finding.detail }}</p>
          <code>{{ finding.recommendation }}</code>
        </div>
        <span class="status-chip">setup</span>
      </article>
    </section>
    <section>
      <header class="workspace-toolbar"><div><span class="eyebrow">Optional enrichment</span><h2>Connectors degrade gracefully</h2></div></header>
      <article v-for="source in optional" :key="source.id" class="health-record optional">
        <span class="health-orb unavailable" /><div><strong>{{ source.label }}</strong><p>{{ source.detail }}</p></div><span class="status-chip">optional</span>
      </article>
    </section>
    <aside class="health-policy">
      <span class="eyebrow">Workspace isolation</span>
      <h2>{{ rootPath }}</h2>
      <p>SQLite, design indexes, and memory queries are scoped by the deterministic project ID for this repository.</p>
      <dl class="stacked-facts">
        <div><dt>Network on browse</dt><dd>None</dd></div>
        <div><dt>Credentials stored</dt><dd>None</dd></div>
        <div><dt>Semantic writes</dt><dd>Approval required</dd></div>
        <div><dt>Derived refresh</dt><dd>Local actions above</dd></div>
      </dl>
    </aside>
  </div>
</template>
