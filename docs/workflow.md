# Native Codex workflow

Project Atlas is a context and evidence sidecar. Native Codex is the only model
executor and the only place where read-only planning becomes workspace-write.

## Install

```powershell
.\frontend-codex-kit\install.ps1 -Agent codex
```

The installer builds Atlas, installs explicit skills, registers MCP with
`--profile core`, and removes only the obsolete marked Atlas block from
`~/.codex/AGENTS.md`. Personal instructions are preserved.

## Start a task

Open the target checkout in Codex and write:

```text
$frontend-task Replace the mocked synchronization with the real backend contract <links>
```

Without the explicit `$frontend-task` token the skill is not loaded. A normal
frontend request remains a normal Codex task.

The skill performs one bounded preparation, inspects the repository, resolves
only material sources and proposes a decision-complete plan. After approval,
continue in the same native task with workspace-write. Do not create a separate
writer by default.

## Atlas calls

The normal sequence is:

1. `atlas_prepare_task` once;
2. `atlas_expand_context` only for a named unresolved handle;
3. `atlas_lock_change_scope` before editing;
4. `atlas_task_state` only at a semantic checkpoint, blocker, or continuation;
5. `atlas_validate_change` after deterministic checks;
6. `atlas_record_outcome` once.

Administrative scanning, diagnostics, Figma assets/variables and migrations
remain CLI/GUI operations. The temporary 34-tool profile can be selected with
`--profile legacy` only for parity evaluation.

## Sources and failures

Repository evidence is always available. Jira, Confluence, Figma, GitHub and
OpenAPI are considered only when supplied or material. Optional failures are
warnings. A transient OpenAPI 502/503/504 is retried once, then Atlas/Codex uses
an approved validated receipt, generated client/types/tests, or a supplied
local specification. Unsafe authoritative gaps block only dependent work.

## Validation and review

Run targeted tests first, then the package-required lint, typecheck and build.
Review the local diff and call `atlas_validate_change`. Independent model review
is risk-based and Codex-native; see
[the v2 audit](project-atlas-v2-audit.md#independent-agent-review-and-remediation-loop).

## Local telemetry

Telemetry is opt-in:

```powershell
pnpm atlas telemetry configure
pnpm atlas telemetry serve
pnpm atlas telemetry status
pnpm atlas telemetry disable
```

The receiver is loopback-only. Configuration sets `log_user_prompt=false` and
stores no prompts, code, diffs, tool arguments or tool outputs.

## GUI

Run `pnpm atlas` for local inspection. The GUI can browse and rescan evidence,
manage local project/worktree state, review decisions and inspect private
metrics. It cannot start, resume, cancel or change permissions for Codex.
