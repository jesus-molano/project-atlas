# `frontend-task` integration

`frontend-task` is explicit-only. Its manifest sets
`allow_implicit_invocation: false`, and the installer writes no global frontend
routing rule. Invoke it with `$frontend-task`; use `/plan $frontend-task` when a
reviewed plan gate is desired.

`reuse-first` is also explicit-only. `frontend-task` applies the same component
decision contract internally and reuses one Atlas task ID; it never loads a
second prepare/scan cycle.

## Six-tool contract

1. Run source preflight. Bare links remain `pending`; no connector or repository
   scan runs until material source decisions are resolved.
2. Call `atlas_prepare_task` once per evidence version.
3. Expand only a named unresolved handle with `atlas_expand_context`.
4. Choose `reuse`, `extend`, `compose`, `extract-and-reuse`, `create`, or
   `not-applicable`, then persist that decision in `atlas_lock_change_scope`
   before editing.
5. Implement in the same native Codex task and call `atlas_validate_change`
   after deterministic checks.
6. Use `atlas_task_state` for resume/block/checkpoint and action `complete` for
   technical close without memory.
7. Use `atlas_memory` `review-proposal` only for an exact proposal ID; require
   literal user consent for every mutating memory action.

The skill routes optional detail by domain: source preflight, brief,
capabilities, continuation, and memory closeout references are loaded only when
their named condition is active.

## Size-aware behavior

- Small: compact decision/scope, focused checks, no independent reviewer.
- Medium: explicit brief/lock, relevant lint/typecheck/build, one correctness
  review when shared/API/stateful risk warrants it.
- Large or high-risk: reviewed plan, full applicable gates, and narrow domain
  reviews only where evidence/risk justifies them.

If Atlas is unavailable, Codex follows the same repository-first reasoning
manually. Missing optional connectors never block unrelated work. Run
`frontend-codex-kit/doctor.ps1` from the Atlas checkout when the six core tools
are unexpectedly absent.

## Contract tests

Installation and workflow tests should prove:

- generic frontend prompts load neither explicit-only skill;
- source references remain pending until confirmed;
- the reuse decision is persisted before the lock permits editing;
- validation compares the complete task delta with the persisted lock;
- technical completion writes no memory;
- every mutating `atlas_memory` action requires literal matching consent, while
  `review-proposal` cannot mutate or imply a later decision;
- no default skill/reference names a legacy Atlas tool.
