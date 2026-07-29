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

Use the operating-system temp root by default:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs init --task "<task-local-id>"
```

The command returns a random owned session path, a hashed task fingerprint, and
an expiry. It never persists the raw task text. Write every moodboard, mockup,
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
removes every other exploration artifact including contact sheets. Keep only
the returned opaque `visual:` contract handle, hash, and expiry in task
context. The compact selected contract remains behind that handle in the temp
session until review closes; expand it after context compaction without
rehydrating previews:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs expand `
  --contract-handle "<visual:session:hash>"
```

Register implementation review captures in the same selected session. Then
close or cancel explicitly:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs close --session "<session-path>"
node skills/visual-direction/scripts/temporary-artifacts.mjs cancel --session "<session-path>"
```

Run a bounded crash-recovery sweep when starting or closing visual-direction
work:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs sweep
```

The sweep reads only owned manifests/cleanup receipts and ignores unknown temp
directories.

Retry a failed selection purge with its session path. Retry a failed
close/cancel purge with the session ID printed in the cleanup receipt:

```powershell
node skills/visual-direction/scripts/temporary-artifacts.mjs retry --session "<session-path>"
node skills/visual-direction/scripts/temporary-artifacts.mjs retry --session-id "<vd-session-id>"
```

## Safety and recovery

- The script rejects a temp root inside a Git worktree.
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
