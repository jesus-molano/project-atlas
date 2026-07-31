# Task intake and persistence scopes

Task authorization belongs to native Codex; reusable evidence belongs to
Atlas. `$frontend-task` is explicit and starts with repository inspection.

## Intake

1. Preserve the original objective as task identity.
2. Detect supplied links and add only materially required sources.
3. Calculate risk from objective, authority and affected surface. Later input
   may increase, never reduce, risk in the same task.
4. Confirm or omit material sources. Optional omissions/failures are warnings.
5. Retrieve bounded evidence and return handles rather than full source bodies.
6. Lock one primary component, relevant files/APIs and explicit exclusions.
7. Native Codex presents the plan and later receives workspace-write after
   human approval.

OpenAPI bodies are not persisted. Receipts store identity, status, provenance,
hash and bounded extracted operation evidence. Exact URLs remain task-scoped.

## Persistence scopes

| Scope | Contents | Invalidation/promotion |
| --- | --- | --- |
| Logical project | component identities, approved durable memory, confirmed design metadata | explicit supersession/promotion |
| Checkout | exact graph, scan state, unmerged validation and local hypotheses | rescan or checkout change |
| Task | objective, source decisions/receipts, locked surface, semantic checkpoints and outcome | compact close/TTL; no transcript |

The task capsule is bounded and resumes by task ID. It stores approved objective,
decision/receipt/handle IDs, covered and remaining scope, checkout identity,
budget and next safe action. Checkpoints are semantic, not per tool call.

Component decisions are idempotent by task ID, decision type and surface.
Superseded decisions remain in history, but only the active relevant decision is
injected. Separate logical projects/checkouts never share component decisions.
