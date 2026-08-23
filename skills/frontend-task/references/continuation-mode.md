# Continuation and correction mode

Use this mode only when the user unequivocally resumes, corrects, or finishes
the same objective. Atlas may recover the durable evidence state only from the
exact repository checkout. It never infers identity from similar text, branch
names, or nearby work.

A dirty worktree, related prior implementation, or request to behave "like" an
earlier flow is reuse evidence, not continuation identity. Default to a new task
when identity is uncertain.

## Resume safely

1. Inspect `git status --short`, current branch/HEAD, the focused delta, and
   relevant tests before external retrieval. Treat every existing change as
   user-owned.
2. Call `atlas_task_state` with action `resume`. Omit `task_id` only for exact
   checkout recovery. Continue automatically only when Atlas returns one
   unambiguous task. If it returns multiple candidates, select one exact ID;
   if it returns none or inconsistent evidence, start a new task.
3. Verify repository root, checkout/HEAD, objective, persisted source ledger,
   latest `contract:` and `continuation:` handles, lock, receipts, criterion
   statuses, evidence references, and next safe action. Expand the latest
   continuation before editing. If identity or baseline differs, start a new
   task and use the prior result only as evidence.
4. Build a delta brief from the persisted contract and continuation: behavior
   already complete, behavior remaining or corrected, affected files/evidence,
   changed acceptance criteria, and checks still required. Do not reconstruct
   criterion status from compressed conversation text.
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
10. After each semantic batch or before handoff/context compaction, write one
    `checkpoint-continuation` with every criterion, task-owned evidence,
    current governing visual/snapshot handles, covered/remaining scope, and one
    next action. Never checkpoint per tool call.
11. Validate the delta plus the nearest regression surface, run the required
    independent review, call `atlas_validate_change`, and complete technically
    with `atlas_task_state` action `complete` only when every required criterion
    is satisfied.

Use `atlas_memory` only for a new literal memory decision. A prior memory
consent does not automatically authorize memory for the correction.

If no reliable exact-checkout identity can be recovered, leave continuation
mode. Start a new source preflight, preserve the dirty tree, and treat prior
code/outcomes as bounded reuse and regression evidence.
