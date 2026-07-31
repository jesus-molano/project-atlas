# Project Atlas

Project Atlas gives Codex and Claude a compact, reusable map of a frontend
project before they change code. It finds existing components, design evidence,
decisions, risks, and prior outcomes without dumping the whole repository or
design file into the conversation.

The normal entry point is native Codex with `$frontend-task`. You describe the
task; the skill selects useful sources and uses Atlas as a compact, verifiable
context sidecar only when it adds value. The GUI is an optional control,
inspection, and traceability surface, not a replacement conversation.

## Quick start - Windows + Codex

Requirements:

- Windows with Git;
- Node.js 24 or newer;
- pnpm 11;
- Codex installed and signed in.

Open PowerShell and run:

```powershell
git clone https://github.com/jesus-molano/project-atlas.git
Set-Location .\project-atlas
.\frontend-codex-kit\install.ps1 -Agent codex
.\frontend-codex-kit\doctor.ps1
```

The installer builds the local product, installs the three explicit-only
skills, removes only the obsolete marked Atlas routing block if it exists, and
registers the six-tool MCP core profile in Codex's shared `config.toml`.
`doctor.ps1` then verifies the effective install without changing it. Restart
Codex and open a new task after both commands finish.

Now open your product repository in Codex. Use the direct fast path for a
localized, low-risk change:

```text
$frontend-task Implement this localized change: <description>
```

Use Plan mode for medium, large, high-risk, or materially uncertain work:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

You do not need to run `scan`, `memory`, `context`, or Figma commands first.

## What happens on the first task

`frontend-task`:

1. records the exact checkout, branch, HEAD, dirty baseline, objective, links,
   requested scope, and delivery authority;
2. runs a cheap source preflight before deep repository or Atlas work; bare
   external links remain `pending` until the user confirms or omits them;
3. calls `atlas_prepare_task` once for that confirmed evidence version, using
   only sources that are supplied or materially required;
4. separates task size (`small`, `medium`, `large`) from risk and retrieves a
   bounded set of explainable candidates and opaque handles;
5. expands only the evidence needed to decide `reuse`, `extend`, `compose`,
   `extract-and-reuse`, `create`, or `not-applicable`;
6. persists that decision and the narrow change surface with
   `atlas_lock_change_scope` before editing;
7. implements in native Codex and scales planning/review to task size and risk;
8. runs focused repository checks, attaches any required structured visual
   review after temporary cleanup, then validates the complete Git delta with
   `atlas_validate_change` and reviews it;
9. closes the technical task with an immutable `atlas_task_state` technical
   outcome record, without writing memory; this is not proof of commit, push,
   PR, deployment, or any external delivery;
10. may review one exact memory proposal; every mutating `atlas_memory` action
    uses a no-write scope/token call followed by the exact unchanged call only
    after literal user consent. Technical completion never implies it.

Invoking the skill authorizes that task workflow. It does not authorize Atlas
to install plugins, access an unconfirmed or unconnected source, write to
Jira/Figma/Confluence, or mutate Project Memory without matching literal
consent.

## What happens on later tasks

Atlas reuses project-scoped component semantics, confirmed memory, and sparse
design metadata. Exact code graphs and scan state remain checkout-scoped. It
refreshes reconstructible local data when needed and retrieves only a few
task-relevant records. It never injects the complete repository, Figma file, or
memory store into the conversation.

The default task package is hard-capped and reports its estimated size,
truncation state, retrieval hits/misses/retries, and IDs that can be expanded
deliberately. Source receipts are referenced by immutable ID; receipt bodies,
full indexes, and source documents stay outside the prompt.

## Open the GUI

For local-product-only use from a fresh clone:

```powershell
git clone https://github.com/jesus-molano/project-atlas.git
Set-Location .\project-atlas
pnpm install --frozen-lockfile

# Open the project selector.
pnpm atlas

# Or open one product repository directly.
pnpm atlas -- "C:\path\to\product-repository"
```

