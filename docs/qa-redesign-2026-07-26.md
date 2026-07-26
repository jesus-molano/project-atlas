# Project Atlas redesign QA — 2026-07-26

## Scope and evidence boundary

This QA used the inherited, uncommitted working tree and the three isolated
synthetic repositories:

- Full signal: `C:\Users\jessu\dev\atlas-trail-admin`
- Partial signal: `C:\Users\jessu\dev\atlas-pulse-storefront`
- Repository and memory only: `C:\Users\jessu\dev\atlas-local-ledger`

The laboratory's Jira, Confluence, GitHub, Figma capability, Ready for Dev, and
Code Connect observations are simulated fixture evidence. They are not claims
about live external connectors. No fixture was published and no corporate data
or secret was written.

Reproducible harness evidence is in:

- `C:\Users\jessu\Documents\Codex\2026-07-26\atlas-e2e-validation-lab\outputs\report.md`
- `C:\Users\jessu\Documents\Codex\2026-07-26\atlas-e2e-validation-lab\outputs\report.json`
- `C:\Users\jessu\Documents\Codex\2026-07-26\atlas-e2e-validation-lab\outputs\gui-qa\memory-1280x800-after.png`

The pre-fix 1280×800 capture was recorded in the interactive QA task. It showed
the inherited three-column Memory layout with all regions compressed. The saved
post-fix capture shows the 2+1 reflow; the measurements below make the comparison
reproducible without depending on the capture.

## Screen × project matrix

| Surface | Trail Admin | Pulse Storefront | Local Ledger |
| --- | --- | --- | --- |
| Overview, project picker, recent/open folder | PASS | PASS | PASS |
| Project path, branch, HEAD, checkout and clean state | PASS | PASS | PASS, including `reconciliation-lab` worktree |
| Code list, search, graph, selection, fit/reset and inspector | PASS · 24 nodes | PASS · 17 React/Next nodes | PASS · 10 nodes; 11 in linked worktree |
| Design pages, frames, families, variables and provenance | PASS · 25 indexed synthetic nodes | PASS/degraded · 10 indexed nodes | PASS/empty · no design connector or export |
| Memory map, outcomes, decisions, conflicts and superseded evidence | PASS · 8 fixture items | PASS · 3 fixture items | PASS · 8 fixture items |
| Task context, budgets, review and run lifecycle | PASS | PASS with Jira/Confluence absent | PASS with all external connectors absent |
| Review and memory inbox | PASS | PASS | PASS |
| Connections and health degradation | PASS; simulated states labelled | PASS; missing sources explicit | PASS; repository-only state explicit |
| Activity/history and project isolation | PASS | PASS | PASS, including branch/worktree switch |

Changing Trail → Pulse → Ledger no longer retains the launching project's ID,
checkout, graph, design, memory, activity, capabilities, or runs. The observed
counts changed `24/25/8 → 17/10/3 → 10/0/8`; the linked Ledger worktree exposed
its distinct 11-node graph and HEAD while retaining logical project identity.

## Code Atlas inspector correction

`Reuse`, `Change impact`, and `Associated tests` now form an accessible tablist
inside Component details. Closing the inspector removes the tablist and leaves
one graph-level action, `Inspect selected component`, which is disabled without
a selection. Reopening the drawer focuses its close button. Arrow keys,
Home/End, Escape, focus trapping, and focus restoration were exercised.

Activating `Associated tests` produced a visible tabpanel even when there were
zero linked tests, with a reason explaining that name similarity is not test
evidence. The selected evidence view remains stateful across component changes.
`scripts/code-atlas-scale.test.ts` proves that activating a view from closed
state always opens a visible inspector, while no-selection activation is a
no-op.

## Memory and shared responsive layouts

The layout is governed by the actual `.section-workspace` container width:

| View / effective scale | Useful width | Composition | Region widths | Horizontal overflow | Truncated buttons |
| --- | ---: | --- | --- | --- | --- |
| 1440×900, 100% | 1102 px | 3 columns | 290 / 482 / 330 px | none | none |
| 1280×800, 100% | 998 px | 2+1 | 320 / 678 / 998 px | none | none |
| 1152×768, 100% | 870 px | stacked | 870 / 870 / 870 px | none | none |
| 1024×768, 100% | 742 px | stacked | 742 / 742 / 742 px | none | none |
| 1280×800, 125% equivalent | 742 px | stacked | 742 / 742 / 742 px | none | none |
| 1280×800, 150% equivalent | 807 px, collapsed nav | stacked | 807 / 807 / 807 px | none | none |

Entity rows remained 54 px high and controls were not reduced to force a fit.
The Verified state and actions remain inside the selected memory detail after
reflow. Design uses the same 2+1 rule at 1280×800 (270 / 728 / 998 px), and
Connections uses 2+1 (499 / 499 / 998 px). Workbench, Review, Memory Inbox, and
Health use the shared one-column rule below a 900 px content container.
`scripts/responsive-layout.test.ts` locks the breakpoints and minimum readable
width at 1280×800.

## Corrections applied during QA

- Prevented launch-time project and checkout IDs from leaking after an in-app
  project switch.
- Moved Code evidence goals into the selected-component inspector and added
  accessible close, keyboard, focus, help, empty, and disabled behavior.
- Reflowed shared three-pane layouts using container queries instead of only
  viewport media queries.
- Reworded simulated connector and Figma metadata so the UI cannot imply live
  Ready for Dev, Code Connect, or external connector verification.
- Made the default Memory status filter explicit (`Active by default`) while
  preserving access to superseded evidence.
- Added clean-test Nuxt preparation and removed prohibited product-surface
  terminology found by the audit.

## Verification

- Laboratory: **54 passed, 0 failed**
- Vitest: **34 files, 99 tests passed**
- Typecheck: **passed**
- Production build: **passed**
- Product-surface audit: **passed across 82 source files**
- Fixture git isolation: **all three clean; no remotes; Atlas artifacts ignored**

The production build emits non-fatal bundler warnings for optional template
engines and `node:sqlite`; it completes successfully. Repeated laboratory runs
can create a synthetic Trail outcome, but the final harness explicitly removed
the prior outcome before reindexing. That is a fixture lifecycle behavior, not
cross-project memory leakage.
