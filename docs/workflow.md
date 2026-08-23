# Native Codex workflow

Project Atlas is a context and evidence sidecar. Native Codex owns conversation,
planning, permissions, implementation, review, and delivery; Orca owns
workspaces and multi-agent orchestration. Atlas does not create, route, resume,
supervise, or cancel host tasks, agents, tickets, terminals, branches, or
worktrees.

## Install and diagnose

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

The installer builds Atlas, installs selectively automatic `frontend-task` and
the two explicit child skills, registers the six-tool `core` MCP profile, and
removes only the obsolete marked Atlas block from `~/.codex/AGENTS.md`. Restart
Codex and open a new task after changes.

## Start

For a localized low-risk task, invoke the daily entry point directly:

```text
$frontend-task Update the existing empty-state copy and its focused test
```

For medium, large, high-risk, or materially uncertain work, use a reviewed plan
gate:

```text
/plan $frontend-task Replace the mocked synchronization with the real backend contract <links>
```

Without `$frontend-task`, Codex may select Atlas only for frontend
implementation with strong signals: multiple material authorities,
shared/public UI or API boundaries, cross-route/package state, a broad
migration, or an existing Atlas task. Small local work and research,
diagnosis, or review-only requests remain normal Codex tasks. `reuse-first` and
`visual-direction` stay explicit-only and are not parallel end-to-end entry
points:

| Skill | Boundary |
| --- | --- |
| `$frontend-task` | The normal end-to-end frontend workflow: sources, reuse, implementation, validation, technical outcome, and optional separate memory flow. |
| `$reuse-first` | A standalone repository-only reuse gate. `frontend-task` applies the same reuse decision contract internally without starting a second skill or prepare cycle. |
| `$visual-direction` | A child of a prepared Atlas task when its output will govern implementation. Standalone exploration may compare temporary directions, but cannot attach an Atlas handoff without the parent `task_id`. |

## Daily sequence

1. Inspect repository instructions, branch/HEAD, dirty baseline, package,
   implementation, and validation commands.
2. Resolve only supplied or materially required sources. Bare detected links
   remain pending until confirmed; irrelevant provider checklists are skipped.
3. Call `atlas_prepare_task` after preflight. For medium/large work, record an
   immutable evidence contract immediately afterwards. Repeat under the same
   task ID for one bounded re-ranking when the objective becomes more precise.
   Further retrieval needs a typed `retrieval_invalidation_reason`. If prepare
   returns `ready-with-existing-context`, continue to the lock with planned
   surfaces or `not-applicable`; do not block the task or retrieve again.
4. Expand one unresolved handle with `atlas_expand_context` if necessary.
5. For authoritative Figma work, record a semantic task snapshot before
   locking. Bind `fileKey`, `nodeId`, `version` and `lastModified` to the current
   receipt. After a lock, a new snapshot is accepted only inside an explicit
   relock-required window and must link to its predecessor when changed.
6. Make the reuse decision, present a size-proportional plan, then call
   `atlas_lock_change_scope` with that decision and explicit exclusions.
7. Immediately checkpoint the initial continuation against that lock, before
   the first edit. Then implement the smallest locked surface in the same native
   task and checkpoint successors after semantic milestones, not every tool call.
8. Run focused tests and required checks. For visual work, attach an immutable
   pre-clean review while captures exist, clean the temporary session, then
   attach the final task/contract-bound review with the same capture hashes and
   the content-free cleanup receipt.
9. Call `atlas_validate_change`; inspect the complete staged, unstaged,
   untracked, renamed, and deleted task delta, then call `atlas_task_state`
   action `complete` for an immutable technical outcome record.
10. Before `success`, satisfy all contract acceptance criteria, resolve required
    decisions, attach current validation evidence, and perform the proportionate
    independent review. Atlas technically rejects incomplete durable evidence;
    the native workflow owns the reviewer gate. `partial` and `failure` remain
    available for an honest closeout.
11. Default to no memory write. `review-proposal` may read one exact proposal;
   every mutation first returns a no-write exact scope/token and requires an
   unchanged second call after literal consent.
12. Commit, push, PR, deployment, or external updates happen only when
    separately requested and are reported separately from the Atlas record.