If the normal Codex installer was already run, dependencies and the initial
production build are already present; use the same `pnpm atlas` commands.

`pnpm atlas` builds the production product only when its build is missing or
older than its sources, selects a free loopback port, starts only the local
viewer, opens the browser, and prints the URL. Current Atlas data stays outside
the checkout under the centralized Project Atlas storage root. Keep that
terminal open and press Ctrl+C there to close Atlas and its viewer process.

The desktop-shaped local workspace lets you:

- see the exact logical project, checkout/worktree, branch, HEAD, and diff state;
- list local branches independently of recent projects, open an existing branch
  worktree, or review and confirm creation of a separate sibling worktree;
- create a local branch and worktree together from an explicitly selected
  local base branch plus a reviewed conventional prefix and descriptive name,
  without switching any existing checkout;
- switch among successfully opened recent projects or choose, drop, or paste
  another repository without restarting the server;
- search code, design, and memory from one command surface;
- choose evidence by goal: reuse, impact, tests, design state, or prior decision;
- inspect bounded source receipts and task outcomes created by native Codex;
- review local usage telemetry and context-cost estimates without storing
  prompts, code, tool arguments, or tool output;
- review evidence-backed decisions and memory proposals without storing raw
  external documents.

Browsing, searching, rescanning, and reviewing local evidence use zero model
tokens. Model execution and filesystem permissions exist only in native Codex;
the GUI cannot launch, resume, cancel, or reclassify a task.

The loopback browser exposes **Choose folder...** through a narrowly scoped local
directory dialog on Windows. A packaged desktop host can provide the same action
through its versioned folder-picker adapter. Dropping an absolute folder path is
also supported when the host exposes it. Atlas fills the path for review and
never scans, uploads, or starts an agent until you confirm **Open project**.

## Sources and graceful fallbacks

| Source or capability | When it is needed | If it is missing |
| --- | --- | --- |
| Product repository | Required for implementation | The skill can prepare advice, but cannot change code |
| Project Atlas | Useful for reuse, impact, design cache, and memory | The skill continues with repository search |
| Jira / Confluence via Rovo | Only when the ticket/spec contains material requirements | Continue with the supplied brief or ask for the missing decision |
| Figma | Required only for a declared source-of-truth design | Continue for non-design work; ask for a link/selection when design is material |
| GitHub | Useful for remote issues, PRs, or history | Continue with the local checkout |
| Ready for dev | A ranking and confidence signal | Semantic design matching still works |
| Global Variables | Useful for file-level collections and modes | Record the access state; a confirmed-node read is only a selection-scoped fallback, never an equivalent catalog |
| Code Connect | Strong Figma-to-code evidence | Use semantic names, structure, imports, tests, and consumers |

Almost every external source is optional. Missing optional capabilities do not
block the task.

## What is stored where?

