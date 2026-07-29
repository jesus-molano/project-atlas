<script lang="ts">
import { defineComponent } from "vue";
import ChildBadge from "./ChildBadge.vue";
import { useFocus } from "../composables/useFocus";

export default defineComponent({
  name: "OptionsPanel",
  components: { ChildBadge },
  props: {
    title: { type: String, required: true },
    tone: { type: String, default: "neutral" },
  },
  emits: ["close"],
  setup() {
    const focus = useFocus();
    return { focus };
  },
});
</script>

<template>
  <section><ChildBadge :label="title" /><slot name="actions" :close="'close'" /></section>
</template>
