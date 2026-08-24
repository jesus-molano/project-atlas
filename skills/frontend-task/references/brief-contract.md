# Frontend task brief

Use this conversational contract for medium/large tasks, high-risk work, and
resumable continuations. It is a human brief, not an MCP request body. The
mapping to the six core tools is defined below. For a small task, report only
objective, decision, scope, assumptions, and checks.

```yaml
title: Stable short task title
objective: One observable product outcome
identity:
  task_id: Stable Atlas/native task ID
  mode: new | continue | correct | finish
  objective_confirmed: true | false
  parent_task_id: Completed parent for a correction child, or none
repository:
  root: Absolute path
  package: Target package/route/feature
  framework: Detected framework/version when relevant
  branch: Current branch or detached HEAD
  head: Exact HEAD
  dirty_baseline:
    - User-owned staged, unstaged, or untracked paths present before work
classification:
  size: small | medium | large
  risk: low | medium | high
  reasons: [Evidence-backed reasons]
acceptance:
  contract_handle: Immutable `contract:` handle after preparation
  previous_contract_handle: Prior revision or none
  criteria:
    - id: Stable criterion ID
      statement: Observable criterion
      required: true | false
      source_refs: [Task-owned receipt or context handles]
  decisions:
    - id: Stable product decision ID
      status: open | resolved | deferred
      answer: Exact resolved answer or none
sources:
  ledger:
    - kind: jira | confluence | figma | github | openapi | other
      reference: Exact URL, ID, or local path
      state: pending | confirmed | omitted | unavailable | replaced
      replacement_for: Prior source ID when this source explicitly replaces it, or none
      authority_role: requirement | visual | contract | implementation-reference
      required: true | false
      relationship: primary | search-candidate | linked-secondary
      evidence_status: pending | newly-retrieved | receipt-bound
  receipt_ids: [Only immutable Atlas receipt IDs already persisted for this task]
  conflicts:
    - Smallest contradictory statements and recommended resolution
  relations:
    - Explicit source-to-scope relationship
reuse:
  intent: Precise component responsibility
  decision: reuse | extend | compose | extract-and-reuse | create | not-applicable
  selected: Component ID/path or none
  nearest_rejected: Component IDs/paths or none
  rationale: Evidence-backed reason
scope:
  primary_component: One existing graph component, mutually exclusive with primary_surface
  primary_surface:
    kind: route | service | state | api | configuration | files
    id: Planned or non-component surface identity
    path: Exact repository-relative path or none
  reference_components: [At most two]
  allowed_files: [Exact forward-slash repository-relative paths; no globs]
  derived_apis: [Atlas-derived public APIs/endpoints]
  derived_impact: Atlas-derived consumers/relationships
  exclusions: [Explicit exclusions]
  lock_status: pending | locked | blocked
behavior:
  data_flow: Compact description
  states:
    loading: required | not-applicable
    empty: required | not-applicable
    error: required | not-applicable
    success: required | not-applicable
    disabled: required | not-applicable
    pending: required | not-applicable
    destructive: required | not-applicable
  responsive: Relevant viewports/rules or not-applicable
  accessibility: Semantics, keyboard, focus, announcements, contrast, motion
  localization: Copy/format effects or not-applicable
visual_direction:
  authority: Exact Figma identity, incumbent system, selected direction, or none
  mode: fidelity | inherit | explore | redesign | not-applicable
  visual_handle: Selected opaque visual handle or none
  contract_hash: Selected contract hash or none
  cleanup: clean | active | cleanup-pending | not-applicable
  figma_snapshot:
    handle: Immutable `figma-snapshot:` handle or none
    identity: Exact fileKey, nodeId, version, and lastModified
    coverage: Explicit complete/partial/not-requested categories
    reuse_preflight: metadata-only | reusable | bounded-refresh | not-applicable
unknowns:
  blocking:
    - Only unresolved decisions that materially change implementation
  warnings:
    - Non-blocking inconsistency plus recommendation
  resolved:
    - Low-impact assumption backed by repository convention
validation:
  focused: [Narrow tests/checks]
  required: [Repository-required lint/typecheck/build/e2e]
  atlas: atlas_validate_change
  visual_cases: Explicit route/state/viewport cases with separate browser and Figma evidence
review:
  tier: none | correctness | specialist
  domains: [correctness, ux-a11y-fidelity, security-api]
delivery:
  requested: working-tree | commit | push | pull-request
  external_write_authorized: true | false
resume:
  continuation_handle: Latest immutable `continuation:` handle or none
  criterion_progress:
    - criterion_id: Stable contract criterion ID
      status: pending | satisfied | blocked | deferred
      evidence_refs: [Task-owned expandable handles]
      validation_refs: [Exact current Atlas validation reference]
  covered: [Bounded completed scope]
  remaining: [Bounded remaining scope]
  next_safe_action: One action
  feedback:
    pending_required: Count
    latest_handle: Immutable `feedback:` handle or none
  git:
    relation: same | advanced | diverged | unknown
    stored_head: Exact prior HEAD or none
    current_head: Exact current HEAD or none
technical_close:
  status: pending | complete | blocked
  verification: [Completed checks]
memory:
  status: none | episodic-candidate | canonical-candidate | proposal-pending | stored | declined
  consent: not-requested | pending | literal-confirmed | declined
```

