# Continuation and correction mode

Use this mode for “continue”, “correct”, “finish what is pending”, a dirty
worktree, or a clearly related prior outcome.

1. Inspect `git status --short`, the focused diff, current branch, and relevant
   tests before retrieving external detail. Treat every existing change as
   user-owned unless the current task proves otherwise.
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
5. Re-run a human gate only when the delta changes observable behavior, exposes
   a new contradiction, changes a shared API, or leaves a material decision
   unresolved. A previously confirmed decision remains valid when its evidence
   and behavior are unchanged.
6. Patch around existing changes. Never reset, overwrite, reformat broadly, or
   claim ownership of unrelated edits.
7. Verify the delta plus the nearest regression surface, then record one new
   outcome linked conceptually to the continuation. Propose durable memory only
   when the corrected result establishes reusable knowledge.

If no reliable prior objective can be recovered, present the observed diff and
ask one evidence-backed question about the intended outcome. Do not infer that a
dirty tree is disposable.
