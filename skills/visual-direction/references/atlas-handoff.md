# Project Atlas handoff contract

Use this boundary only after `$visual-direction` has resolved authority. It is
an adapter for the new Workbench's Codex-first handoff, progressive inspector,
task capsule, and receipts. It is not a second workflow engine, receipt store,
Workbench, or dashboard.

Run `scripts/build-atlas-handoff.mjs` with the compact result already produced
by the skill. The adapter validates and projects that result; it must never
infer a different authority mode or design direction.

## What the Workbench may show

Keep the primary action in the existing **Work / Codex handoff** surface:

- one-line visual-direction status, authority mode, and invention budget;
- exact Figma identity in fidelity mode, without candidate substitution;
- two or three compact direction cards only while selection is pending;
- after selection, the opaque `visual:` contract handle, hash, expiry, and a
  compact state-matrix summary;
- review result and counts after the single implementation;
- cleanup state, with `cleanup-pending` treated as a blocker;
- expandable inspector sections for authority, state coverage, visual review,
  provenance IDs, and cleanup.

The embedded runner remains secondary and experimental. The Workbench may copy
or hand the bounded result to Codex, but it must not reclassify authority,
select an option, combine traits, regenerate cards, or claim that an Atlas
candidate is the source design.

## What crosses the boundary

The adapter returns:

```yaml
surface:
  primary: codex-handoff
  runner: secondary-experimental
  inspector: progressive-disclosure
status: inactive | needs-selection | locked | review | cleanup-pending | clean
authority:
  mode: fidelity | inherit | explore | redesign
  inventionBudget: 0 | 1 | 2 | 3
  visual: exact-figma | existing-system | selected-direction | direction-selection-required
  exactFigmaIdentity: optional exact fileKey, nodeId, and original URL
directionCards: present only while selection is pending
selectedContract: optional opaque visual handle, hash, and expiry
stateMatrix: compact surface, viewport, and required-state names
visualReview: compact result and counts
provenance:
  sourceReceiptIds: immutable IDs only
  atlasHandles: expandable IDs only
  receiptsExpanded: false
cleanup:
  state: lifecycle state
  blocksCompletion: boolean
  retrySessionId: present only for recoverable cleanup failure
nextSafeAction: one bounded action
capsuleProjection:
  sourceReceiptIds: immutable IDs only
  handles: selected visual handle plus bounded Atlas handles
  nextSafeAction: one bounded action
```

The output is capped at 3 KB. The task capsule should consume only
`capsuleProjection`, not the full inspector view model. The existing Atlas
capsule remains authoritative for its own 4 KB limit, lifecycle, journal, and
storage.

## What never crosses the boundary

Do not send or store:

- preview image bytes, base64, data URLs, or HTML;
- filesystem or temporary session paths;
- sandbox source, fixtures, contact sheets, or discarded direction cards;
- expanded SourceReceipt bodies or retrieval result bodies;
- raw DesignContract payloads in the capsule;
- a copy of runtime, receipt, journal, or Workbench state.

Expand `SourceReceipt` IDs through the existing receipt inspector. Expand a
`visual:` handle through `temporary-artifacts.mjs expand` only while its
temporary session is selected and unexpired. Closing or cancelling the task
purges that session; the handle then becomes intentionally stale.

## Rendering states

- `inactive`: render nothing unless the inspector explicitly asks for status.
- `needs-selection`: show bounded cards and hand selection back to Codex/user.
- `locked`: show the selected receipt and enable one production implementation.
- `review`: show the single implementation's review summary.
- `cleanup-pending`: surface retry action and block ready/complete claims.
- `clean`: collapse to the final receipt/provenance summary.

Do not add a persistent visual-direction navigation item or dashboard. If a
future GUI control is needed, make it an inline disclosure in the existing
Workbench inspector and keep the exact same structured result as Codex.
