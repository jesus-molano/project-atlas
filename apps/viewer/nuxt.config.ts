export default defineNuxtConfig({
  compatibilityDate: "2026-01-01",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  app: {
    head: {
      title: "Project Atlas",
      meta: [
        {
          name: "description",
          content:
            "A local evidence and decision workspace for code, design, and project memory.",
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
