# `frontend-task` integration

`frontend-task` supports selective implicit activation. Its manifest sets
`allow_implicit_invocation: true`, while its description and entrypoint limit
automatic use to frontend implementation with strong signals: multiple
material authorities, shared/public UI or API boundaries, cross-route/package
state, a broad migration, or an existing Atlas task. Small local edits and
research, diagnosis, or review-only work remain normal Codex tasks. Explicit
`$frontend-task` remains available at any size; `/plan $frontend-task` requests
a reviewed plan gate.

The installer writes no global frontend routing rule. When selection is
implicit, the skill names the decisive signal but does not ask permission
merely to use Atlas. It asks only for unresolved material sources, authority
conflicts, or other consequential decisions.

`reuse-first` is also explicit-only. `frontend-task` applies the same component
decision contract internally and reuses one Atlas task ID; it never loads a
second prepare/scan cycle.

Atlas remains a local evidence sidecar. `frontend-task` and Codex implement the
task; Orca manages workspaces and multi-agent orchestration. Do not treat Atlas
handles, continuations, or its GUI as a task queue or ticket system.

## Six-tool contract

1. Run source preflight. Bare links remain `pending`; no connector or repository
   scan runs until material source decisions are resolved.
2. Call `atlas_prepare_task` once per evidence version. For medium/large work,
   record the immutable evidence contract before locking scope.
3. Expand only a named unresolved handle with `atlas_expand_context`.
4. For authoritative Figma, retain one bounded, exact-identity semantic snapshot
   before locking. New Figma evidence after a lock requires a named relock window
   and a linked successor when identity or required coverage changed.
5. Choose `reuse`, `extend`, `compose`, `extract-and-reuse`, `create`, or
   `not-applicable`, then persist that decision in `atlas_lock_change_scope`
   before editing.
6. Checkpoint the initial immutable continuation against the lock before the
   first edit, then checkpoint semantic milestones. Resume by exact checkout
   without a task ID only when one active candidate exists.
7. Implement in the same native Codex task and call `atlas_validate_change`
   after deterministic checks.
8. Use `atlas_task_state` for resume/block/checkpoint and action `complete` for
   technical close without memory.
9. Use `atlas_memory` `review-proposal` only for an exact proposal ID; require
   literal user consent for every mutating memory action.

The skill routes optional detail by domain: source preflight, brief,
capabilities, continuation, and memory closeout references are loaded only when
their named condition is active.

## Size-aware behavior

- Small: compact decision/scope and focused checks; an independent reviewer is
  reserved for a public, security, accessibility, data, or deployment boundary.
- Medium: explicit brief/contract/lock, relevant checks, and one independent
  read-only correctness review.
- Large or high-risk: reviewed plan, full applicable gates, at least one
  independent review, and narrow specialists only where evidence/risk justifies
  them.

Before a successful technical close, the contract acceptance criteria, required
decisions, current validation evidence and applicable review must be complete.
`partial`/`failure` remain valid honest outcomes. `to-tickets` can turn an
approved spec into an optional human delivery backlog; it is not a workflow
orchestrator.

If Atlas is unavailable, Codex follows the same repository-first reasoning
manually. Missing optional connectors never block unrelated work. Run
`frontend-codex-kit/doctor.ps1` from the Atlas checkout when the six core tools
are unexpectedly absent.

## Contract tests

Installation and workflow tests should prove:

- `frontend-task` permits implicit activation while `reuse-first` and
  `visual-direction` remain explicit-only;
- small local frontend edits stay outside Atlas, while complex implementation
  with strong signals is eligible for automatic selection;
- source references remain pending until confirmed;
- the reuse decision is persisted before the lock permits editing;
- validation compares the complete task delta with the persisted lock;
- technical completion writes no memory;
- every mutating `atlas_memory` action requires literal matching consent, while
  `review-proposal` cannot mutate or imply a later decision;
- no default skill/reference names a legacy Atlas tool.
