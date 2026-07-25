<script setup lang="ts">
const props = defineProps<{ modelValue: { budgetChars: number; topK: number; includeInactive: boolean } }>();
const emit = defineEmits<{ "update:modelValue": [value: { budgetChars: number; topK: number; includeInactive: boolean }] }>();
const local = reactive({ ...props.modelValue });
watch(local, (value) => emit("update:modelValue", { ...value }), { deep: true });
</script>

<template>
  <div class="settings-layout">
    <section class="settings-panel">
      <header><span class="eyebrow">Agent context policy</span><h2>Compact retrieval defaults</h2><p>These controls alter only explicit context composition. They never limit human browsing.</p></header>
      <label class="range-setting">
        <span><strong>Default character budget</strong><small>Hard-clamped by the runtime to 800–12,000 characters.</small></span>
        <output>{{ local.budgetChars.toLocaleString() }}</output>
        <input v-model.number="local.budgetChars" type="range" min="800" max="12000" step="200">
      </label>
      <label class="range-setting">
        <span><strong>Default top-k</strong><small>Prefer a few explainable candidates before expansion.</small></span>
        <output>{{ local.topK }}</output>
        <input v-model.number="local.topK" type="range" min="1" max="10" step="1">
      </label>
      <label class="toggle-setting"><span><strong>Include inactive memory in diagnostics</strong><small>Superseded and archived knowledge stays excluded from normal task retrieval.</small></span><input v-model="local.includeInactive" type="checkbox"></label>
    </section>
    <section class="settings-panel">
      <header><span class="eyebrow">Storage & privacy</span><h2>One core, explicit authority</h2></header>
      <dl class="policy-list">
        <div><dt>Derived repository and Figma facts</dt><dd>SQLite · automatically reconstructible</dd></div>
        <div><dt>Shared project knowledge</dt><dd>Markdown · optionally versioned by the team</dd></div>
        <div><dt>Personal and episodic memory</dt><dd>Local ignored Markdown + SQLite</dd></div>
        <div><dt>Hypotheses</dt><dd>Marked inferred · never promoted as facts</dd></div>
        <div><dt>Secrets</dt><dd>Preventive detection · write rejected</dd></div>
      </dl>
    </section>
    <section class="settings-panel">
      <header><span class="eyebrow">Write policy</span><h2>Human control points</h2></header>
      <div class="policy-flow">
        <span>Agent proposes</span><i>→</i><span>Evidence reviewed</span><i>→</i><span>Approve / revise / reject</span><i>→</i><span>Durable memory</span>
      </div>
      <p class="muted-copy">Project Atlas does not confirm decisions, conventions, or conclusions automatically.</p>
    </section>
  </div>
</template>
