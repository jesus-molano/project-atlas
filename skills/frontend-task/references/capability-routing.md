# Capability routing

Use only capabilities callable in the current session and only after the source
preflight authorizes the exact reference. Missing optional capabilities reduce
confidence; they do not invalidate repository-first work.

## Project Atlas core

| Need | Core route | If unavailable |
| --- | --- | --- |
| Prepare task, refresh code evidence, rank reuse | `atlas_prepare_task` after source preflight | Inspect repository manually and keep the same decision contract |
| Expand one unresolved item | `atlas_expand_context` with one returned handle | Open the exact local file or confirmed provider item |
| Persist decision and implementation boundary | `atlas_lock_change_scope` after selecting reuse/extend/compose/extract/create/not-applicable | Write the bounded decision and exclusions in the plan |
| Validate task delta | `atlas_validate_change` after deterministic checks | Inspect staged, unstaged, and untracked task delta manually |
| Attach evidence/review, resume, checkpoint, block, or technically complete | `atlas_task_state` | Keep a compact task-local handoff in the native task |
| Review or write Project Memory | `atlas_memory` with one explicit action | Do not review/write memory; report the unavailable action |

Do not call legacy Atlas tools or assume a `component-atlas` executable exists
on `PATH`. Diagnose missing core tools from the Atlas checkout with
`frontend-codex-kit/doctor.ps1`.

`atlas_validate_change` reports OpenAPI coverage as partial. Its static detector
checks direct literal `fetch`/`$fetch`/`useFetch` and `axios.<method>` calls; it
does not prove wrappers, generated SDK methods, variables, or template-derived
paths compatible. Cover those patterns with generated-client checks, focused
tests, typecheck, and review rather than treating zero detected calls as a pass.

## External sources

| Source | Preferred route | Boundary |
| --- | --- | --- |
| Jira | Connected Atlassian read/fetch for the confirmed issue | Do not search unrelated projects or mutate the issue |
| Confluence | Connected Atlassian read/fetch for the confirmed page | Follow only relevant explicit links |
| GitHub | Connected GitHub capability for confirmed issue/PR/history | Local checkout remains implementation authority |
| OpenAPI | Confirmed local file, pasted contract, or supplied HTTPS URL | Derive only bounded same-origin specs; never execute page JavaScript or follow private/cross-origin targets silently |
| Figma | Confirmed provider route plus the applicable Figma skill | Preserve `fileKey+nodeId`; never substitute a search candidate |

Pass newly retrieved provider evidence into the matching
`atlas_prepare_task.sources[].evidence`; Atlas validates it and emits immutable
receipt IDs. Use `receipt_ids` only to resume evidence Atlas already persisted,
and pass source relations through `source_relations`. Atlas indexes bounded
provenance; it does not replace the provider or authorize connector access.
`sources[].evidence.observed_at` is required and must remain unchanged on an
identical retry.

For OpenAPI already read from an internal connector or pasted by the user, put
the bounded document in `sources[].evidence.openapi_content` on the prepare
call. Atlas verifies or computes its `sha256:` digest, parses it in-memory,
persists only bounded document/operation receipts, and does not refetch its URL.
Use the returned operation receipts for lock and validation; do not write the
contract body to Project Memory.
Continuation and relock reuse the latest content-addressed operation receipts
as a body-free minimal context. Resupply the body only for a deliberate new
contract observation or when full schema/auth detail is again necessary.
Atlas injects at most three confirmed contracts, required-first. More than
three required contracts must be narrowed; optional overflow is returned as a
warning rather than silently displacing required authority.

## Figma routing

1. Confirm the exact Figma reference before access.
2. Prefer the active Figma Desktop connection when it is connected,
   authorized, and exposes the needed read operation. Use another configured
   provider only after naming the unavailable operation and permitted fallback.
3. For a direct node, preserve the exact file/node identity and inspect sparse
   metadata before deep context. Do not rank alternatives.
4. For a file/page, inspect sparse hierarchy, rank only a few task-relevant
   candidates, and confirm one before deep retrieval.
5. Segment broad pages from the start. After timeout, narrow to children and
   retain successful results; never repeat the same oversized request.
6. Treat Ready for dev, global Variables, and Code Connect as useful signals,
   never eligibility requirements.
7. Keep binary/SVG bodies out of context. While prepared, call
   `atlas_task_state` action `capture-figma-asset` with one exact task receipt,
   provider-local URL, and scope node. Lock its returned `figma-asset:` handle
   plus the exact destination, then call action `materialize-figma-asset`;
   materialization fails outside `ChangeSurface.allowedFiles`.
8. Never write to Figma unless the user explicitly requests and approves that
   separate write.

When visual authority is unresolved rather than unavailable, invoke
`$visual-direction`. Exact-design fidelity does not activate exploration.

## Memory routing

Technical completion uses `atlas_task_state` action `complete`; it never calls
memory implicitly. Use one `atlas_memory` action at a time:

- `review-proposal`: read the exact named proposal before a decision; it does
  not mutate memory or replace consent for a later action;
- `record-episodic`: retain a checkout/task-specific verified episode;
- `propose-canonical`: create a reviewable durable candidate;
- `apply-canonical`: apply the exact confirmed canonical proposal;
- `reject-proposal`: record rejection of the named proposal.

The four mutating actions use a two-call protocol: first obtain the exact
no-write scope/token, show it to the user, then repeat the unchanged call only
after literal matching consent. Do not convert completion, implementation
approval, silence, or "continue" into consent.
