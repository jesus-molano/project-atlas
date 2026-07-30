<script setup lang="ts">
import type { ContextCostReport } from "@component-atlas/core/browser";

interface SettingsModel {
  budgetChars: number;
  topK: number;
  includeInactive: boolean;
  localMetrics: boolean;
}

const props = defineProps<{
  modelValue: SettingsModel;
  evaluationCount?: number;
  contextCost: ContextCostReport;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: SettingsModel];
  clearMetrics: [];
}>();
const { formatNumber, t } = useAtlasI18n();
const local = reactive({ ...props.modelValue });
const contextCostSummary = computed(() =>
  props.contextCost.groups.find((group) => group.taskType === "all"),
);
const confirmMetricsClear = ref(false);
watch(local, (value) => emit("update:modelValue", { ...value }), { deep: true });
watch(
  () => props.evaluationCount,
  (count) => {
    if (!count) confirmMetricsClear.value = false;
  },
);

function clearMetrics(): void {
  emit("clearMetrics");
  confirmMetricsClear.value = false;
}
</script>

<template>
  <div class="settings-layout">
    <section class="settings-panel">
      <header><span class="eyebrow">{{ t("Agent context policy") }}</span><h2>{{ t("Compact retrieval defaults") }}</h2><p>{{ t("These controls alter only explicit context composition. They never limit human browsing.") }}</p></header>
      <label class="range-setting">
        <span><strong>{{ t("Default character budget") }}</strong><small>{{ t("Hard-clamped by the runtime to 800–12,000 characters.") }}</small></span>
        <output>{{ formatNumber(local.budgetChars) }}</output>
        <input v-model.number="local.budgetChars" type="range" min="800" max="12000" step="200">
      </label>
      <label class="range-setting">
        <span><strong>{{ t("Default top-k") }}</strong><small>{{ t("Prefer a few explainable candidates before expansion.") }}</small></span>
        <output>{{ local.topK }}</output>
        <input v-model.number="local.topK" type="range" min="1" max="10" step="1">
      </label>
      <label class="toggle-setting"><span><strong>{{ t("Include inactive memory in diagnostics") }}</strong><small>{{ t("Superseded and archived knowledge stays excluded from normal task retrieval.") }}</small></span><input v-model="local.includeInactive" type="checkbox"></label>
      <label class="toggle-setting">
        <span>
          <strong>{{ t("Local product metrics") }}</strong>
          <small>
            {{ t("Opt in to content-free aggregates: time, context size, gates, and correction state. Task text is stored only as a one-way fingerprint.") }}
          </small>
        </span>
        <input v-model="local.localMetrics" type="checkbox">
      </label>
      <div class="settings-inline-action">
        <span>{{ t("{count} local records · no telemetry", { count: evaluationCount ?? 0 }) }}</span>
        <div v-if="confirmMetricsClear" class="destructive-confirmation" role="group" :aria-label="t('Confirm local metrics deletion')">
          <span>{{ t("This removes local content-free evaluation records. It cannot be undone.") }}</span>
          <button class="danger-button" @click="clearMetrics">
            {{ t("Clear {count} local records", { count: evaluationCount ?? 0 }) }}
          </button>
          <button class="text-button" @click="confirmMetricsClear = false">{{ t("Cancel") }}</button>
        </div>
        <button
          v-else
          class="danger-button"
          :disabled="!evaluationCount"
          @click="confirmMetricsClear = true"
        >
          {{ t("Clear local metrics") }}
        </button>
      </div>
      <dl class="policy-list">
        <div>
          <dt>{{ t("Context cost audit") }}</dt>
          <dd>{{ t("{count} measured runs", { count: formatNumber(contextCostSummary?.runs ?? 0) }) }}</dd>
        </div>
        <div>
          <dt>{{ t("Median input") }}</dt>
          <dd>{{ t("{count} tokens", { count: formatNumber(contextCostSummary?.inputTokens.median ?? 0) }) }}</dd>
        </div>
        <div>
          <dt>{{ t("P95 input") }}</dt>
          <dd>{{ t("{count} tokens", { count: formatNumber(contextCostSummary?.inputTokens.p95 ?? 0) }) }}</dd>
        </div>
      </dl>
      <p class="muted-copy">{{ t("Cross-device audits move only through explicit CLI export and import.") }}</p>
    </section>
    <section class="settings-panel">
      <header><span class="eyebrow">{{ t("Storage & privacy") }}</span><h2>{{ t("One core, explicit authority") }}</h2></header>
      <dl class="policy-list">
        <div><dt>{{ t("Derived repository and Figma facts") }}</dt><dd>{{ t("SQLite · automatically reconstructible") }}</dd></div>
        <div><dt>{{ t("Shared project knowledge") }}</dt><dd>{{ t("Markdown · optionally versioned by the team") }}</dd></div>
        <div><dt>{{ t("Personal and episodic memory") }}</dt><dd>{{ t("Local ignored Markdown + SQLite") }}</dd></div>
        <div><dt>{{ t("Hypotheses") }}</dt><dd>{{ t("Marked inferred · never promoted as facts") }}</dd></div>
        <div><dt>{{ t("Secrets") }}</dt><dd>{{ t("Preventive detection · write rejected") }}</dd></div>
      </dl>
    </section>
    <section class="settings-panel">
      <header><span class="eyebrow">{{ t("Write policy") }}</span><h2>{{ t("Human control points") }}</h2></header>
      <div class="policy-flow">
        <span>{{ t("Agent proposes") }}</span><AtlasIcon name="arrow-right" /><span>{{ t("Evidence reviewed") }}</span><AtlasIcon name="arrow-right" /><span>{{ t("Approve / revise / reject") }}</span><AtlasIcon name="arrow-right" /><span>{{ t("Durable memory") }}</span>
      </div>
      <p class="muted-copy">{{ t("Project Atlas does not confirm decisions, conventions, or conclusions automatically.") }}</p>
    </section>
  </div>
</template>