The first accepted completion payload is a durable intent bound to the current
HEAD, lock/delta, source receipts, context handles, evidence contract,
continuation, and final visual-review hash. Identical concurrent or interrupted
retries converge on one completion; different evidence or closeout text is
rejected. Completion never implies a memory write.

Resume always accepts an explicit task ID. Without one, it recovers only the
single active task whose stored checkout identity exactly matches the current
checkout; multiple candidates require an explicit selection. Context compaction
does not create a new task or justify an unbounded source reread.

## Core calls

| Tool | Use |
| --- | --- |
| `atlas_prepare_task` | Source-gated preparation, code refresh, bounded reuse/context, stable task ID |
| `atlas_expand_context` | One named unresolved handle |
| `atlas_lock_change_scope` | Persist decision, exact allowed files, references, Git baseline, derived graph/API evidence, and exclusions before edit |
| `atlas_validate_change` | Validate the complete task delta against the lock and confirmed contracts |
| `atlas_task_state` | Resume, attach bounded evidence/review, checkpoint, block, or technically complete |
| `atlas_memory` | Review one proposal; mutate only through the two-call, payload-bound literal-consent protocol |

Administrative migrations, bulk diagnostics, and local GUI inspection remain
CLI/GUI operations. They are not part of the normal task path.

## Exact lock contract

| Decision | Required primary | Component bookkeeping |
| --- | --- | --- |
| `reuse`, `extend`, `compose`, `extract-and-reuse` | Existing `primary_component` from the current Atlas graph | The primary must be in `selected_component_ids`; every selected/rejected ID must exist and the sets cannot overlap. |
| `create` | Planned `primary_surface` plus exact future `allowed_files` | No selected component. Name real rejected candidates, or state explicitly that no viable candidate exists. |
| `not-applicable` | Non-component `primary_surface` | No selected or rejected component candidates. |

`root_path` is absolute. `primary_surface.path` and `allowed_files` are exact,
forward-slash, repository-relative paths; they are not globs. `exclusions` may
name repository-relative files/directories or supported globs. APIs and impact
are derived from the graph and current authoritative receipts rather than
accepted as caller assertions.

## Terminal outcomes and retry

| Situation | Atlas action |
| --- | --- |
| Work cannot safely proceed | `atlas_task_state` `block`, with the exact blocker and next safe action. |
| Verified subset is useful but required scope remains | `complete` with `result: partial`, explicit remaining risk, and exact verified files/checks. |
| Attempt is conclusively unsuccessful | `complete` with `result: failure` and the diagnostic evidence; do not claim delivery. |
| Intended scope is verified | `complete` with `result: success`. |

Completion is first-writer-wins. An interrupted/concurrent retry must repeat the
same summary, verification list, files, source/handle bindings, and final visual
review exactly; changed closeout evidence starts a new decision, not a retry.

## Validation and review

- Small/low: focused checks and human-readable diff review; use an independent
  reviewer only for a public, security, accessibility, data, or deployment
  boundary.
- Medium: relevant checks plus one independent read-only correctness review.
- Large/high: full applicable gates plus at least one independent read-only
  review; add only narrow specialists justified by the changed domains.

Independent review supplements deterministic checks and never becomes a second
writer. Fix blockers, rerun affected checks, and request at most one focused
second review. Stop after two review passes and report a blocker or partial
outcome if it remains unresolved.

`to-tickets` is optional after an approved specification when independently
reviewable delivery units help humans plan delivery. It is not an Atlas runtime
feature and does not control Codex/Orca task execution.

## Sources and failures

Repository evidence is the baseline. Optional Jira, Confluence, Figma, GitHub,
or OpenAPI failures are warnings. Required authoritative gaps block only their
dependent work. Transient OpenAPI failures retry once, then prefer a current
receipt, generated client/types/tests, or a supplied local contract.

## GUI and telemetry

Run `pnpm atlas` for local evidence inspection. The GUI can rescan local data,
inspect/open existing checkouts, and review decisions/proposals. It cannot
create branches or worktrees, execute or resume Codex, change permissions,
technically complete a native task, or apply memory without the originating
consent flow.

Telemetry is opt-in and loopback-only. It stores no prompts, code, diffs, tool
arguments, tool outputs, or source bodies.

This document is the canonical human workflow. The executable contract is
[`skills/frontend-task/SKILL.md`](../skills/frontend-task/SKILL.md); other
guides describe only their narrower responsibility and link back here.
