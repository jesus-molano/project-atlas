<script setup lang="ts">
import type { SourceHealthViewModel } from "@component-atlas/runtime";
import type {
  ContextCostReport,
  ProjectCapabilityReport,
} from "@component-atlas/core/browser";
import type { AgentAdapterStatus } from "@component-atlas/agent";
import {
  capabilityDisplayState,
  isSimulatedCapability,
} from "~/utils/capabilities";
import { localizeSourceHealth } from "~/i18n/generated";

defineProps<{
  sources: SourceHealthViewModel[];
  capabilities: ProjectCapabilityReport;
  agent: AgentAdapterStatus;
  contextCost: ContextCostReport;
  rootPath: string;
}>();
const emit = defineEmits<{ refreshed: [] }>();
const pending = ref("");
const message = ref("");
const error = ref("");
const { formatDate, formatNumber, locale, runtimeMessage, statusLabel, t } =
  useAtlasI18n();
const sourceCopy = (source: SourceHealthViewModel) =>
  localizeSourceHealth(source, locale.value);
const labels: Record<string, string> = {
  figma: "Figma",
  "atlassian-rovo": "Atlassian Rovo",
  github: "GitHub",
  "ready-for-dev": "Ready for Dev",
  "figma-variables": "Figma Variables",
  "code-connect": "Code Connect",
  "figma-libraries": "Figma libraries",
};

function capabilityLabel(id: string): string {
  return t(labels[id] ?? id);
}

function capabilityDetail(
  source: ProjectCapabilityReport["observations"][number],
): string {
  if (!source.detail) return t("No detail reported.");
  if (source.provenance === "session-report") return source.detail;
  const countedDesign = source.detail.match(
    /^(\d+) cached design file\(s\); live session state is not assumed\.$/,
  );
  if (countedDesign) {
    return t(
      "{count} cached design files; live session state is not assumed.",
      { count: countedDesign[1] ?? "0" },
    );
  }
  const countedConnections = source.detail.match(
    /^(\d+) cached code connection\(s\)\.$/,
  );
  if (countedConnections) {
    return t("{count} cached code connections.", {
      count: countedConnections[1] ?? "0",
    });
  }
  const countedLibraries = source.detail.match(
    /^(\d+) cached library reference\(s\)\.$/,
  );
  if (countedLibraries) {
    return t("{count} cached library references.", {
      count: countedLibraries[1] ?? "0",
    });
  }
  return t(source.detail);
}

function formatFreshness(value?: string): string {
  if (!value) return t("Never indexed");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Freshness unavailable");
  return formatDate(value);
}

async function refresh(source: "repository" | "memory"): Promise<void> {
  pending.value = source;
  error.value = "";
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    await $fetch("/api/refresh", {
      method: "POST",
      headers: { "x-atlas-session": session.token },
      body: { source },
    });
    message.value =
      source === "repository"
        ? "Code Atlas rescanned this checkout."
        : "Project Memory reindexed approved Markdown.";
    emit("refreshed");
  } catch (caught) {
    error.value = atlasErrorSource(caught);
  } finally {
    pending.value = "";
  }
}
</script>

