<script lang="ts">
import { defineComponent } from "vue";
import OptionsPanel from "./components/OptionsPanel.vue";

export default defineComponent({
  name: "App",
  components: { OptionsPanel },
});
</script>

<template><OptionsPanel title="Options" /></template>