## MCP mapping

| Brief field | Core input/evidence |
| --- | --- |
| `title`, `objective`, `identity.task_id`, `identity.objective_confirmed` | `atlas_prepare_task.title`, `objective`, `task_id`, `objective_confirmed`; an explicit `task_id` creates or continues that identity, omitting it reuses focus, and `start_new_task: true` creates a separate objective without an ID |
| `sources.ledger[*]` | `sources[*]`; a newly retrieved provider result goes in that source's `evidence`, including stable `observed_at` |
| `sources.receipt_ids` | Top-level `atlas_prepare_task.receipt_ids`, only for task receipts Atlas already persisted |
| `sources.relations` | `atlas_prepare_task.source_relations` |
| `acceptance.*` | `atlas_task_state` action `record-contract`; changed semantics require `previous_handle` |
| `reuse.*`, `scope.primary_*`, `reference_components`, `allowed_files`, `exclusions` | `atlas_lock_change_scope`; selected/rejected component values are exact graph IDs |
| `scope.derived_apis`, `scope.derived_impact` | Read-only output derived by Atlas; never pass these as caller assertions |
| `validation.*` | Repository commands first, then `atlas_validate_change` |
| Mid-task observation | `atlas_task_state` action `append-feedback`; corrections, decisions, scope changes, and review findings are required by default |
| Sparse progress and Git reconciliation | `atlas_task_state` action `reconcile`; update only changed criteria and resolve named feedback IDs |
| `resume.*` | `atlas_task_state` action `checkpoint-continuation`; report every contract criterion exactly once |
| `technical_close` | `atlas_task_state` action `complete`; the record is not proof of commit/push/PR/deploy |
| `memory` | Independent `atlas_memory` flow; never implied by technical close |

For `reuse`, `extend`, `compose`, and `extract-and-reuse`, use an existing
`primary_component` and include it in selected IDs. For `create`, use
`primary_surface`, exact future `allowed_files`, no selected IDs, and real
rejected candidates (or an explicit “no viable candidate” rationale). For
`not-applicable`, use only a non-component `primary_surface` and no candidate
bookkeeping.

## Preparation response

Before code, report only:

1. objective, size/risk, and acceptance summary;
2. source authority, unavailable optional sources, and unresolved conflicts;
3. reuse decision and selected/nearest rejected candidates;
4. locked or proposed surface and exclusions;
5. relevant states, accessibility/responsive effects, and validation;
6. one evidence-backed blocking question, if needed.

Do not include memory closeout before implementation and verification. Do not
paste full source documents, raw indexes, Figma trees, or receipt bodies. Keep
only semantic Figma snapshot fields and opaque handles; retrieve raw provider
context again only when the exact identity changed or recorded coverage is
insufficient.

## Gate examples

Decision required:

> The API contract requires an idempotency key, while the existing generated
> client does not expose one. I recommend pausing only the submit integration
> until the governing contract is confirmed. Should the supplied contract
> remain authoritative?

Warning:

> Two dialogs have the same responsibility and consumers. Choose `extend` or
> `compose` before creating another component; the nearest rejected candidate
> must be named in the lock rationale.

Resolved:

> Global Figma Variables are unavailable. The confirmed node and repository
> tokens provide enough bounded fidelity evidence, so this remains non-blocking.
