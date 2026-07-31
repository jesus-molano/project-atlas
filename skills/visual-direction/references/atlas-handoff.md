# Atlas core handoff

Use this reference only when selected visual evidence must re-enter the current
native `$frontend-task` flow.

## Boundary

Native Codex owns the task, source decisions, permissions, implementation,
review, and technical close. Atlas stores bounded receipts and handles; it does
not run a model, choose a direction, or grant write permission.

Build one projection with `scripts/build-atlas-handoff.mjs`. Include only:

- the absolute repository `rootPath` and the existing Atlas `taskId`; the
  generated `root_path` and `task_id` are exact copies, never placeholders;

- authority mode and exact Figma identity when applicable;
- immutable source receipt IDs already authorized by the parent source ledger;
- bounded Atlas handles;
- selected visual contract handle, content hash, and expiry;
- state-matrix plus registered capture handles, full SHA256 hashes, viewport and
  state (never paths or image bodies);
- cleanup state and next safe action.

The complete projection has an 8 KB hard ceiling so the largest supported
state matrix can carry its hash-bound captures. Ordinary selection handoffs
should remain below 3 KB.

Exclude prompts, source bodies, preview payloads, temporary paths, expanded
receipts, discarded alternatives, code, diffs, and model transcripts.

## Six-tool projection

The script returns `coreProjection`, not a second execution surface or task
capsule:

- `taskState` is an exact `atlas_task_state` payload. Selection produces
  `attach-evidence`, binding authorized receipt IDs plus the visual handle,
  hash, authority, exact Figma identity, summary, and expiry. Post-implementation
  review produces `attach-review`, creating an immutable, task- and
  contract-bound `visual-review:` receipt. Captures must use
  `artifact-<hash12>-<uuid8>` handles whose prefix matches the supplied full
  SHA256; every declared viewport and required state must be covered without a
  duplicate viewport/state pair;
- `resumeHandles` carries only bounded opaque handles for later
  `atlas_expand_context` calls;
- `checkpoint` is an exact `atlas_task_state` `checkpoint` payload. Use it only
  when `attach-evidence` or another preceding core operation did not already
  persist the same semantic boundary.

Do not call a legacy Atlas tool. Do not call `atlas_task_state complete` from
visual-direction; the parent task completes only after code validation, review,
artifact cleanup, and delivery checks.

After `attach-evidence` persists the selected contract, `atlas_expand_context`
on its `visual:` handle rehydrates only the compact durable
`VisualEvidenceContract` (authority, summary, hash and provenance). Rehydrate
the complete DesignContract with `temporary-artifacts.mjs expand` while the
selected session is alive. After cleanup that temporary body no longer exists,
so the compact summary must contain the implementation-critical decision and
the parent task must checkpoint before cleanup.

After implementation, send a preliminary
`attach-review` while captures still exist (`selected-retained`), then close the
temporary session. Cleanup returns a content-free receipt bound to the task,
session, close reason and timestamp; it is audit evidence, not authentication or
consent. Send the final `attach-review` with the same capture identities,
cleanup `clean`, and that receipt, then expand the returned `visual-review:`
handle. `cleanup-pending` and retained selections block technical completion.
Temporary payloads and paths never cross this boundary.

For exact Figma fidelity, preserve the exact file key and node ID in the source
ledger, initialize the temporary session with the same Atlas `task_id`, and
select the compact DesignContract without retaining a preview artifact. Build
the handoff with that Figma receipt and attach it to the existing task. A file-
or page-level reference cannot authorize exact fidelity without a resolved
node ID.

When `$visual-direction` is invoked standalone and no parent `root_path` plus
stable Atlas `task_id` exists, do not invent either value and do not emit a core
handoff. Keep the result local/temporary and ask the parent workflow to prepare
the task before Atlas persistence.

Legacy capsule reviews without a `visual-review:` receipt remain readable for
resume/migration, but they cannot authorize completion. Re-register the real
captures and attach a current receipt under the locked contract.

The GUI may inspect receipts and memory proposals. It cannot execute Codex,
alter authority, select a direction, or write memory.
