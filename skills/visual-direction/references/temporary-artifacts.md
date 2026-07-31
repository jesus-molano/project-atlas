# Temporary artifact lifecycle

All exploration and visual review artifacts are task-scoped and ephemeral.
The repository is never an artifact store.

## Lifecycle

```text
init -> open -> record options -> selected -> review -> close
                   |                 |          |
                   +---- cancel -----+----------+
cleanup failure -> cleanup-pending -> retry or TTL sweep -> clean
```

Use the centralized Project Atlas temp root by default
(`%LOCALAPPDATA%\ProjectAtlas\temp\visual-direction` on Windows):

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs init --task "<atlas-task-id>"
```

`--task` must be the stable `task_id` returned by `atlas_prepare_task`, not an
objective, label, or newly invented ID. The command returns a random owned
session path, a hashed task fingerprint, and an expiry. It never persists the
raw task ID. Write every moodboard, mockup,
contact sheet, sandbox, selected consolidation, contract file, and review
capture below that exact session path.

Register each artifact:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs record `
  --session "<session-path>" `
  --artifact "<path-inside-session>" `
  --kind "mockup"
```

Select after the user decides:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs select `
  --session "<session-path>" `
  --direction-file "<compact-contract-json-inside-session>" `
  --artifact-handle "<optional-chosen-artifact-handle>"
```

Selection hashes the contract, retains at most the chosen artifact, and
removes every other exploration artifact including contact sheets. It returns
an opaque `visual:` contract handle, the full contract hash, expiry, and a
`selection-receipt:v1:...`. Atlas recomputes that receipt from the live owned
session before accepting `attach-evidence`; a syntactically plausible receipt
is insufficient. Carry all four values together.

The complete selected DesignContract remains only in the temporary session.
While that session is alive, rehydrate it after context compaction with:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs expand `
  --contract-handle "<visual:session:hash>"
```

`atlas_expand_context` on the same `visual:` handle returns the durable compact
`VisualEvidenceContract` (authority, summary, hash and provenance), not this
complete DesignContract. After cleanup, the temporary `expand` route is gone;
only the compact Atlas projection and immutable review receipts remain.

After selection, register implementation review captures in the same session
with `--kind "review-capture"`. The command returns handle, full content hash,
and a `capture-receipt:v1:...`; Atlas verifies the receipt and the actual bytes
while attaching the preliminary review. Any other kind (including `mockup`) is
rejected once the session is selected:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs record `
  --session "<session-path>" `
  --artifact "<capture-inside-session>" `
  --kind "review-capture"
```

Attach those exact triples as a preliminary `selected-retained` review before
deleting anything. Only then close or cancel explicitly:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs close --session "<session-path>"
node skills/visual-direction/scripts/temporary-artifacts.mjs cancel --session "<session-path>"
```

A successful close returns a content-free `cleanup:v1:...` receipt. Attach a
second, final `clean` review that references the preliminary review handle and
repeats the exact capture identities. Atlas accepts it only when the temporary
session and pending-cleanup record are both absent. Direct final review is
invalid. The cleanup receipt binds task fingerprint, owned session, reason and
timestamp without retaining paths or contents. Only a normal `close` receipt
can support successful delivery; `cancel` can close blocked/partial work. These
deterministic receipts are audit evidence, never authentication or user consent.

Run a bounded crash-recovery sweep when starting or closing visual-direction
work:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs sweep
```

The sweep reads only owned manifests/cleanup receipts and ignores unknown temp
directories. A malformed session manifest is never deleted: `sweep` returns a
`MANIFEST_JSON_INVALID` / `manual-review-required` diagnostic with the preserved
session ID and an explicit recovery action.

Retry a failed selection purge with its session path. Retry a failed
close/cancel purge with the session ID printed in the cleanup receipt:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs retry --session "<session-path>"
node skills/visual-direction/scripts/temporary-artifacts.mjs retry --session-id "<vd-session-id>"
```

## Safety and recovery

- The script rejects a temp root inside a Git worktree.
- Manifests, contracts, and cleanup receipts use an exclusive same-directory
  temp file, flush and close it, then atomically rename it into place. A bounded
  Windows rename retry handles transient file locks; an interrupted write keeps
  the previous JSON document and removes its unpublished temp file.
- A session must be a real, non-symlinked direct child of the owned temp root
  and contain the expected manifest before deletion.
- Artifact paths must remain inside their session and cannot be symlinks.
- Close/cancel writes a temp-root cleanup receipt before recursive deletion.
  Success removes the receipt. Failure leaves only a recoverable
  `cleanup-pending` receipt with a bounded error code and retry path.
- Retry with `close` or let `sweep` process an expired receipt. Do not hide the
  failure and do not claim residue-free completion until the retry succeeds.
- Normal task close always cleans immediately; TTL is a fallback for crashes,
  abandoned tasks, or process interruption.
- Promotion beyond task close requires explicit user approval and a named
  destination outside this lifecycle. Never promote discarded variants.

## Repository residue check

Before reporting completion:

1. inspect `git status --short`;
2. search the intended diff for generated preview/sandbox paths and binary
   artifacts;
3. confirm the artifact session and cleanup receipt are absent after close;
4. report `cleanup-pending` as a blocking closeout state until recovered.
