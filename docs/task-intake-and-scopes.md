# Task intake and persistence scopes

Project Atlas separates task authorization from reusable project knowledge.
This avoids both premature editing and cross-branch knowledge contamination.

## Read-only intake and editing gate

A new task starts in the Task Workbench before Codex runs:

1. Atlas classifies risk from the objective.
2. Small repository-only changes continue without a requirements interview.
3. Medium/high-risk objectives require an explicit scope confirmation. Every
   new high-risk task first gets one grouped Jira, Confluence, Figma, and
   OpenAPI/Swagger source confirmation before repository investigation, even
   when no reference or connector was detected. Each source can be confirmed,
   supplied/replaced, or explicitly omitted.
4. Every detected Jira, Confluence, Figma, GitHub, OpenAPI/Swagger, or other
   reference starts `pending`. An unequivocal instruction to use one exact
   OpenAPI specification may count as confirmation.
5. The user confirms it, replaces/adds a source, omits it, or marks it
   unavailable. Optional omitted sources never block the task.
6. Only confirmed sources enter task context or authorize connector access;
   connector health, credentials, and searches are not probed beforehand.
   OpenAPI is loaded directly only after confirmation; Atlas extracts a bounded
   task-relevant subset of operations, parameters, schemas, responses, and
   authentication instead of injecting the full specification.
7. Codex prepares the brief in a read-only turn.
8. Editing requires a second confirmation and resumes the same reviewed thread
   with checkout write permission.

The task draft, exact references, ledger, brief, risk, permissions, and active
run are retained only in browser session state and the in-memory agent-run
registry. Persisted run audits contain counts and source kinds, not task text,
exact references, or thread IDs.

OpenAPI references and extracted contract context remain task-scoped. They are
never written to durable memory automatically, and exact URLs or specification
content are excluded from persisted run audits.

## Scope policy

| Scope | Belongs here | Promotion and invalidation |
| --- | --- | --- |
| Logical project | Stable repository identity, reusable component catalog, confirmed durable memory, confirmed general decisions, confirmed design metadata | Promotion is explicit except reconstructible catalog semantics; replacement/supersession keeps provenance |
| Checkout | Exact code graph, scan state, unmerged changes, validation episodes, hypotheses, and unconfirmed component decisions | Invalidated by rescan, checkout change, or later confirmation |
| Task/thread | Intake, exact source references, confirmations, brief, risk, permissions, and execution state | Expires with the browser/server task session; promotion is always explicit |

The shared component catalog stores semantic identities with checkout sightings
and content hashes. A rescan replaces only the current checkout's sightings.
Different hashes are marked divergent; consumers still use the current
checkout graph for code decisions.

Project Memory already records authority, confidence, scope, provenance,
supersession, and review/expiry fields. Agent learning remains a proposal until
a user applies it. Component reuse decisions now default to checkout scope;
project scope requires an explicit confirmation flag. Canonical memory is shared
by the logical project, while `local` and `episodic` items carry a checkout ID
and are filtered on every list, search, lookup, and context build. Their physical
storage key includes that checkout ID, so two worktrees may safely retain
different versions of the same logical memory ID.

When Atlas encounters a legacy non-canonical memory row without checkout
provenance, the first matching checkout scan claims and rekeys it locally. It is
never promoted to canonical memory as a migration side effect.

## Fallbacks

- A missing optional connector resolves as `unavailable` or `omitted`.
- An expired task/thread cannot be reconstructed from content-free audit data;
  start a new read-only intake and use a prior outcome only as evidence.
- If a confirmed source becomes unreadable, keep its task ledger state and
  report the capability failure without substituting another source.
- A changed task reference returns that source to `pending`; unchanged
  confirmations remain valid within the same task.
