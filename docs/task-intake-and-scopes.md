# Task intake and persistence scopes

Project Atlas separates task authorization from reusable project knowledge.
This avoids both premature editing and cross-branch knowledge contamination.

## Read-only intake and editing gate

A new task starts in Codex/`$frontend-task`; the Codex handoff sidecar can
inspect and record the same structured intake before context generation:

1. Atlas classifies risk from the objective.
2. Small repository-only changes continue without a requirements interview.
3. Medium/high-risk objectives require an explicit scope confirmation. Every
   new high-risk task first gets one grouped Jira, Confluence, Figma, and
   OpenAPI/Swagger source confirmation before repository investigation, even
   when no reference or connector was detected. Each source can be confirmed,
   supplied/replaced, or explicitly omitted.
4. Every detected Jira, Confluence, Figma, GitHub, OpenAPI/Swagger, or other
   reference starts `pending`. Task wording never auto-confirms a contract.
5. The user confirms it, replaces/adds a source, omits it, or marks it
   unavailable. Optional omitted sources never block the task.
6. Only confirmed sources enter task context or authorize connector access;
   connector health, credentials, and searches are not probed beforehand.
   OpenAPI is loaded only after confirmation; Atlas extracts a bounded
   task-relevant subset of operations, parameters, schemas, responses, and
   authentication instead of injecting the full specification. A confirmed
   Swagger UI URL remains the requested identity while Atlas may statically
   derive a same-origin specification URL through bounded config or initializer
   reads. The receipt records that derivation without storing either response
   body. Cross-origin redirects/targets, private-network destinations, and
   ambiguous contract lists fail closed. Local, pasted, public, and
   authenticated/internal connector routes record distinct provenance. One
   failed contract does not discard valid contracts; conflicting operations
   block instead of being silently merged.
7. Codex prepares the brief in a read-only turn.
8. Editing requires a second confirmation and resumes the same reviewed thread
   with checkout write permission.

The task draft and active run remain in browser/in-memory state. Atlas stores
the complete task source ledger and bounded task state outside every checkout
under `%LOCALAPPDATA%\ProjectAtlas\projects\<project-id>\task-state\`. The
append-only journal contains semantic milestones, while one materialized
capsule (maximum 4 KB) contains the approved objective, source-decision and
receipt/Atlas handle IDs, covered/remaining scope, worktree/HEAD, budget, and
next safe action. Resume loads only this capsule and expands ledger entries by
handle when needed. Closed capsules expire after 24 hours; Atlas then keeps only
a minimal final receipt (task ID, completion time, HEAD, receipt IDs). Legacy
checkout-local state may be read compatibly but is never migrated or deleted
automatically.

OpenAPI references and extracted contract context remain task-scoped. They are
never promoted to durable project memory automatically. Exact confirmed and
derived URLs live only in the external source ledger/receipts; specification,
Swagger UI, config, and initializer bodies are excluded from persisted run
audits and capsules.

## Scope policy

| Scope | Belongs here | Promotion and invalidation |
| --- | --- | --- |
| Logical project | Stable repository identity, reusable component catalog, confirmed durable memory, confirmed general decisions, confirmed design metadata | Promotion is explicit except reconstructible catalog semantics; replacement/supersession keeps provenance |
| Checkout | Exact code graph, scan state, unmerged changes, validation episodes, hypotheses, and unconfirmed component decisions | Invalidated by rescan, checkout change, or later confirmation |
| Task/thread | Intake, exact source references, confirmations, brief, risk, permissions, bounded milestone journal, and resume capsule | Closed capsule TTL is 24 hours; promotion is always explicit and no transcript is retained |

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
- An active task can resume from its bounded capsule without replaying chat or
  indexes. After capsule expiry, start a new read-only intake; the minimal final
  receipt is traceability, not enough to infer prior decisions.
- If a confirmed source becomes unreadable, keep its task ledger state and
  report the capability failure without substituting another source.
- An exact confirmed Figma node, Jira issue, Confluence page, or OpenAPI
  contract always wins over search. Search results are candidates; linked
  secondary sources return to `pending`. Identity, version, or freshness
  discrepancies block with a minimal explanation.
- A changed task reference returns that source to `pending`; unchanged
  confirmations remain valid within the same task.
