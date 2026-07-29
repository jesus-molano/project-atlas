<script>
export default {
  props: {
    message: { type: String, required: true },
  },
};
</script>

<template>
  <aside><slot name="action" :dismiss="() => undefined" />{{ message }}</aside>
</template>
