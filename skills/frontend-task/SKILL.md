---
name: frontend-task
description: Implement complex frontend work with Project Atlas when multiple authorities, shared or public UI/API boundaries, cross-route state, a broad migration, or an Atlas continuation need bounded evidence and scope validation. Also use explicitly; skip small edits, research, diagnosis, and review-only work.
---

# Frontend Task

Explicit requests apply at any size. Activate implicitly only for frontend
implementation with multiple material authorities; a shared/public component
or API; state spanning routes, packages, or browser/server; a broad migration;
or an Atlas continuation. Skip small edits, research, diagnosis, and review.
Name the decisive signal. Ask only about consequential ambiguity, not whether
to use Atlas.

Use a Codex task. Atlas supplies bounded evidence and recovers its durable
continuation state. It must not create, route, resume, supervise, or cancel
native tasks, agents, tickets, terminals, branches, or worktrees, and it never
grants permissions.

## Load references only when active

| Condition | Read |
| --- | --- |
| External reference or source-dependent task | [source-precheck.md](references/source-precheck.md) |
| Medium/large task, continuation, or material unknowns | [brief-contract.md](references/brief-contract.md) |
| Confirmed external evidence or missing core operation | [capability-routing.md](references/capability-routing.md) |
| Unequivocal continuation or correction of the same objective | [continuation-mode.md](references/continuation-mode.md) |
| Technical work is complete and memory may be useful | [memory-closeout.md](references/memory-closeout.md) |

## 1. Establish the baseline and source preflight

1. Read repository instructions; record root/package, branch/HEAD, dirty
   baseline, and required checks. Existing changes are user-owned. Inspect code
   after source decisions resolve.
2. Preserve the first objective and give it a short stable title. Corrections
   become feedback on that task; they may add scope/risk, but never silently
   replace the objective or lower risk for its `task_id`.
3. Classify only sources that are supplied or materially required. A bare
   reference stays `pending`, as does vague "use this". Treat a current-turn
   directive as confirmed without another round only with unambiguous identity,
   provider, authority role, and task scope. Never infer authority from a link.
4. Before connector access, confirm, replace, omit, or mark unavailable every
   pending source. Ask one grouped question only if it changes implementation;
   skip irrelevant provider checklists.
5. Classify size and risk separately: small is local/established; medium is
   shared, stateful, API, or multi-file; large spans flows, systems, or
   migrations. Auth, sensitive/destructive/financial data, critical
   accessibility, and authority conflicts are high risk.

Never probe credentials or connect a plugin without authorization.
Missing optional evidence is a warning, not a blocker.

## 2. Prepare once per evidence version

Call `atlas_prepare_task` once per evidence version with root, stable `title`,
objective, decisions, and receipts/relations. Omit `task_id` to reuse the safe
checkout/branch focus. Use `start_new_task: true` only for a separate objective.
An explicit `task_id` creates or continues that identity for compatibility.
Keep its ID/handles; later evidence may raise but never lower governance.

For medium/large or resumable work, call `atlas_task_state` action
`record-contract` before locking. Persist criteria, product decisions,
constraints, exclusions, receipts, and context handles. Revisions are immutable
and name their predecessor.

If preparation returns `needs-confirmation`, no repository scan or connector
retrieval occurred. Resolve the named decisions and repeat with the same task
ID. Atlas allows one reuse rerank; later retrieval needs invalidation.
On `ready-with-existing-context`, lock scope or choose
`not-applicable`; never retrieve or block.

Expand only one named unresolved handle.

For a transient OpenAPI 502/503/504, retry once. Then prefer a current receipt,
generated clients/types/tests, or a supplied local contract. Ask before using
stale authority; block only dependent work when no safe evidence exists.

## 3. Decide reuse, plan, then lock

Before editing, make one explicit component decision:
`reuse`, `extend`, `compose`, `extract-and-reuse`, `create`, or
`not-applicable`; name the selection, nearest alternative, and rationale.

Produce a size-proportional, decision-complete plan:

- objective/criteria, package, files/APIs, exclusions, authority and reuse;
- data flow/states/assumptions, tests, review tier, and delivery boundary.