| Location | Contents |
| --- | --- |
| Product repository | Product code; Atlas does not change it merely by being queried |
| Platform Atlas root: `%LOCALAPPDATA%\ProjectAtlas\` (Windows), `~/Library/Application Support/ProjectAtlas/` (macOS), or `${XDG_DATA_HOME:-~/.local/share}/ProjectAtlas/` (Linux) | SQLite, indexes, memory, decisions, capsules, journals, receipts, manifests, and bounded retrieval state under `projects/` |
| `<platform Atlas root>/temp/` | Owned temporary assets/previews with TTL and explicit cleanup |
| `<platform Atlas root>/recent-projects.json` | Minimal recent-project registry |
| `~/.agents/skills/` | Global explicit-only `frontend-task`, `visual-direction`, and `reuse-first` skill links/copies |
| `$CODEX_HOME/config.toml` or `~/.codex/config.toml` | The local `component-atlas` MCP server entry |
| `~/.codex/AGENTS.md` | Personal instructions; the installer only removes its obsolete marked Atlas block |

`component-atlas` remains the internal MCP/package identifier for compatibility.
The product name and single storage root are Project Atlas. Import and remove a
legacy repository-local directory explicitly after reviewing the dry-run:

```powershell
pnpm atlas storage migrate "C:\path\to\repository" --dry-run
pnpm atlas storage migrate "C:\path\to\repository" --apply --remove-source
```

The second command verifies the imported hashes before deleting only
`<repo>\.component-atlas`; it keeps the repository and centralized Atlas data.

## Update an existing installation

From the Project Atlas clone:

```powershell
git pull --ff-only
.\frontend-codex-kit\install.ps1 -Agent codex
```

The installer is idempotent. Restart Codex and open a new task afterwards.

## Troubleshooting

- **Packaged `codex.exe` fails with redirected output:** pull the latest `main`
  and rerun the normal installer. Windows now writes `config.toml` directly and
  does not invoke `codex mcp get/add`.
- **MCP config conflict:** compare the current and expected paths printed by the
  installer. Use `-ForceMcpConfig` only when replacing that exact section is
  intentional. A backup is created before changes.
- **Node resolves through an ephemeral fnm path:** activate an installed fnm
  version, confirm `fnm current` and `fnm exec --using <version> node --version`
  succeed, then rerun.
- **`$frontend-task` is not detected:** restart Codex and open a new task.
  Run `.\frontend-codex-kit\doctor.ps1`; its failed check prints the exact
  reinstall or config action. Confirm `~/.agents/skills/frontend-task/SKILL.md`
  exists.
- **A fixed port is required for diagnostics:** add `--port <port>` to
  `pnpm atlas`; normal use selects a free port automatically.
- **The browser did not open:** copy the printed loopback URL, or add
  `--no-browser` when opening the product intentionally without it.
- **Visual work has no settled design:** `$frontend-task` explicitly loads
  `$visual-direction` to resolve authority, compare only bounded temporary
  options, lock one DesignContract, and purge exploration artifacts. It is
  intentionally not activated implicitly.
- **The Atlas clone has local changes:** inspect `git status`; do not use
  `git pull` until those changes are committed, moved, or intentionally removed.
- **Installation must continue without MCP:** use `-SkipMcp` as an escape hatch,
  then configure the server later through approved Codex settings.

## Technical documentation

- [Installation and all flags](docs/setup.md)
- [Native task workflow and advanced CLI](docs/workflow.md)
- [First-run checklist](frontend-codex-kit/FIRST-RUN-CHECKLIST.md)
- [GUI](docs/gui.md)
- [Action Center decisions and risks](docs/action-center.md)
- [Desktop evidence-workspace contract](docs/desktop-workspace.md)
- [Task intake and persistence scopes](docs/task-intake-and-scopes.md)
- [Architecture](docs/architecture.md)
- [Atlas v2 audit, rollout gates, and independent review loop](docs/project-atlas-v2-audit.md)
- [Frontend framework support and acceptance matrix](docs/frontend-framework-support.md)
- [Figma Design Index](docs/design-index.md)
- [Project Memory and write policy](docs/project-memory.md)
- [Centralized storage and diagnostics](docs/storage.md)
- [Token budgets](docs/token-budgets.md)
- [Context-cost measurement and cross-computer workflow](docs/phase-2-context-cost-assessment.md)
- [Phases 3-5 implementation record](docs/phases-3-5-implementation.md)

- [Security and validation boundary](docs/validation.md)
- [Quality audit, stress tests, and performance baseline](docs/quality-audit.md)
- [Generated quality summary](docs/generated-quality-summary.md)
- [`frontend-task` capability routing](docs/frontend-task-integration.md)
- [Installer internals and recovery options](frontend-codex-kit/README.md)

Context-cost metrics are private and local by default. Inspect them with
`pnpm atlas:cli -- context-cost report .`; move only the content-free numeric
bundle between computers with `context-cost export` and `context-cost import`.
Run the reproducible 12-case baseline with `pnpm benchmark:context-cost`.
