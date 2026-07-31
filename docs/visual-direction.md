# Project Atlas visual direction

This document is the visual source of truth for the desktop workspace. It is
specific to Project Atlas and should not be copied into a generic design skill.

## Concept: Waypoint Signal

Atlas is a calm working surface for navigating a project, assembling evidence,
and deciding what to change. Its cartographic character comes from orientation,
routes, provenance, and layers—not from ornamental maps or free-form graphs.

The interface should feel like a precise contemporary route-finding instrument:

- neutral black and graphite working planes without blue, green, or sepia tint;
- soft high-contrast text rather than pure white;
- coral vermilion for primary action, active location, selection, and focus;
- green only for success, with distinct error, warning, information, and
  evidence-category colors;
- open working planes separated by alignment and quiet rules, not nested cards;
- readable language first, metadata second;
- one obvious next action in each context.

## Product principles

1. **Orient before detail.** Project, checkout, branch, section, freshness, and
   attention state remain visible without competing with the task.
2. **Evidence earns space.** Counts and metadata appear only when they support a
   decision or action.
3. **Progressive disclosure.** Common paths are immediate. Advanced sources,
   budgets, and technical provenance expand on request.
4. **One plane, optional inspector.** Lists and content share a continuous
   workspace. A contextual inspector appears only when a selection needs detail.
5. **Actions declare their cost.** Local, agent-assisted, and external actions
   use explicit labels and never rely on color alone.
6. **No decorative controls.** Every visible control works, explains why it is
   unavailable, or is removed.

## Typography

- UI family: `Segoe UI Variable`, `Inter Variable`, then system sans-serif.
- Code and identifiers: `Cascadia Code`, then system monospace.
- Base text: 14px at normal desktop widths, 15px in reading passages.
- Supporting text: 12px minimum. Monospace metadata is never smaller than 11px.
- Page title: 28–32px / 1.15, weight 650.
- Section title: 18–20px / 1.25, weight 620.
- Labels and controls: 13–14px / 1.35.
- Reading width: 68–76 characters for explanations.

All body copy must remain legible at 125% and 150% browser zoom without
horizontal text clipping.

## Color tokens

The default theme is a low-glare dark theme for sustained desktop use.

| Role | Token | Reference |
| --- | --- | --- |
| App ground | `--atlas-ground` | neutral black `#090a0d` |
| Navigation | `--atlas-rail` | neutral graphite `#0e1014` |
| Workspace | `--atlas-canvas` | neutral graphite `#14171c` |
| Raised control | `--atlas-raised` | `#1b1f26` |
| Divider | `--atlas-rule` | `#303540` |
| Primary text | `--atlas-ink` | soft white `#f1f3f5` |
| Secondary text | `--atlas-ink-muted` | `#a8afba` |
| Quiet text | `--atlas-ink-faint` | `#7f8794` |
| Primary action | `--atlas-accent` | waypoint coral `#ff5b4d` |
| Success | `--atlas-success` | `#73bd8a` |
| Code/local evidence | `--atlas-local` | steel `#83a7c4` |
| Design evidence | `--atlas-design` | brass `#c4a663` |
| Memory | `--atlas-memory` | muted mauve `#b98eaa` |
| Information | `--atlas-info` | steel blue `#7fa4c0` |
| Error | `--atlas-danger` | berry `#d86f91` |
| Warning | `--atlas-warning` | amber `#d8aa5d` |
| Focus | `--atlas-focus` | signal coral `#ff7469` |

Muted text and controls must meet WCAG AA against their actual backgrounds.
Status is always communicated by icon and text, never by color alone. Coral
means location, selection, focus, or intentional action; it does not replace
semantic state colors.

## Iconography

Use one 20px, 1.7px-stroke, round-cap inline SVG family. Icons are semantic:
home, folder, search, code, layers, memory, task, shield, inbox, plug, settings,
refresh, play, chevron, Git branch, warning, and check. Navigation always pairs
an icon with a text label when the rail is expanded. Tooltips name icon-only
controls. The Waypoint A mark is branding only.

The Atlas brand mark is **Waypoint A**: a continuous route that bends into an
abstract `A` through exactly four unlabeled map nodes. The curved cross-route
passes through the coral waypoint; the remaining route and nodes use interface
ink. This softer construction is preferred over the basic angular and denser
constellation alternatives because it feels drawn from a mapped path while
remaining recognizable at 16 and 20px. The SVG is decorative beside the
accessible `Project Atlas` name.

Do not use arbitrary triangles, circles, squares, letter sigils, or Unicode
glyphs as functional icons.

## Grid and spacing

- Desktop shell: 240–264px navigation, flexible workspace, optional
  300–340px inspector.
- Workspace maximum reading width: 1180px; data explorers may use the full
  available width.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px.
- Control heights: 36px compact, 40px default, 44px primary task action.
- Minimum pointer target: 36×36px; primary controls target 40×40px or larger.
- Page padding: 32px wide, 24px laptop, 18px compact.
- Use a single 1px divider between functional regions. Avoid borders around
  regions already separated by spacing or background.

## Composition

### Use

- a persistent project and checkout switcher at the top of the navigation;
- a narrow utility bar for global search and current Git state;
- a page heading with one sentence describing its human purpose;
- continuous list/detail layouts with sticky local toolbars;
- inline status and empty-state actions;
- an inspector that opens for evidence, provenance, and advanced options.

### Do not use

- cards inside cards;
- three permanent columns when one is empty;
- a dashboard of counts without actions;
- repeated headings for the same hierarchy level;
- microcopy below every navigation item;
- all source, budget, and agent controls before a task is described;
- graphs without search, selection, explanation, and an action.

## Motion

Motion is functional and restrained:

- 120–180ms opacity/translate transitions for popovers and inspectors;
- no looping decorative animation;
- progress uses text and determinate state where possible;
- `prefers-reduced-motion` removes nonessential transitions.

## Acceptance examples

**Good:** “Open project” is the primary action in an empty workspace. Recent
projects are readable rows with path, last opened time, and Git state. Selecting
one activates it and returns to the last useful section.

**Bad:** A single project row that opens a diagnostic popover while adding a
project is impossible or hidden.

**Good:** Native Codex receives a compact locked visual contract with exact
source IDs and expands only a named handle when required.

**Bad:** A generic frontend task automatically loads Jira, Figma, budgets,
execution modes, and complete source bodies before the plan is formed.

**Good:** Code Atlas offers “What can I reuse?”, “What changes?”, and “Where is
it tested?” as clear modes, then reveals evidence for the selected component.

**Bad:** A graph, multiple legends, filters, relation toggles, and an inspector
all compete before a component is selected.

## QA checklist

Review every release at 1440×900, 1100×760, and 780×760, plus 125% and 150%
zoom:

- project, checkout, branch, section, freshness, and next action are clear;
- base copy is readable without zooming;
- no nested-border “iframe” effect;
- no ambiguous functional glyphs;
- primary action is unique per context;
- empty, loading, error, stale, conflict, and disabled states explain recovery;
- keyboard order follows the visual order and focus is always visible;
- no clipped labels, overlapping controls, or unintended horizontal scrolling.
