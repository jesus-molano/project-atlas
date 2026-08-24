# Continuation and correction mode

Use this mode only when the user unequivocally resumes, corrects, or finishes
the same objective. Atlas recovers durable evidence from the focused task for
the exact checkout and branch. It never infers identity from similar text or
nearby work.

A dirty worktree, related prior implementation, or request to behave "like" an
earlier flow is reuse evidence, not continuation identity. Default to a new task
when identity is uncertain.

## Resume safely

1. Inspect `git status --short`, current branch/HEAD, the focused delta, and
   relevant tests before external retrieval. Treat every existing change as
   user-owned.
2. Call `atlas_task_state` with action `resume`. Normally omit `task_id`: Atlas
   uses the checkout-and-branch focus, or one uniquely safe candidate. If it
   reports real ambiguity, select one exact ID once; that selection becomes the
   focus. If it returns none, prepare a new task. Use `start_new_task: true`
   only for a separate objective.
3. Verify repository root, checkout/branch, stored and current HEAD, objective,
   title, lineage, feedback queue, persisted source ledger,
   latest `contract:` and `continuation:` handles, lock, receipts, criterion
   statuses, evidence references, validation freshness, and next safe action.
   Expand the latest continuation before editing. An advanced descendant HEAD
   on the same checkout and branch is a reconciliation case, not a new task.
   Diverged history or a different checkout/branch requires explicit selection
   or a new task.
4. Build a delta brief from the persisted contract and continuation: behavior
   already complete, behavior remaining or corrected, affected files/evidence,
   changed acceptance criteria, and checks still required. Do not reconstruct
   criterion status from compressed conversation text.
5. Preserve confirmed source decisions whose exact identity and authority are
   unchanged. Return only replaced/new references to `pending`.
6. Record a new user observation with `atlas_task_state` action
   `append-feedback`. Notes do not block. Corrections, decisions,
   scope changes, and review findings remain required until resolved. Use
   action `reconcile` to resolve feedback and update sparse criterion progress;
   unchanged criteria retain their evidence. Expand only an affected handle
   with `atlas_expand_context`; its embedded task identity is sufficient unless
   it conflicts with an explicitly supplied `task_id`.
7. Call `atlas_prepare_task` again under the same task ID only after naming a
   graph, objective, source-ledger, or visual-contract invalidation. Otherwise
   reuse its handles.
8. Re-evaluate size/risk monotonically. A correction can raise the tier; it
   cannot lower the stored tier for the same task.
9. If the component decision or implementation boundary changed, decide again
   and call `atlas_lock_change_scope` with the new decision/rationale before
   editing. Preserve explicit exclusions.
10. Patch around existing changes. Never reset, overwrite, or broadly reformat
   unrelated work.
11. After each semantic batch or before handoff/context compaction, reconcile
    the changed criteria and feedback, then write one
    `checkpoint-continuation` with every criterion, task-owned evidence,
    current governing visual/snapshot handles, covered/remaining scope, and one
    next action. Never checkpoint per tool call.
12. Validate the delta plus the nearest regression surface, run the required
    independent review, call `atlas_validate_change`, and complete technically
    with `atlas_task_state` action `complete` only when every required criterion
    is satisfied and no required feedback remains.

A correction received after technical completion creates a child task linked
to the immutable parent. Resume and implement the child; never reopen or edit
the parent's final receipt.

Use `atlas_memory` only for a new literal memory decision. A prior memory
consent does not automatically authorize memory for the correction.

If no reliable exact-checkout identity can be recovered, leave continuation
mode. Start a new source preflight, preserve the dirty tree, and treat prior
code/outcomes as bounded reuse and regression evidence.
