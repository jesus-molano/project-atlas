import { createRequire } from "node:module";

const resolveFromVueAdapter = createRequire(
  new URL("../../packages/adapter-vue/package.json", import.meta.url),
);
const vueSfcParser = resolveFromVueAdapter.resolve(
  "@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js",
);

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
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          sizes: "any",
          href: "/favicon.svg",
        },
      ],
    },
  },
  nitro: {
    preset: "node-server",
    alias: {
      // Atlas only parses SFC descriptors. The Node build also embeds
      // @vue/consolidate, whose optional template engines become eager
      // imports when Nitro bundles it and then fail in a clean production
      // install. The browser build is self-contained and keeps parse().
      "@vue/compiler-sfc": vueSfcParser,
    },
  },
  typescript: {
    strict: true,
  },
});
