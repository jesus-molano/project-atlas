---
name: frontend-task
description: Explicit workflow for preparing, implementing, and validating a frontend task with Project Atlas. Invoke only when the user writes `$frontend-task` or directly asks to use this skill.
---

# Frontend Task

Use this workflow only after explicit invocation. One objective plus a few links
is sufficient input. Inspect the repository and callable capabilities before
asking for information that can be discovered locally.

## 1. Prepare once

1. Read repository instructions and identify the package, framework, existing
   implementation, tests, and validation commands.
2. Treat the first objective as immutable task identity. Corrections may add
   scope or raise risk, but never lower the stored risk for the same `task_id`.
3. Classify only sources that are supplied or materially required. Repository
   evidence is the baseline; Jira, Confluence, Figma, OpenAPI, and other links
   are not a mandatory chain.
4. If Project Atlas is available, call `atlas_prepare_task` once with the
   absolute repository root, objective, explicit sources, and prior `task_id`
   only when resuming the same task. Keep the returned task ID and handles.
5. Ask at most three questions, and only for product decisions, conflicting
   authoritative evidence, or a required source that cannot be recovered.

Source authority is explicit: a confirmed exact link or local contract outranks
search candidates. Missing optional evidence is a warning, not a blocker.
Never probe credentials or install/connect a plugin without user authorization.

### OpenAPI failures

For a transient Swagger/OpenAPI failure, retry once. Then prefer, in order:
an already validated receipt; generated repository clients/types/tests; a
user-supplied local contract. If the contract is authoritative, ask before
using stale evidence and block only the contract-dependent work when no safe
evidence exists. Report the HTTP status and concrete recovery choices. Never
remove a source merely to reduce risk.

## 2. Produce an architectural plan

Before editing, make the plan decision complete:

- objective, affected package and explicit exclusions;
- source authority and unresolved conflicts;
- reuse/extend/compose/extract/create choice with evidence;
- component and file surface, public API and data flow;
- loading, empty, error, success, disabled and responsive states as relevant;
- accessibility and localization effects;
- targeted tests, validation commands, and acceptance criteria.

Use `atlas_expand_context` only for a named unresolved handle. Once the target
is known, call `atlas_lock_change_scope` with one primary component, no more
than two references, and explicit exclusions. Do not explore beyond the locked
surface without stating the evidence that invalidated it.

Plan mode and filesystem permissions belong to native Codex. Atlas does not
invent a second read-only/write transition. Wait for plan approval when the
host requires it, then continue in the same native task with the permissions
selected by the user.

## 3. Implement narrowly

- Follow repository conventions and reuse existing primitives and tokens.
- Preserve confirmed source identities and operation contracts.
- Do not create a new abstraction unless the reuse evidence rules out the
  nearest candidates.
- Keep API, auth, persistence, accessibility-critical, and destructive
  behavior within explicitly confirmed scope.
- For Figma work, load the relevant Figma skill/reference only when Figma is a
  confirmed source. Prefer the exact confirmed node; candidates never replace
  it silently.
- When visual authority is unresolved and bounded exploration is necessary,
  invoke `$visual-direction` explicitly. Do not load it for non-visual work or
  exact-design fidelity.

Checkpoint with `atlas_task_state` only at a semantic boundary: locked scope,
blocked source, validated change, or resume after compaction. Do not checkpoint
after every tool call.

## 4. Validate deterministically

1. Run the narrowest relevant tests, then required typecheck/lint/build checks.
2. Call `atlas_validate_change` with the task ID and confirmed OpenAPI
   operations. Resolve failures; report advisory warnings with evidence.
3. Review the diff for unrelated changes, missing states, invented visual
   values, API drift, and accidental generated artifacts.

## 5. Review proportionally

The main native Codex task is coordinator and sole writer. Do not create a
separate implementer by default. Optional recovery delegates must be read-only
and are justified only by measurable context pressure or genuinely independent
domains; they return evidence, never scope decisions or edits.

After deterministic checks, use independent native review by risk:

- small/low: no agent reviewer; use deterministic checks and human diff review;
- medium: one read-only correctness/architecture reviewer for shared
  components, stateful UI, API integration, mock-to-backend migration, or a
  meaningful multi-file surface;
- high: up to three narrow read-only reviewers only for applicable domains:
  correctness/architecture, UX-accessibility-fidelity, and security/API.

Do not use a broad mega-reviewer. A correction may raise but never lower the
review tier. Atlas must not create, route, resume, cancel, or grant permissions
to reviewers.

Give a reviewer only the original objective, approved acceptance criteria,
locked change surface and exclusions, risk/tier, relevant receipt/handle IDs,
changed-file list or local diff access, and validation commands/results. Do not
replay the conversation, skill, indexes, policies, source bodies, or full diff
inside the prompt; the reviewer inspects the checkout as needed and cannot
edit.

Require `pass`, `blocked`, or prioritized findings. Each finding needs a stable
ID, severity, tight file/line evidence, violated criterion or contract,
reproduction/check, bounded remediation, confidence, and whether it expands
scope. Unsupported preferences and speculation are not findings.

The coordinator verifies each finding before editing, fixes accepted findings
as the sole writer, reruns affected checks, and may request one focused second
read-only pass over the remediation. Stop after two review passes. Escalate
conflicting evidence, absent authority, or scope expansion to the human.

## 6. Record and close

1. Call `atlas_record_outcome` once with the result, verification, and reuse
   decision. Propose project memory only for durable knowledge; never promote
   it automatically.
2. Store only supported content-free review metrics when available. Never send
   reviewer prompts, code, diff bodies, comments, or model responses to Atlas.
3. Return a concise outcome: files/behavior changed, verification performed,
   review status, unresolved risks, and memory candidate or `none`.

If Atlas is unavailable, perform the same repository-first reasoning manually
and continue. Load a file under `references/` only when its named domain is
actually active; none is required for every task.
