---
name: reuse-first
description: Explicit component-reuse decision workflow for frontend UI using the six Project Atlas core tools. Invoke only when the user writes `$reuse-first`, or when another explicitly invoked skill directs Codex to apply this module without starting a duplicate Atlas task.
---

# Reuse First

Decide whether to reuse, extend, compose, extract, or create before changing UI.
Use the current repository as authority and Project Atlas as bounded evidence.

## Run one decision gate

1. State the implementation intent in one sentence: responsibility, data,
   states, interactions, accessibility, and responsive behavior.
2. Inspect repository instructions, the current implementation, tests, and the
   dirty-worktree baseline. Treat existing changes as user-owned.
3. If this module owns intake, keep every bare external reference `pending`
   until exact identity, provider, authority, and task scope are unambiguous.
   Do not prepare or retrieve while a material source remains pending. If
   external requirement/API authority or visual/Figma authority is material and
   no parent task exists, stop before preparation and ask to continue through
   `$frontend-task`; this repository-only module must not create a partial task
   that later cannot attach the governing receipt or visual contract.
4. If this module owns the task, call `atlas_prepare_task` with the absolute
   root and resolved task-scoped sources. Keep its `task_id`. If a parent
   `$frontend-task` already prepared the same objective, reuse that task ID and
   returned handles; never prepare or scan twice.
5. Inspect the ranked candidates, scope, API summary, consumers, tests,
   similarity evidence, and impact returned by preparation. Call
   `atlas_expand_context` for one named handle only when a concrete ambiguity
   remains.
6. Choose exactly one decision before locking scope:
   - `reuse`: use an existing public API unchanged;
   - `extend`: add one cohesive backward-compatible capability;
   - `compose`: combine existing primitives without changing their APIs;
   - `extract-and-reuse`: promote a useful internal pattern behind a shared API;
   - `create`: no candidate owns the same responsibility or can evolve cleanly;
   - `not-applicable`: the task changes no reusable UI responsibility.
7. Report the selected component, nearest rejected alternative, evidence, and
   rationale. A `create` rationale must name the nearest candidates and explain
   why extension or composition would damage ownership or API cohesion.
8. Call `atlas_lock_change_scope` with the decision and rationale, exactly one
   existing component or planned non-component surface, at most two
   reference-only components, exact repository-relative allowed files, and
   explicit exclusions. Atlas derives APIs/impact from graph and receipts. Do
   not edit before the returned lock is clear or its decision-required findings
   are resolved.
9. Implement only the locked surface. Before changing a shared API, use the
   lock's consumer and impact evidence; expand a single component handle only
   if the compact result is insufficient.
10. Run repository validation, then call `atlas_validate_change`. Resolve scope
   escapes and real regressions; report advisory warnings with evidence.
11. Close the technical task with `atlas_task_state` action `complete` only
    after verification. Its technical outcome record is not evidence of
    commit/push/PR/deployment. Do not write Project Memory unless the user
    separately opts in through `atlas_memory`.

## Scope rules

- Prefer a shared component, then a same-feature component.
- Never import an internal component directly across feature boundaries.
- Do not add a boolean prop merely to hide a responsibility mismatch.
- Treat similarity as evidence, not proof.
- Preserve repository-specific commands, accessibility rules, and tokens.
- Reopen broad discovery only after naming a graph, source-ledger, objective, or
  scope invalidation.

## Tool availability

Read [references/tool-map.md](references/tool-map.md) when a core operation is
missing or a task must resume. If Project Atlas is unavailable, search the
repository manually, make the same explicit decision, and continue without
inventing an Atlas result. Do not fall back to legacy Atlas tools or an
unconfigured CLI.

## Parent integration

`frontend-task` owns intake, source authority, size/risk, implementation,
review, technical close, and optional memory. When it applies this gate, reuse
its task ID and core calls; do not invoke a second copy of this workflow.

Report the intent, decision, selected component, rejected alternative, locked
surface, and validation concisely.
