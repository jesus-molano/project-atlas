---
name: frontend-task
description: Prepare and execute frontend tasks from repository and conversation context plus any optional Jira, Confluence, Figma, screenshot, or pasted evidence. Use when the user says "prepara esta tarea", asks to implement or review frontend UI, supplies a design or ticket, or needs requirements clarified and existing Vue, Nuxt, React, or Next components evaluated before code changes.
---

# Frontend Task

Turn uneven task evidence into a minimal implementation brief, make an explicit
reuse decision, and scale questions and verification to actual risk. Repository
and conversation are the baseline; every external source is optional.

## Prepare the task

1. Run the cheap source/capability precheck in
   `references/source-precheck.md`. Detect the repository, task text, explicit
   source links/IDs, and callable capabilities before asking anything.
2. Classify repository, Figma, Jira, Confluence, Atlas, and GitHub for this task
   as `required`, `recommended`, `optional`, `unavailable`, or
   `not-applicable`, with one short reason. Atlas is always optional.
3. Show a compact detected/missing/skip summary. When a material source choice
   remains and `request_user_input` is available, use its native selector with
   one question by default (maximum three). Otherwise ask one brief chat
   question. Never create a separate form or ask about every source.
4. Read repository instructions and determine the target package, framework,
   validation commands, and likely ownership boundary.
5. Inventory only sources actually present:
   - conversation, pasted text, local files, screenshots, and repository;
   - Jira or Confluence when a link or connected source is available;
   - Figma when a node, selection, page, file, screenshot, or cached Design
     Index exists.
6. Never require a fixed Jira-to-Confluence-to-Figma chain. Do not block because
   a connector, credential, Dev Mode, Ready for dev, or global Variables access
   is absent.
7. Build the brief defined in `references/brief-contract.md`. Keep unknowns
   explicit; do not fill them with invented product behavior.
8. Classify risk:
   - low: localized visual or copy change with an established pattern;
   - medium: new states, responsive behavior, component API change, or several
     consumers;
   - high: accessibility-critical interaction, destructive or financial flow,
     cross-feature/shared API, conflicting sources, or unclear target.

## Apply the decision and uncertainty gate

Resolve small reversible details using repository conventions and record the
assumption. Surface a warning with evidence and a recommendation for suspected
duplication, inconsistent variants, suspicious props, missing states, or weak
Figma/code alignment.

Ask the user only when an unresolved choice can change behavior, architecture,
data handling, accessibility, ownership, or the design target. Ask one compact
question containing:

- the decision needed;
- evidence from the available sources;
- the recommended default and why;
- the consequence of the main alternative.

Do not run a generic requirements interview. Low risk should normally require no
question; medium and high risk justify more investigation, not more ceremony.
Do not ask for a source that is irrelevant or safely discoverable. A missing
optional plugin never blocks the task; a missing required capability is
reported with the option to connect/provide evidence or stop.

## Find the code path before creating UI

When Project Atlas is available:

1. Call `scan_repository` with the absolute repository root.
2. Reduce the brief to one precise implementation intent.
3. Call `get_task_context` once with a small shared budget. It combines only the
   most relevant Project Memory, Code Atlas, and cached Design Atlas signals.
4. Follow the retrieval ladder only when needed: `orient_project`, then
   `search_project_memory`, then `get_memory_item` for a confirmed ID. Do not
   expand every result.
5. If Project Memory is not available, call `get_reuse_context` once and use
   its compact candidates, scopes, APIs, consumers, tests, and impact.
6. Before editing, call `check_before_change` with the intended files or area.
   Stop only for `decision-required`; report warnings with their evidence and
   recommendation.
7. Use focused Atlas tools only for a concrete ambiguity. Never request `raw`
   unless diagnosing an incorrect index.
8. Before editing a shared API, call `analyze_prop_change_impact`.
9. Choose `reuse`, `extend`, `compose`, `extract-and-reuse`, or `create`.
10. Record the choice with `record_component_decision`; a `create` rationale
   must name the nearest rejected candidates.

If Atlas is unavailable, perform the equivalent repository search manually and
still make the five-way decision. Load `references/capability-routing.md` when
exact MCP/CLI routes or fallbacks are needed.

## Use Figma proportionally

Use either route; neither depends on Ready for dev:

- Direct: a user-confirmed node URL or active selection is authoritative enough
  to inspect it. If it is a large screen, treat it as orientation: inspect
  sparse children, select the smallest task-relevant subtree, then retrieve
  deep context, screenshot, and exact variables only for that subtree. Omit
  shell, navigation, repeated assets, and peripheral siblings before target
  evidence. If the subtree cannot be isolated, ask for a manual selection
  instead of silently accepting truncated context.
- General: map sparse file/page metadata, call `find_design_candidates`, show a
  few candidates with reasons and confidence, and confirm one before deep
  retrieval.

Treat Ready for dev as a useful ranking boost and confidence signal, never as a
filter. Distinguish an observed absence from `source-unavailable`: a connector
that does not expose the field is not evidence that the Figma node lacks the
status. Without observable status, rank semantic names, hierarchy, annotations, linked
resources, components, variants, device context, and Atlas matches. A personal
Figma file without Dev Mode remains a valid source.

Treat related wide frames as viewport variants, not proof of mobile/tablet
coverage. Treat storyboard states as a flow family, not automatic duplicates.
Surface missing breakpoint/state evidence and suspicious design naming without
inventing behavior or silently rewriting copy. Never persist session-local
asset URLs; retain file/node identity and resolve relevant assets on demand.

Use global Variables collection/mode summaries only when read access exists.
Otherwise retrieve `get_variable_defs` for the confirmed node. Code Connect,
global Variables, and library data improve evidence but are optional.

## Implement and verify

1. State the selected target, reuse decision, and any non-blocking assumptions.
2. Implement the smallest cohesive change consistent with the repository.
3. Verify relevant tests, type checking, linting, build, responsive states, and
   accessibility in proportion to risk.
4. Rescan Atlas after component changes and confirm the graph reflects them.
5. Call `record_outcome` with the observed/verified result. If the task teaches
   a durable convention, decision, or constraint, call
   `propose_memory_update` with evidence and confidence. Never call
   `apply_memory_update` without explicit user confirmation.
6. Report outcome, evidence, validation, warnings, and remaining external
   checks. Do not claim that missing corporate data was validated.

Use `references/capability-routing.md` for source-specific routing and
`references/brief-contract.md` for the compact input/output contract.
