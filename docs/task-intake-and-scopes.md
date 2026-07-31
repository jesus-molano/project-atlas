# Task intake and persistence scopes

Task authorization belongs to native Codex; reusable evidence belongs to
Atlas. `$frontend-task` is explicit-only and starts with a cheap source and
checkout preflight before any deep scan or retrieval.

## Intake

1. Preserve the original objective as task identity and record repository,
   checkout, branch, HEAD, dirty baseline, requested scope, and delivery
   authority.
2. Classify only supplied or materially required sources as `confirmed`,
   `pending`, `omitted`, or `unavailable`. A bare external link remains
   `pending`, even beside "use this", until confirmation unambiguously binds
   its exact identity, provider, intended authority, and task scope.
3. If a material source is pending, ask one grouped, evidence-led question.
   Do not perform a repository scan or call `atlas_prepare_task` while the
   preflight still needs confirmation.
4. Separate task size (`small`, `medium`, `large`) from risk. Risk derives from
   the original objective, source authority and affected surface; later
   evidence may increase, but not lower, it within the same task.
5. Call `atlas_prepare_task` once for the confirmed evidence version. It returns
   bounded candidates, findings, receipt IDs, relations, and expandable
   handles, not full source bodies.
6. Expand only named evidence needed for the decision. Decide `reuse`, `extend`,
   `compose`, `extract-and-reuse`, `create`, or `not-applicable` before locking.
7. Call `atlas_lock_change_scope` with that decision, rationale, exactly one
   existing `primary_component` or planned non-component `primary_surface`,
   exact repository-relative allowed files, and explicit exclusions before the
   first edit. API/consumer impact is derived from the graph and authoritative
   receipts; it is not a caller-supplied assertion.
8. Implement and review in native Codex. Use focused checks for small changes,
   a reviewed plan and broader applicable checks for medium changes, and staged
   implementation plus domain-specific independent review for large/high-risk
   changes.
9. Run repository validation and `atlas_validate_change`, then close the
   technical task with `atlas_task_state` action `complete`.
10. Treat memory as a separate, opt-in flow. Only a literal request authorizes
    one named `atlas_memory` action and target.

If task-relevant source receipts, checkout identity, graph state, objective, or
locked scope changes materially, record the named invalidation and rerun
`atlas_prepare_task` under the same task ID. Do not rerun it merely because a
new turn starts or context is compacted.

OpenAPI bodies are not persisted. Receipts store identity, status, provenance,
hash and bounded extracted operation evidence. Non-secret exact URLs remain
task-scoped. Task objectives, source references, resolved references, and
routes reject URL userinfo and known token/signature query parameters before
the core handler runs. Internal connectors should report a stable adapter route
identifier, not an authenticated or pre-signed URL.
When an authenticated connector or the user has already supplied a private or
pasted contract, core evidence may carry its UTF-8 text once as
`evidence.openapi_content` (maximum 1.5 MB). Atlas verifies any declared
`content_hash`, parses that transient value without another HTTP/file read, and
then discards it. The durable result is one content-addressed document receipt,
one exact receipt per selected operation, and a compact `operationIndex`; the
raw contract never enters the task capsule, retrieval storage, or Project
Memory. Repeating the same observation and body is idempotent because all
receipt identities derive from the same immutable evidence fields.
Later preparation or relock calls reuse only the latest current,
content-addressed document/operation receipts for each confirmed decision. That
receipt-derived context intentionally contains operation identity rather than
the discarded schemas/auth body, and performs no HTTP or file read. A source
routed to an internal connector or paste can never fall through to automatic
public HTTP/local-file loading when its body or derived receipts are absent.
When at least one contract is required, preparation composes it with the
eligible confirmed optional contracts: failures of required sources and
cross-contract conflicts block, while an unavailable optional contract remains
a labelled advisory instead of silently disappearing from the source picture.
The injected context is bounded to three contracts, ordered required-first.
More than three required contracts blocks preparation; optional overflow is
reported explicitly and can be narrowed or replaced when its operations matter.

## Persistence scopes

| Scope | Contents | Invalidation/promotion |
| --- | --- | --- |
| Logical project | component identities, explicitly approved durable memory, confirmed design metadata | explicit supersession/promotion |
| Checkout | exact graph, scan state, unmerged validation and local hypotheses | rescan or checkout change |
| Task | objective, source decisions/receipts, reuse decision, locked surface, semantic checkpoints and technical outcome | compact close/TTL; no transcript and no implicit memory |

The task capsule is bounded and resumes by task ID through `atlas_task_state`
action `resume`. It stores an integrity-checked reference to the full immutable
objective, its compact projection, governance classification, decision/receipt/
handle IDs, covered and remaining scope, checkout identity, budget, blockers,
and next safe action. Checkpoints are semantic, not per tool call.

Component decisions are idempotent by task ID, decision type and surface.
Superseded decisions remain in history, but only the active relevant decision
is injected. Separate logical projects/checkouts never share component
decisions.
