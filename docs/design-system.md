# Project Atlas visual primitives

Project Atlas keeps its existing Waypoint Signal visual language. Reusable
visual decisions live in `apps/viewer/app/assets/css/main.css`; view components
should consume semantic variables and shared classes instead of introducing a
new color, control, or card treatment.

## Tokens

- Surfaces: `--atlas-ground`, `--atlas-rail`, `--atlas-canvas`,
  `--atlas-raised`, `--atlas-dialog`.
- Text and borders: `--atlas-ink`, `--atlas-ink-muted`,
  `--atlas-ink-faint`, `--atlas-rule`, `--atlas-control-border`.
- Actions and states: `--atlas-accent`, `--atlas-focus`,
  `--atlas-success`, `--atlas-warning`, `--atlas-danger`, `--atlas-info`.
- Section accent: `--atlas-section-accent` changes with the active navigation
  section and is also used by its thin scrollbar.
- Type: `--atlas-text-xs`, `--atlas-text-sm`, `--atlas-text-control`,
  `--atlas-text-body`, plus the `--atlas-weight-*` and font-family tokens.
- Spacing: `--atlas-space-1` through `--atlas-space-8`.
- Shape and elevation: `--atlas-radius-sm|md|lg|pill`,
  `--atlas-elevation-raised|dialog`.
- Controls: `--atlas-control-sm|md|lg` and `--atlas-control-check`.
- Layout references: compact 620px, tablet 900px, laptop 1100px, desktop
  1360px. CSS custom properties cannot drive media-query conditions, so the
  documented `--atlas-breakpoint-*` values and the query literals must remain
  in sync.

## Shared patterns

- Buttons: `.primary-button`, `.secondary-button`, `.text-button`, and
  `.danger-button`. Use `.mini-loader` inside the same button while saving.
  Disabled state is shared globally.
- Inputs: native input, select, textarea, checkbox, and radio rules provide
  consistent sizing and focus. Do not add a view-level width to radio or
  checkbox controls.
- Compact state labels: `.status-chip`, `.scope-badge`, `.result-state`,
  `.capability-pill`, and `.heading-count`. They never shrink into vertical
  text; their parent should wrap instead.
- Status messages: `.inline-success`, `.inline-error`, and `.inline-info`.
- Destructive confirmation: `.destructive-confirmation` pairs an explanation,
  `.danger-button`, and a cancel action.
- Long-scroll recovery: `ScrollToTopButton` observes an explicitly supplied
  scroll owner and renders the shared `.scroll-to-top-button` only after both
  distance and overflow thresholds are met. It is an icon-only 44px control
  with localized accessible name/tooltip; use `placement="panel"` for an
  independently scrolling catalog or inspector.
- Cards and panels should use semantic surface, border, radius, spacing, and
  elevation tokens. Content-specific grid structure stays with its view.

All primitives must tolerate long Spanish and English labels. At compact
widths, actions should wrap or become full-width; critical text must not be
clipped.
