# Atlas capsule projection

Use this reference only when visual-direction state must be recorded in the
current Project Atlas task capsule.

## Boundary

Codex owns the task, conversation, permissions, implementation, and review.
Atlas stores bounded evidence and receipts only. It must not create or resume a
model task, choose a visual direction, or translate a read-only plan into write
permission.

Build the projection with `scripts/build-atlas-handoff.mjs`. Include only:

- task ID and authority-decision ID;
- exact source receipt IDs and opaque Atlas handles;
- selected DesignContract ID and content hash;
- state-matrix and VisualReview summary counts;
- cleanup state and next safe action.

Exclude prompt text, source bodies, preview payloads, temporary paths, expanded
receipts, discarded alternatives, code, diffs, and model transcripts. Expand a
single receipt by ID only when the active Codex task needs it.

The visual GUI may inspect these receipts and review a memory proposal. It
cannot execute Codex or alter the recorded authority decision.
