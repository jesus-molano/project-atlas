# Action Center

The Action Center turns **Decisions & Risks** into an evidence-backed queue for
human action. It projects current findings from Project Memory, the Design
Index, connector capabilities, and paused Codex runs. Projection is read-only;
resolutions are local audit records in SQLite.

Each item states:

- what Atlas detected and why it matters;
- the affected task or run and the consequence of doing nothing;
- the bounded evidence handles and their fingerprint;
- the recommended action, allowed commands, and resolution scope.

## Human actions

Commands are constrained by item type:

- decisions can be resolved, clarified, postponed, or used to continue their
  exact originating run;
- contradictions compare both sources and require choosing a listed authority;
- risks can be mitigated in the current task, turned into a follow-up task, or
  accepted with an explicit reason;
- warnings can become a task check, be reviewed, postponed, or ignored with an
  explicit reason and confirmation;
- missing evidence can open Connections, use a bounded alternative handle, or
  continue in an explicitly degraded state.

**Resolve next** orders open items by blocking status, severity, detection time,
and stable identity. Multi-select is limited to reversible triage commands:
review, postpone, and ignore. The server validates every mutation before saving
the batch in one SQLite transaction.

## Freshness and provenance

An evidence fingerprint covers canonical handles, summaries, observation times,
and sources. A stored resolution is invalidated and returned to `stale` when
that fingerprint changes. Run-scoped resolutions additionally require the same
originating run.

Every mutation is bound to project, checkout, workspace fingerprint, evidence
fingerprint, and a bounded idempotency key. Mutating routes require the local
GUI session token. Reasons and handles pass the existing secret-like-content
guard before persistence.

## Codex boundary

The Action Center never sends full findings, task text, transcripts, or source
contents to Codex. Agent-facing handoffs contain only:

- the action command;
- a reason capped at 500 characters;
- an optional selected option or authority handle;
- at most eight bounded Atlas evidence handles.

Continuing a paused task is stricter: the in-memory run must still be awaiting
input and match the item run ID, project ID, and checkout ID. The compact delta
is delivered only to that run. Other task changes open the Workbench for human
review and retain its normal privacy, permission, and character-budget gates.

Project-scoped resolutions remain audit records. They do not bypass the Project
Memory proposal and approval flow required to create canonical knowledge.
