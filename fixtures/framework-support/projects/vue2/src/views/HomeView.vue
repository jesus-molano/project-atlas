<script>
import LegacyCard from "../components/LegacyCard.vue";

export default {
  name: "HomeView",
  components: { LegacyCard },
};
</script>

<template>
  <LegacyCard value="home">
    <template slot="item" slot-scope="{ value }">{{ value }}</template>
  </LegacyCard>
</template>
