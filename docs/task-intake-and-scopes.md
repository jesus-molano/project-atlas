# Task intake and persistence scopes

Task authorization belongs to native Codex; reusable evidence belongs to
Atlas. `$frontend-task` may be explicit or selected automatically for a complex
frontend implementation with strong signals. It starts with a cheap source and
checkout preflight before any deep scan or retrieval.

## Intake

1. Preserve the original objective as task identity, assign a stable short
   title, and record repository, checkout, branch, HEAD, dirty baseline,
   requested scope, and delivery authority.
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
5. Call `atlas_prepare_task` once for the confirmed evidence version. Without a
   `task_id`, Atlas reuses the focused task for the current checkout and branch,
   or one uniquely safe candidate. `start_new_task: true` is the explicit escape
   hatch for a separate objective when no ID is supplied. For compatibility, an
   explicit `task_id` creates or continues that deterministic identity.
   Preparation returns bounded candidates, findings, receipt IDs, relations,
   and expandable handles, not full source bodies.
6. For medium/large work, record the immutable task evidence contract: original
   objective, acceptance criteria, sources, constraints, exclusions and bounded
   handles. Its successor must link to the prior version.
7. Expand only named evidence needed for the decision. Decide `reuse`, `extend`,
   `compose`, `extract-and-reuse`, `create`, or `not-applicable` before locking.
8. When Figma is authoritative, record a bounded semantic snapshot bound to the
   exact receipt and `fileKey`/`nodeId`/`version`/`lastModified` tuple before
   locking. After a lock, record new evidence only through a named relock window;
   changed identity or required coverage needs a linked successor.
9. Call `atlas_lock_change_scope` with that decision, rationale, exactly one
   existing `primary_component` or planned non-component `primary_surface`,
   exact repository-relative allowed files, and explicit exclusions before the
   first edit. API/consumer impact is derived from the graph and authoritative
   receipts; it is not a caller-supplied assertion.
10. Checkpoint the initial continuation against the new lock before the first
   edit, so criteria and the next safe action survive handoff or compaction.
11. Implement and review in native Codex. Append observations to the active
   task instead of creating correction tasks. Reconcile changed criteria,
   required feedback, Git HEAD, and validation at semantic milestones. Use
   focused checks for small changes;
   medium changes require one independent read-only review; large/high-risk
   changes require at least one, plus only justified specialists. Checkpoint the
   continuation at semantic milestones, not every tool call.
12. Run repository validation and `atlas_validate_change`, then close the
   technical task with `atlas_task_state` action `complete`.
13. Treat memory as a separate, opt-in flow. Only a literal request authorizes
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
| Task | objective, evidence contract, source decisions/receipts, reuse decision, locked surface, semantic continuations, Figma snapshots and technical outcome | compact close/TTL; no transcript and no implicit memory |

The task capsule is bounded and resumes by task ID through `atlas_task_state`
action `resume`. It stores an integrity-checked reference to the full immutable
objective, a stable title, its compact projection, governance classification,
decision/receipt/handle IDs, covered and remaining scope, checkout and branch
identity, lineage, feedback summary, budget, blockers, and next safe action.
Without an ID, the focused task wins for that checkout and branch. Otherwise,
Atlas resumes only one uniquely safe candidate and returns a deterministic
recommendation without creating a task when selection is genuinely ambiguous.
Checkpoints are semantic, not per tool call.

Feedback is an immutable task queue. `note` is advisory;
`correction`, `decision`, `scope-change`, and `review-finding` are required by
default. Sparse reconciliation preserves unchanged criterion progress and
records an advanced descendant Git HEAD as evidence, but a commit never
satisfies a criterion by itself. A changed contract explicitly supersedes only
the affected criteria or decisions. Scope changes invalidate the active lock;
within-scope corrections may create a successor bound to the same surface. A
correction after completion creates a linked child task and leaves the parent
receipt immutable.

Component decisions are idempotent by task ID, decision type and surface.
Superseded decisions remain in history, but only the active relevant decision
is injected. Separate logical projects/checkouts never share component
decisions.
