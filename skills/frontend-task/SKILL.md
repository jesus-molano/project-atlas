---
name: frontend-task
description: Explicit Atlas frontend workflow. Invoke only by direct request.
---

# Frontend Task

Invoke only when the user writes `$frontend-task` or explicitly requests
Frontend Task; never infer it from generic frontend work.

Use one Codex task. Atlas supplies bounded evidence; it must not create,
route, resume, cancel, or grant permissions.

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
2. Preserve the first objective. Corrections may add scope/risk, never silently
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

Call `atlas_prepare_task` once per evidence version with the absolute root,
objective, resolved decisions, receipts/relations, and a prior ID only for the
same task. Keep its ID and handles. Atlas hash-binds objective/governance;
later evidence may raise but never lower it.

If preparation returns `needs-confirmation`, no repository scan or connector
retrieval occurred. Resolve the named decisions and repeat with the same task
ID. Otherwise repeat only for named graph/objective/source/visual invalidation.

Expand only one named unresolved handle. If Atlas is unavailable, perform the
same repository-first reasoning manually.

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

Resolve visual authority before locking. Load the Figma skill only for a
confirmed exact source. Invoke `$visual-direction` explicitly in fidelity mode
to freeze it without alternatives, or in bounded exploration mode only when
authority is unresolved. Every visual implementation attaches its contract via
`atlas_task_state` `attach-evidence` before locking; later evidence needs relock.

For small work, keep a compact intent, decision, scope, and checks. For larger
work, use the brief and obtain required approval.
Plan mode and filesystem permissions belong to native Codex.

Call `atlas_lock_change_scope` only after the decision. `reuse`, `extend`,
`compose`, and `extract-and-reuse` require an existing `primary_component`
among selected IDs. `create` uses a planned surface/files, no selected
component, and rejected candidates or a no-viable-candidate rationale;
`not-applicable` uses a non-component surface. Pass at most two references,
explicit exclusions, and only confirmed OpenAPI impact. Resolve required
findings before edit; broaden only after named invalidation.

## 4. Implement narrowly

- Reuse repository components, tokens, patterns, and generated contracts.
- Keep API, auth, persistence, accessibility-critical, and destructive behavior
  inside confirmed scope.
- Preserve exact Figma node identity; Atlas candidates never replace it
  silently. Do not explore for non-visual work, established patterns, or
  exact-design fidelity.
- Use the same native task. The main native Codex task is coordinator and sole writer;
  optional independent-evidence delegates are read-only.

Use `atlas_task_state` only to resume, attach verified evidence, govern a
confirmed Figma production asset through capture/materialization under its
ChangeSurface, record a blocker, or save a semantic checkpoint not captured
elsewhere. Never poll or checkpoint after every call.

## 5. Validate and review by size/risk

Run narrow tests first, inspect the complete delta against its dirty baseline,
then run required checks. Call `atlas_validate_change`; fix scope escapes and
real regressions, and report advisory findings with evidence.

For a visual lock, register the matrix captures and attach an immutable
pre-clean review while bytes exist; clean the session, then attach the final
review with identical handles/hashes and cleanup receipt. Complete unique
viewport/state coverage and cleanup are mandatory.

- small/low: no agent reviewer; run focused tests and required fast checks;
- medium: one read-only correctness/architecture reviewer when shared/API/state
  warrants it, plus relevant focused tests, lint, typecheck, or build;
- large/high: up to three narrow read-only reviewers plus full applicable gates
  and integration/e2e or visual evidence for correctness, UX/accessibility,
  and security/API only when their domains are present.

Give reviewers objective, criteria, lock/exclusions, risk, evidence, diff, and
checks. Require `pass`, `blocked`, or findings with tight file/line evidence,
ID, severity, reproduction, fix, confidence, and scope. Verify, rerun affected checks, and
stop after two review passes.

## 6. Close technically, then handle memory separately

Call `atlas_task_state` with action `complete` after implementation, validation,
review, and cleanup. Include result, verification, reuse decision, changed-file
summary, risks, and delivery. It is an immutable technical outcome—not proof of
commit/push/PR/deploy—and must not write Project Memory.

Completion is first-writer-wins: HEAD, lock/delta, objective, sources, handles,
and final review hash are bound durably. Identical interrupted/expired retries
converge; changed payload or evidence is rejected.

Default to no memory write. Read memory-closeout only for requested retention
or a concrete candidate. Use `atlas_memory` action `review-proposal` only to
inspect an exact named proposal.
Every memory mutation first submits its complete payload without consent, then
repeats it unchanged only after literal action/target approval. Implementation
approval, completion, silence, or generic "continue" is not memory consent.

Return behavior/files changed, verification, review/delivery state, unresolved
risks, and memory status. Never commit, push, create a PR, or update an external
system unless separately requested.
