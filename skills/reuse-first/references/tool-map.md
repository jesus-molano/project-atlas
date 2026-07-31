# Project Atlas core tool map

Project Atlas exposes one six-tool core profile. Use no legacy tool names.

| Stage | Core tool | Contract |
| --- | --- | --- |
| Prepare | `atlas_prepare_task` | Resolve the task-scoped source ledger, refresh code evidence only after preflight is ready, rank reuse, and return a stable task ID plus bounded handles. |
| Clarify | `atlas_expand_context` | Expand exactly one named `code:`, `entity:`, `design:`, `memory:` or task-bound `visual:`, `visual-review:`, `delivery:`, `retrieval:`, `manifest:`, or `receipt-*` handle. Task-bound handles require the exact `task_id`. |
| Decide and lock | `atlas_lock_change_scope` | Persist the reuse decision and rationale before editing, with one existing component or planned surface, at most two references, exact allowed files, derived graph/API impact, and exclusions. |
| Validate | `atlas_validate_change` | Compare the complete task delta with the persisted lock, baseline, project evidence, and confirmed API operations. |
| Resume or close | `atlas_task_state` | Resume, checkpoint, block, or record the immutable technical outcome. This is not proof of external delivery. Use explicit checkpoints only when no preceding core operation already recorded the same boundary. |
| Optional memory | `atlas_memory` | Review one exact proposal with `review-proposal`; after literal action-specific consent, record episodic memory, propose/apply canonical memory, or reject a proposal. Never use it in automatic technical close. |

Use an absolute `root_path`. Use exact forward-slash repository-relative paths
for `primary_surface.path` and `allowed_files` (no globs); `exclusions` may use
repository-relative files, directories, or supported globs. Keep one stable
`task_id` for the same objective.
A corrected source, graph, objective, visual contract, or scope is a named
invalidation; reuse existing handles when nothing relevant changed.

If a core tool is unavailable, report that Project Atlas is unavailable and
perform repository-first reasoning manually. Do not call a legacy MCP tool or
assume `component-atlas` is installed on `PATH`. Run
`frontend-codex-kit/doctor.ps1` from the Atlas checkout to diagnose installation.
