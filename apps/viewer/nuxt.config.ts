export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      title: "Component Atlas",
      meta: [
        {
          name: "description",
          content: "A local reuse map for the components in your codebase.",
        },
      ],
    },
  },
  nitro: {
    preset: "node-server",
  },
  typescript: {
    strict: true,
  },
});