Resolve visual authority before locking. For confirmed Figma, before a deep
read call `check-figma-snapshot`: metadata first; reuse needs exact identity,
current task receipt, and full coverage. On mismatch, show its quota warning
and refresh only the scope; never infer an unchanged remote.
Invoke `$visual-direction` explicitly for fidelity, or explore only while
authority is unresolved.

Call `atlas_lock_change_scope` only after the decision. `reuse`, `extend`,
`compose`, and `extract-and-reuse` require an existing `primary_component`
among selected IDs. `create` uses a planned surface/files, no selected
component, and rejected candidates or a no-viable-candidate rationale;
`not-applicable` uses a non-component surface. Pass at most two references,
explicit exclusions, and only confirmed OpenAPI impact. Resolve required
findings before edit; broaden only after named invalidation.

Immediately after locking medium/large work and before the first edit, create
the initial `checkpoint-continuation` against the latest contract and include
`change_surface_lock_id`. Include every governing `visual:` and
`figma-snapshot:` handle in `visual_handles`. Report every criterion exactly
once, normally as `pending`, plus bounded covered/remaining scope and one next
action.

## 4. Implement narrowly

- Reuse repository components, tokens, patterns, and generated contracts.
- Keep API, auth, persistence, accessibility-critical, and destructive behavior
  inside confirmed scope.
- Preserve Figma node identity; Atlas candidates never replace it
  silently. Do not explore for non-visual work, established patterns, or
  exact-design fidelity.
- Use the same native task. The main native Codex task is coordinator and sole writer;
  delegates are read-only.

Use `atlas_task_state` to recover exact-checkout evidence, record/revise the
contract, append/reconcile feedback and Git, attach evidence/assets, block, or
checkpoint. Follow [continuation-mode.md](references/continuation-mode.md) for
feedback types, sparse supersession, relock, and completed-parent children.
Checkpoint only after a semantic batch, decision, validation, or handoff. Bind
the active lock and exact validation reference when they exist.

## 5. Validate and review by size/risk

Run narrow tests first, inspect the complete delta against its dirty baseline,
then run required checks. Call `atlas_validate_change`; fix scope escapes and
real regressions, and report advisory findings with evidence.

For a visual lock, declare route/state/viewport cases. Each needs a browser
capture and Figma comparison. Attach pre-clean then final review with identical
handles/hashes and cleanup receipt. V1 is readable but cannot pass new work.

- small/low: no agent reviewer unless the change crosses a public, security,
  data, accessibility-critical, or deployment boundary;
- medium: one independent read-only correctness/architecture reviewer, plus
  relevant focused tests, lint, typecheck, or build;
- large/high: at least one independent read-only reviewer; use one correctness
  reviewer and at most two additional specialists, three total, plus applicable gates
  and integration/e2e or visual evidence for correctness, UX/accessibility,
  and security/API only when their domains are present.

Require file/line evidence for findings. Verify them, rerun affected checks,
and stop after two review passes. Fix blocking findings and request one fresh
review before claiming success. If a blocker remains after the second pass,
close as blocked or partial instead of silently dropping it.

## 6. Close technically, then handle memory separately

Call `atlas_task_state` with action `complete` after implementation, validation,
review, and cleanup. Include result, verification, reuse decision, changed
files, risks, and delivery. Completion is an immutable technical outcome, not
proof of external delivery, and must not write Project Memory.

When an evidence contract exists, success requires its latest continuation,
every required criterion satisfied by task-owned evidence, no open product
decision or required feedback, and bindings to the active ChangeSurface and
current validation.
Failure or partial closeout records what remains without claiming acceptance.

Completion is first-writer-wins: HEAD, lock/delta, objective, sources, handles,
and final review hash are bound durably. Identical interrupted/expired retries
converge; changed payload or evidence is rejected.

Default to no memory write. Read memory-closeout only for requested retention
or a concrete candidate. Use `atlas_memory` action `review-proposal` for one
exact pending proposal; memory-closeout owns the mandatory two-call,
literal-consent protocol for every mutation.

Use `$to-tickets` only when the user requests an approved delivery backlog or
the approved specification has multiple independently reviewable units that
need external coordination. Ticket decomposition is an optional output after
the brief; it is never Atlas runtime state and does not make Atlas an
orchestrator.

Return behavior/files changed, verification, review/delivery state, unresolved
risks, and memory status. Never commit, push, create a PR, or update an external
system unless separately requested.
