# Project Atlas UX/UI and i18n audit — 2026-07-28

## Scope and evidence boundary

This audit covers the complete local Project Atlas viewer. It uses only the
repository's synthetic Vue, Figma, capability, and Project Memory fixtures in an
isolated `COMPONENT_ATLAS_HOME`. No live connector, credential, corporate
repository, or external user data is required or claimed.

The UI is validated in English and Spanish. Indexed component names, file paths,
code, Figma node names, memory titles/body, and other project-owned evidence
remain unchanged when the UI locale changes.

## Flow and state inventory

| Surface | Primary flow | Required secondary states |
| --- | --- | --- |
| Project launcher / Home | Start Atlas with no active project, inspect/open a folder, or resume a recent project; understand checkout and source health | explicit no-project state, first run, cancelled picker, invalid path, inspection, scan/loading, launcher error/retry, no recent projects, recent project unavailable, clean/dirty checkout, attention empty/populated, direct-path compatibility |
| Project / branch / worktree switcher | Distinguish the logical project, checkout/worktree, branch, and working-tree state before switching | active destination, long project/branch/worktree names, clean/dirty, available/unavailable, preview/confirmation, switching, error, full-value tooltip/details, compact navigation |
| Code Atlas | Filter catalog, select a component, inspect graph, open evidence in Workbench | no results, graph selection, inspector open/closed, impact/reuse/tests tabs, no tests/no consumers, graph controls |
| Design Atlas | Select a file, page, frame/state, browse the global Variables catalog, and prepare a design-backed task | no design source, file/page selection, node selection, status unavailable, Ready for Dev/completed, global/selection-only/permission-required/unavailable Variables states, libraries/Code Connect provenance |
| Project Memory | Filter and select durable knowledge; inspect relations and provenance | cold start, active/superseded/archived filters, selection, no filter results, stale/conflicting evidence |
| Task Workbench | Describe outcome, confirm sources, prepare bounded context, review and launch | pristine, validation warning, source pending/confirm/omit/replace, context loading/error/success, permissions review, run progress/question/success/failure/cancel, activity history |
| Action Center | Review, filter, select, and resolve evidence-backed actions | empty, selection, bulk selection, decision/risk/warning groups, resolution form, stale/error/success, activity |
| Memory Inbox | Review, revise, approve, reject, or combine proposals | empty, selection, review/edit, local/canonical target, validation/error/success, applied/rejected |
| Connections | Inspect local indexes, connector permissions, enrichments, and policy | connected/detected/degraded/unavailable/not exposed/permission required/unknown, refresh loading/error/success |
| Settings | Adjust context/privacy preferences and clear local metrics | persisted values, toggles on/off, destructive confirmation/error, no metrics |
| Global shell | Navigate, search across sources, change locale and project | collapsed/expanded navigation, search pristine/loading/error/empty/results, keyboard shortcuts, focus/escape behavior |

## Viewport matrix

Every populated primary surface and every global overlay is checked at:

| Label | Viewport |
| --- | --- |
| Desktop | 1440 × 900 |
| Laptop | 1280 × 800 |
| Tablet | 768 × 1024 |
| Compact | 390 × 844 |

State-specific checks use the smallest viewport most likely to expose the issue,
plus desktop when the state changes the information architecture (inspectors,
three-pane layouts, permissions, and activity).

## Acceptance checks

- No viewport-level horizontal overflow.
- Controls keep a minimum usable pointer target without oversized native
  toggles, unexplained dead space, or clipped labels.
- Heading, toolbar, pane, inspector, and empty-state alignment remains coherent
  at every breakpoint.
- Project identity never relies on color alone: the logical project, active
  checkout/worktree, branch, and dirty state have explicit labels. Long values
  truncate without altering layout and expose their full value accessibly.
- Switching projects presents an unambiguous destination preview before the
  local workspace changes, including availability and dirty-state context when
  known.
- Keyboard focus, accessible names, dialog semantics, status announcements, and
  reduced-motion behavior remain available.
- All Project Atlas-authored UI copy, form labels, accessible names, status
  labels, and errors is available in English and Spanish.
- Locale is visibly selectable and persists locally; project evidence is never
  translated.
- Empty, loading, error, permission, selection, inspector, and activity states
  are either visually exercised or explicitly documented as environment-limited.

## Results

### Shared architecture

The viewer remains a bidirectional presentation of shared runtime contracts. It
does not own a parallel product state machine: scans, project activation,
action resolutions, Memory Inbox decisions, task runs, permissions, and stored
results continue through their existing server/runtime contracts. New local
state is limited to presentation concerns such as open panels, pending
indicators, locale, filters, and a destination preview before activation.

### Implemented corrections

- Added a visible, cookie-persisted EN/ES selector and a maintainable message
  catalog. Static UI, accessible names, validation/errors, source health,
  Action Center analyses, recommendations, and Memory Inbox product-generated
  findings localize at render time. Indexed evidence, code, paths, Figma names,
  and user-authored memory remain untouched. Dynamic runtime state is retained
  as semantic keys/raw Atlas status codes and translated at render, so changing
  locale cannot leave a visible error, proposal decision, or Figma sync state
  in the previous language.
- Consolidated semantic visual tokens and shared button, control, chip, status,
  card, destructive-confirmation, focus, and scrollbar patterns. The local
  metrics action now uses the shared destructive pattern. Priority/status chips
  cannot collapse into accidental vertical text.
