# Continuation and correction mode

Use this mode only when the user unequivocally resumes, corrects, or finishes
the same task and the previous objective can be recovered from the current
thread, an explicitly identified task/brief, or a directly tied outcome.

Default to a new task when same-task identity is not explicit. A dirty
worktree, related prior outcome, or request to behave “like”, “as in”, or
“following” an earlier flow, component, screen, or implementation is not
continuation evidence by itself. Treat those references as candidates for
reuse, parity, constraints, and regression coverage. For example, “enable
biometrics in Problem Tags like Back Office” is a new Problem Tags task unless
the user explicitly says they are resuming the same prior task.

1. After establishing same-task identity, inspect `git status --short`, the
   focused diff, current branch, and relevant tests before retrieving external
   detail. Treat every existing change as user-owned unless the current task
   proves otherwise.
   Load `resume_task_capsule` first. If its checkout/HEAD and
   execution-manifest digests still match, reuse its confirmed decisions,
   active policy, receipt IDs, and retrieval handles without rereading skill,
   reference, or script bodies.
2. Recover the previous objective from the current conversation, a supplied
   brief, and the nearest relevant Atlas outcome or decision. Do not search all
   history or paste a previous response.
3. Build a delta brief:
   - what is already implemented and must be preserved;
   - what failed, changed, or remains;
   - files and evidence affected by that delta;
   - validation still required.
4. Query only affected code, memory handles, design nodes, or source fragments.
   Run the incremental repository scan; do not repeat the full onboarding or
   source inventory when capability state and target are unchanged.
   Reuse the task-scoped source ledger and confirmed references when resuming
   the same thread. A correction that adds or replaces a reference returns only
   that source to `pending`; it does not invalidate unchanged confirmations.
   A completed retrieval key remains valid. A second `get_reuse_context` call
   must return its prior handle unless a named graph, scope, source-ledger, or
   user-requested invalidation is recorded.
5. Re-run a human gate only when the delta changes observable behavior, exposes
   a new contradiction, changes a shared API, or leaves a material decision
   unresolved. A previously confirmed decision remains valid when its evidence
   and behavior are unchanged.
6. Patch around existing changes. Never reset, overwrite, reformat broadly, or
   claim ownership of unrelated edits.
7. Verify the delta plus the nearest regression surface, then record one new
   outcome linked conceptually to the continuation. Propose durable memory only
   when the corrected result establishes reusable knowledge.
   Never reconstruct a thread from content-free project audit metadata. If the
   task/thread state expired, start a new read-only intake and cite the prior
   outcome only as evidence.

If no reliable prior objective can be recovered, leave continuation mode. Start
a new-task intake, treat related code or outcomes as reuse evidence, preserve
the dirty tree, and ask only the checkpoint required by the new task's risk.
