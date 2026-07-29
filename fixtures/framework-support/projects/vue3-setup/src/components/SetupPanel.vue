<script lang="ts">
export const panelRole = "region";
</script>

<script setup lang="ts">
import SetupPanelPreview from "./SetupPanelPreview.vue";
import { usePanel } from "../composables/usePanel";

defineOptions({ inheritAttrs: false });
const props = defineProps({
  title: { type: String, required: true },
  compact: Boolean,
});
const emit = defineEmits(["close"]);
defineSlots<{
  default(props: { title: string }): unknown;
  actions(props: { close: () => void }): unknown;
}>();
defineModel<boolean>("open", { default: false });
usePanel(props.title);
void emit;
</script>

<template>
  <section><SetupPanelPreview /><slot :title="title" /></section>
</template>