- Reworked the existing no-project launcher without replacing its contracts.
  Expected absence of `/api/workspace` no longer reaches Nuxt's generic error
  boundary; users remain in a localized, recoverable launcher. Recent projects,
  path entry/drop, invalid/cancelled selection, inspection, scanning, retry,
  and direct-path activation remain supported.
- Added an explicit project destination inspection step. Logical project,
  checkout/worktree, branch, dirty/clean state, and full paths are separated
  before activation. The desktop/tablet trigger uses a bounded two-line
  hierarchy, the compact trigger is a centered 44px control, and the inspector
  wraps critical long values on touch while recent rows use intentional
  truncation plus a complete destination preview. The top-bar checkout/branch
  summary is constrained independently so it cannot overlap source health or
  locale controls.
- Improved the Windows loopback folder picker so its PowerShell dialog has an
  owner and is promoted topmost/foreground. The UI immediately announces the
  pending native dialog, explains how to recover it with Alt+Tab, and retains
  path paste/drop as a fallback when a native picker is unavailable or hidden.
- Corrected Code Atlas entry so it starts with no implicit component selection.
  Component details open only after an explicit choice (or an intentional deep
  link). Catalog names/paths expose full values, scope tabs wrap at laptop
  widths, and a selected graph label wraps and recenters away from the inspector
  while related labels are de-emphasized.
- Corrected Action Center native control sizing and rebuilt "Resolution with
  provenance" as readable selectable cards with wrapping, focus, checked
  states, full evidence, localized copy, and stacked compact actions.
- Removed Memory Inbox proposal overlap caused by an inherited three-column
  grid. Long proposal text wraps without hiding critical information; pending,
  applied, and rejected states retain clear hierarchy and compact actions.
  Approve/Reject now appear immediately below the selected proposal heading;
  each reveals its runtime-backed target or rejection confirmation in place,
  before any long delta/evidence content. Selection moves focus and the compact
  scroll position to this decision region.
- Added one reusable long-scroll recovery primitive. It observes the supplied
  launcher/workspace/catalog/inspector scroll owner, stays absent for short
  content, and renders only a themed arrow icon with a localized accessible
  name/tooltip. The global workspace covers Design, Memory, Workbench, Inbox,
  Connections, and Settings; Code catalog and Action Center inspector use the
  same primitive for their independent scroll ownership.
- Added a navigable Design Atlas Variables catalog for existing normalized
  catalog data. It distinguishes global Variables from selection-only fallback
  and explicitly represents permission-required, unavailable, and no-data
  states. Exact values appear only when the contract says they were included.
  Technical global-variable discovery/synchronization was delivered separately
  and remains behind the same shared runtime contracts.

### Visual coverage

- Live synthetic workspace: Home/Project, Code Atlas, Design Atlas, Project
  Memory, Task Workbench, Action Center, Memory Inbox, Connections, and
  Settings were inspected at laptop width with representative code, design,
  memory, capability, dirty-checkout, action, proposal, and evaluation data.
- Compact (390 px): launcher, project/worktree/branch preview, Home navigation,
  Action Center including provenance resolution, and Memory Inbox including
  long proposal content and all proposal statuses were exercised in both UI
  languages where copy density materially changes layout.
- Tablet (768 px) and desktop (1440 px) shell/layout captures verified the
  breakpoint transitions, navigation, text hierarchy, thematic scrollbar, and
  absence of viewport-level horizontal overflow. The in-app responsive pass
  measured `scrollWidth === clientWidth` for the project popover at tablet and
  compact widths and zero document overflow at all three exact sizes.
- Real project switching used three isolated temporary checkouts: a clean
  `release` repository, a clean primary `main` checkout, and a linked worktree
  with deliberately long checkout/branch names plus one unstaged file. The
  viewer switched through all three using the shared activation contract.
  Recent ordering, common logical project identity, distinct checkout identity,
  clean/dirty state, preview, and confirmation were verified without modifying
  this worktree.
- The native Windows folder dialog was opened from the launcher. Its OS window
  was observed as an owned topmost `#32770` dialog; cancellation returned focus
  to a localized recoverable state. An invalid pasted path was also exercised.
- Empty/error states that require destructive removal of the populated audit
  dataset were validated through the isolated no-project instance and automated
  contracts rather than mutating the main synthetic workspace.

### Automated validation

- `pnpm test`: 46 test files, 180 tests passed.
- Focused UX/i18n/project suite: 7 files, 45 tests passed.
- `pnpm --filter @component-atlas/viewer typecheck`: passed.
- `pnpm --filter @component-atlas/viewer build`: passed. The build emits only
  existing dependency/externalization warnings.
- `git diff --check`: passed (Git reports only the repository's Windows line
  ending conversion notices).

### Visual artifacts

- `.cache/visual-audit/project-selector-desktop-1440x900-active.png`
- `.cache/visual-audit/project-selector-desktop-1440x900-destination.png`
- `.cache/visual-audit/project-selector-tablet-768x1024.png`
- `.cache/visual-audit/project-selector-mobile-390x844-active.png`
- `.cache/visual-audit/project-selector-mobile-390x844-destination.png`

These show the dirty linked worktree as the active context and the clean
primary checkout as the reviewed destination, with long names, recent projects,
branch/SHA, explicit working-tree state, and the confirmation action.

### Environment limitations

- No real Figma account, file, credentials, or external repository was used.
  Global Variables shown during the visual audit are synthetic normalized
  evidence. A separate implementation task owns the MCP/access/model/persistence
  work and must not present selection-derived variables as global.
- No live Jira, GitHub, Atlassian, Figma connector session, or external write
  was exercised. Their unavailable/permission/degraded states use bounded
  synthetic capability reports and are not presented as live verification.
