<script lang="ts">
export default {
  props: {
    label: { type: String, required: true },
  },
};
</script>

<template><span>{{ label }}</span></template>