<template>
  <div class="single-workspace health-grid">
    <section>
      <header class="workspace-toolbar"><div><span class="eyebrow">{{ t("Local source plane") }}</span><h2>{{ t("Indexes and freshness") }}</h2></div></header>
      <article v-for="source in sources" :key="source.id" class="health-record">
        <span :class="['health-orb', source.status]" />
        <div><strong>{{ sourceCopy(source).label }}</strong><p>{{ sourceCopy(source).detail }}</p><small>{{ formatFreshness(source.lastIndexedAt) }}</small></div>
        <button
          v-if="source.source === 'repository' || source.source === 'memory'"
          class="secondary-button"
          :disabled="Boolean(pending)"
          @click="refresh(source.source)"
        >
          {{
            pending === source.source
              ? source.source === "repository"
                ? t("Scanning code…")
                : t("Indexing memory…")
              : source.source === "repository"
                ? t("Rescan code")
                : t("Reindex memory")
          }}
        </button>
        <span v-else class="status-chip">{{ statusLabel(source.status) }}</span>
      </article>
      <p v-if="message" class="inline-success">{{ t(message) }}</p>
      <p v-if="error" class="inline-error">{{ runtimeMessage(error) }}</p>
    </section>
    <section>
      <header class="workspace-toolbar">
        <div><span class="eyebrow">{{ t("Agent adapter") }}</span><h2>Codex</h2></div>
      </header>
      <article class="health-record optional">
        <span :class="['health-orb', agent.state]" />
        <div>
          <strong>{{ agent.label }}</strong>
          <p>{{ t(agent.detail) }}</p>
          <small>
            {{ statusLabel(agent.authentication) }} · {{ t("checked {date}", { date: formatFreshness(agent.checkedAt) }) }}
          </small>
        </div>
        <span class="status-chip">{{ statusLabel(agent.state) }}</span>
      </article>
      <article class="health-record optional">
        <span class="health-orb connected" />
        <div>
          <strong>{{ t("Context cost audit") }}</strong>
          <p>{{ t("{count} instrumented records", { count: formatNumber(contextCost.groups.find((group) => group.taskType === "all")?.runs ?? 0) }) }}</p>
          <small>
            {{ t("Median input") }}:
            {{ t("{count} tokens", { count: formatNumber(contextCost.groups.find((group) => group.taskType === "all")?.inputTokens.median ?? 0) }) }}
            ·
            {{ t("P95 input") }}:
            {{ t("{count} tokens", { count: formatNumber(contextCost.groups.find((group) => group.taskType === "all")?.inputTokens.p95 ?? 0) }) }}
            ·
            {{
              t("{actual} actual / {estimated} estimated", {
                actual: contextCost.groups.find((group) => group.taskType === "all")?.sdkRuns ?? 0,
                estimated: contextCost.groups.find((group) => group.taskType === "all")?.estimatedRuns ?? 0,
              })
            }}
          </small>
        </div>
        <span class="status-chip">{{ t("Local-first") }}</span>
      </article>
      <header class="workspace-toolbar"><div><span class="eyebrow">{{ t("Observed capabilities") }}</span><h2>{{ t("Connectors") }}</h2></div></header>
      <article v-for="source in capabilities.observations.filter((item) => item.kind === 'connector')" :key="source.id" class="health-record optional">
        <span :class="['health-orb', source.state]" /><div><strong>{{ capabilityLabel(source.id) }}</strong><p>{{ capabilityDetail(source) }}</p><small>{{ statusLabel(source.provenance) }}<template v-if="isSimulatedCapability(source)"> · {{ t("fixture claim") }}</template> · {{ formatFreshness(source.checkedAt) }}</small></div><span :class="['status-chip', { simulated: isSimulatedCapability(source) }]">{{ t(capabilityDisplayState(source)) }}</span>
      </article>
      <header class="workspace-toolbar"><div><span class="eyebrow">{{ t("Optional evidence") }}</span><h2>{{ t("Enrichments") }}</h2></div></header>
      <article v-for="source in capabilities.observations.filter((item) => item.kind === 'enrichment')" :key="source.id" class="health-record optional">
        <span :class="['health-orb', source.state]" /><div><strong>{{ capabilityLabel(source.id) }}</strong><p>{{ capabilityDetail(source) }}</p><small>{{ statusLabel(source.provenance) }}<template v-if="isSimulatedCapability(source)"> · {{ t("fixture claim") }}</template> · {{ formatFreshness(source.checkedAt) }}</small></div><span :class="['status-chip', { simulated: isSimulatedCapability(source) }]">{{ t(capabilityDisplayState(source)) }}</span>
      </article>
    </section>
    <aside class="health-policy">
      <span class="eyebrow">{{ t("Workspace isolation") }}</span>
      <h2 :title="rootPath">{{ rootPath }}</h2>
      <p>{{ t("SQLite memory and design evidence use the logical repository identity. Code snapshots remain separate per checkout/worktree.") }}</p>
      <dl class="stacked-facts">
        <div><dt>{{ t("Network on browse") }}</dt><dd>{{ t("None") }}</dd></div>
        <div><dt>{{ t("Credentials stored") }}</dt><dd>{{ t("None") }}</dd></div>
        <div><dt>{{ t("Semantic writes") }}</dt><dd>{{ t("Approval required") }}</dd></div>
        <div><dt>{{ t("Derived refresh") }}</dt><dd>{{ t("Local actions above") }}</dd></div>
      </dl>
    </aside>
  </div>
</template>
