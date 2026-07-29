<script>
import Vue from "vue";
import trackable from "../mixins/trackable";

export default Vue.extend({
  name: "LegacyCard",
  mixins: [trackable],
  model: { prop: "value", event: "change" },
  props: {
    value: { type: String, required: true },
    compact: Boolean,
  },
  emits: ["change"],
});
</script>

<template>
  <article class="legacy-card">
    <slot name="item" :value="value" />
  </article>
</template>
