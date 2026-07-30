export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: [
    "**/.nuxt/**",
    "**/.output/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
  ],
  rules: {
    "alpha-value-notation": null,
    "color-function-notation": null,
    "comment-empty-line-before": null,
    "custom-property-pattern": null,
    "declaration-empty-line-before": null,
    "media-feature-range-notation": null,
    "no-descending-specificity": null,
    "selector-class-pattern": null,
    "selector-id-pattern": null,
  },
};
