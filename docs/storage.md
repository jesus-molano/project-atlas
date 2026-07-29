# Project Atlas storage

Project Atlas never writes indexes, receipts, task state, journals, previews,
generated catalogs, decisions, or local/canonical memory into a repository it
analyzes.

The single default root on Windows is:

```text
%LOCALAPPDATA%\ProjectAtlas\
```

`PROJECT_ATLAS_HOME` may override that root for tests or managed
installations. Atlas does not use `.codex` for project content. Codex's own MCP
registration remains in Codex configuration because that file belongs to the
host, not to Atlas.

## Layout

```text
ProjectAtlas/
├── recent-projects.json
├── projects/
│   └── <logical-project-id>/
│       ├── atlas.sqlite
│       ├── project.json
│       ├── catalog.md
│       ├── decisions/
│       ├── memory/
│       │   ├── canonical/
│       │   └── local/
│       └── task-state/
│           ├── capsules/
│           ├── ledgers/
│           ├── journals/
│           ├── manifests/
│           ├── receipts/
│           ├── retrieval/
│           └── retrieval-results/
└── temp/
    ├── visual-direction/
    └── assets/
```

`projects/` is durable. `temp/` is ephemeral and every owned session has an
expiry plus explicit close/cancel cleanup. Cleanup verifies ownership and
never recursively deletes an unverified path.

`temp/assets/` contains only validated Figma bytes plus small ownership/expiry
metadata addressed by opaque handles. It stores no Desktop MCP localhost URL.
Expired entries are purged individually after schema/handle verification;
selected assets enter a checkout only through the explicit production-asset
materialization command.

`ledgers/` holds the complete immutable source decisions, provider policies,
and cross-source scope relations. Capsules contain only a bounded resume
projection, so a long confirmed URL is never truncated at the trust boundary
and later checkpoints do not require the user to repeat it.

Logical project identity is based on the normalized Git remote, then the Git
common directory, and finally the canonical path. Worktrees share the logical
project while checkout-specific graphs and local outcomes retain their
checkout ID.

## Diagnostics

```powershell
pnpm atlas storage
pnpm atlas storage --json
```

The command prints the effective root, category sizes, which categories are
ephemeral, and any legacy roots detected for read-only compatibility.

Legacy `.component-atlas/`, `project-memory/`, and older
`%LOCALAPPDATA%\ComponentAtlas\` data are never deleted or rewritten
automatically. Repository-local Markdown can still be indexed as legacy
read-only evidence. New writes always go to the centralized `ProjectAtlas`
root. Migration of an old application-data root must be an explicit,
user-reviewed operation.
