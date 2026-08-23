# Architecture

Project Atlas separates deterministic evidence from model execution. It is a
local sidecar, not a task orchestrator: Codex and `frontend-task` execute the
work, while Orca owns workspaces and multi-agent orchestration.

```mermaid
flowchart LR
  C["Native Codex task"] --> S["Selective frontend-task skill"]
  S --> M["MCP core: six tools"]
  M --> R["Runtime composition"]
  R --> I["Code / Design indexes"]
  R --> O["Source adapters and receipts"]
  R --> P["Task capsules and Project Memory"]
  R --> V["Diff validation"]
  G["Local GUI"] --> I
  G --> P
  G --> T["Private usage telemetry"]
  G -. "never executes a model" .-> C
```

## Packages

- `core`: shared types, task/source/risk and change-surface rules;
- `adapter-*`: framework scanners;
- `design`: design normalization, variables and snapshots;
- `memory`: memory formats and indexing;
- `store`: SQLite persistence, evaluations and usage traces;
- `runtime`: composition of deterministic scanners/adapters/receipts and
  durable evidence artifacts;
- `mcp`: core and temporary legacy tool exposure;
- `cli`: project, storage, telemetry and GUI commands;
- `apps/viewer`: local evidence/review UI and local API.

There is no agent, ticket, scheduler, or worktree-management package. MCP tools
call runtime functions; prompts do not reimplement scanner, store or adapter
logic.

## Profiles

`core` is default and exposes six stable high-level operations. `legacy`
preserves 34 v1 tools only for parity and field rollout. Installation registers
core. The legacy profile is retired after the v2 acceptance gates in
[the audit](project-atlas-v2-audit.md#parity-and-retirement-gates).

The core source-state vocabulary is `pending`, `confirmed`, `omitted`,
`unavailable`, and `replaced`. Historical `external` is accepted only by the
legacy adapter/types for read and migration compatibility; callers must convert
it to `confirmed` plus an exact current receipt, or to `omitted`/`unavailable`,
before using the core workflow.

## Storage and identity

Atlas stores data outside checkouts under the centralized local storage root.
Logical-project identity and checkout identity are distinct; code graphs and
local decisions remain checkout-bound, while explicitly approved durable memory
can be logical-project scoped.

Medium and large tasks add immutable, content-addressed evidence contracts and
continuation bundles. Exact-checkout recovery may select a task automatically
only when one safe active candidate exists; otherwise the host must select it.
Figma semantic snapshots are task-scoped evidence: they retain bounded IDs,
styles, variants, states and asset references, not raw Figma responses.

## Trust boundary

The GUI and Atlas CLI can perform explicit local product operations. Native
Codex alone owns model execution and filesystem sandbox choice. External
sources are fetched through declared routes with SSRF/size/content guards, and
their bodies are not persisted in task telemetry.
