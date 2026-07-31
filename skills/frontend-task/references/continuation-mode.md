# Continuation and correction mode

Use this mode only when the user unequivocally resumes, corrects, or finishes
the same objective and its task ID can be recovered from the current native
task, an explicitly identified brief, or a directly tied technical outcome.

A dirty worktree, related prior implementation, or request to behave "like" an
earlier flow is reuse evidence, not continuation identity. Default to a new task
when identity is uncertain.

## Resume safely

1. Inspect `git status --short`, current branch/HEAD, the focused delta, and
   relevant tests before external retrieval. Treat every existing change as
   user-owned.
2. Call `atlas_task_state` with action `resume` and the stable task ID.
3. Verify repository root, checkout/HEAD, objective, persisted source ledger,
   lock, receipts, and next safe action. If identity or baseline differs, start
   a new task and use the prior result only as evidence.
4. Build a delta brief: behavior already complete, behavior remaining or
   corrected, affected files/evidence, changed acceptance criteria, and checks
   still required.
5. Preserve confirmed source decisions whose exact identity and authority are
   unchanged. Return only replaced/new references to `pending`.
6. Call `atlas_prepare_task` again under the same task ID only after naming a
   graph, objective, source-ledger, or visual-contract invalidation. Otherwise
   reuse its handles. Expand only an affected handle with
   `atlas_expand_context`.
7. Re-evaluate size/risk monotonically. A correction can raise the tier; it
   cannot lower the stored tier for the same task.
8. If the component decision or implementation boundary changed, decide again
   and call `atlas_lock_change_scope` with the new decision/rationale before
   editing. Preserve explicit exclusions.
9. Patch around existing changes. Never reset, overwrite, or broadly reformat
   unrelated work.
10. Validate the delta plus the nearest regression surface, call
    `atlas_validate_change`, and complete technically with `atlas_task_state`
    action `complete` only when nothing remains.

Use `atlas_memory` only for a new literal memory decision. A prior memory
consent does not automatically authorize memory for the correction.

If no reliable prior objective/task ID can be recovered, leave continuation
mode. Start a new source preflight, preserve the dirty tree, and treat prior
code/outcomes as bounded reuse and regression evidence.
