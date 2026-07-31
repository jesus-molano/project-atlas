import { createConfigForNuxt } from "@nuxt/eslint-config/flat";

export default createConfigForNuxt({
  dirs: {
    root: ["apps/viewer"],
    src: ["apps/viewer/app"],
    components: ["apps/viewer/app/components"],
    composables: ["apps/viewer/app/composables"],
    pages: ["apps/viewer/app/pages"],
    servers: ["apps/viewer/server"],
  },
  features: {
    stylistic: {
      indent: 2,
      quotes: "double",
      semi: true,
      commaDangle: "always-multiline",
    },
    typescript: {
      strict: true,
    },
  },
})
  .prepend({
    name: "atlas/ignores",
    ignores: [
      "**/.cache/**",
      "**/.component-atlas/**",
      "**/.nuxt/**",
      "**/.output/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "apps/viewer/app/i18n/generated.ts",
      "fixtures/**",
      "frontend-codex-kit/**",
      "skills/**",
    ],
  })
  .append({
    name: "atlas/project-rules",
    rules: {
      "import/first": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@stylistic/arrow-parens": ["error", "always"],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
      "@stylistic/indent": "off",
      "@stylistic/indent-binary-ops": "off",
      "@stylistic/operator-linebreak": "off",
      "@stylistic/quote-props": ["error", "as-needed"],
      "no-control-regex": "off",
      "vue/component-name-in-template-casing": [
        "error",
        "PascalCase",
        { registeredComponentsOnly: false },
      ],
      "vue/html-indent": "off",
      "vue/max-attributes-per-line": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  })
  .append({
    name: "atlas/typescript-rules",
    files: ["**/*.{ts,tsx,vue}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  })
  .append({
    name: "atlas/scripts",
    files: ["scripts/**/*.{js,mjs,ts}", "eslint.config.mjs"],
    rules: {
      "no-console": "off",
    },
  });
