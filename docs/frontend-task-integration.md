# `frontend-task` integration

`frontend-task` is an explicit Codex skill. Its manifest sets
`allow_implicit_invocation: false`; the installer writes no global frontend
routing rule. Invoke it with `$frontend-task`.

The skill is under 8,000 characters and has no always-loaded references. It
uses progressive disclosure: OpenAPI, Figma, security, continuation and memory
references are read only when that domain is active.

## Contract

- inspect repository instructions and existing implementation first;
- call `atlas_prepare_task` once;
- ask only for product decisions, conflicting authority or an unrecoverable
  required source;
- produce a decision-complete plan and lock the `ChangeSurface`;
- continue in the same native Codex task after approval;
- validate deterministic checks and the Atlas diff findings;
- record one outcome and propose memory only for durable knowledge.

If Atlas is unavailable, Codex follows the same repository-first workflow
without the MCP sidecar. Missing optional connectors never block the task.

## Activation tests

Installation/skill tests must prove that a generic frontend prompt does not
load the skill, the explicit `$frontend-task` invocation does, and migration
removes only the marked Atlas block from `AGENTS.md` while preserving personal
content.
