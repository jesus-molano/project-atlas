# Action Center

The Action Center is an evidence-backed human review queue. It projects current
memory contradictions, design/source problems, validation risks and warnings.
Projection is read-only; resolutions are local SQLite audit records.

Each item states the detection, consequence, bounded evidence handles,
fingerprint, severity and allowed human commands. Commands are constrained by
item type: resolve/clarify/defer a decision, choose authority for a
contradiction, mitigate/accept a risk, review/defer/ignore a warning, or open an
available evidence alternative.

Bulk actions are limited to reversible triage. Server-side validation applies
the batch transactionally and requires a local GUI session token.

## Freshness and provenance

Evidence fingerprints cover canonical handles, summaries, observation times
and sources. A resolution becomes stale when that fingerprint changes. Records
remain bound to logical project, checkout, workspace fingerprint, evidence
fingerprint and idempotency key.

## Codex boundary

The Action Center does not send findings, task text, source contents or
transcripts to Codex and has no continue/retry/ask-Codex command. A human can
open the evidence and independently continue the existing native Codex task.
Canonical memory still requires proposal review and explicit approval.
