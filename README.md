# Project Atlas

Project Atlas gives Codex and Claude a compact, reusable map of a frontend
project before they change code. It finds existing components, design evidence,
decisions, risks, and prior outcomes without dumping the whole repository or
design file into the conversation.

The normal entry point is `$frontend-task`. You describe the task; the skill
selects the useful sources and uses Atlas only when it adds value.

## Quick start — Windows + Codex

Requirements:

- Windows with Git;
- Node.js 24 or newer;
- pnpm 11;
- Codex installed and signed in.

Open PowerShell and run:

```powershell
git clone https://github.com/jesus-molano/project-atlas.git
Set-Location .\project-atlas
.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions
```

The installer builds Atlas, installs the skills, adds the small optional routing
instruction, and registers the local Atlas server in Codex's shared
`config.toml`. Restart Codex and open a new task after it finishes.

Now open your product repository in Codex and invoke:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

That is the recommended workflow. You do not need to run `scan`, `memory`,
`context`, or Figma commands first.

## What happens on the first task

`frontend-task`:

1. detects the current repository, task text, explicit links, and capabilities
   that are actually connected;
2. classifies repository, Atlas, Jira/Confluence, Figma, and GitHub for this
   specific task;
3. asks one native question only when a missing source or decision can
   materially change the result;
4. scans the local code with Code Atlas;
5. indexes existing allowed Project Memory when the project has any;
6. uses Design Atlas only when Figma is relevant and a file, page, or node is
   available or confirmed;
7. retrieves a few explainable candidates under a hard context budget;
8. checks decisions, contradictions, fragile areas, and prior failed attempts;
9. implements and validates the change in the product repository;
10. refreshes the code graph, records the observed outcome, and only *proposes*
    durable memory when something is worth keeping.

Invoking the skill authorizes that task workflow. It does not authorize Atlas
to install plugins, access an unconnected source, write to Jira/Figma/Confluence,
or apply durable Project Memory without confirmation.

## What happens on later tasks

Atlas reuses the project-scoped code graph, memory index, and sparse design
cache. It refreshes reconstructible local data when needed and retrieves only a
few task-relevant records. It never injects the complete repository, Figma file,
or memory store into the conversation.

The default task package is hard-capped and reports its estimated size,
truncation state, matches, and IDs that can be expanded deliberately.

## Open the GUI

From the Project Atlas clone:

```powershell
node .\packages\cli\dist\index.js open "C:\path\to\product-repository"
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The GUI lets you review:

- project and index health;
- code components, routes, layouts, relations, consumers, and impact;
- cached Figma structure, status provenance, variables, and candidates;
- project memory, decisions, risks, failed attempts, and freshness;
- bounded task packages before copying them to an agent;
- proposed memory changes before approving or rejecting them.

Browsing the GUI does not call an LLM or consume agent context.

## Sources and graceful fallbacks

| Source or capability | When it is needed | If it is missing |
| --- | --- | --- |
| Product repository | Required for implementation | The skill can prepare advice, but cannot change code |
| Project Atlas | Useful for reuse, impact, design cache, and memory | The skill continues with repository search |
| Jira / Confluence via Rovo | Only when the ticket/spec contains material requirements | Continue with the supplied brief or ask for the missing decision |
| Figma | Required only for a declared source-of-truth design | Continue for non-design work; ask for a link/selection when design is material |
| GitHub | Useful for remote issues, PRs, or history | Continue with the local checkout |
| Ready for dev | A ranking and confidence signal | Semantic design matching still works |
| Global Variables | Useful for file-level collections and modes | Read variables from the confirmed node when available |
| Code Connect | Strong Figma-to-code evidence | Use semantic names, structure, imports, tests, and consumers |

Almost every external source is optional. Missing optional capabilities do not
block the task.

## What is stored where?

| Location | Contents |
| --- | --- |
| Product repository | Product code; Atlas does not change it merely by being queried |
| `<product-repo>/.component-atlas/` | Ignored local artifacts and local memory |
| Windows LocalAppData | Project-scoped SQLite indexes, reconstructible from allowed sources |
| `<product-repo>/project-memory/` | Optional team/canonical Markdown, only when policy allows and a user approves it |
| `~/.agents/skills/` | Global `frontend-task` and `reuse-first` skill links/copies |
| `$CODEX_HOME/config.toml` or `~/.codex/config.toml` | The local `component-atlas` MCP server entry |
| `~/.codex/AGENTS.md` | Optional short routing block installed with `-InstallAgentsInstructions` |

`component-atlas` remains the internal MCP/package identifier for compatibility.
The product name is Project Atlas.

## Update an existing installation

From the Project Atlas clone:

```powershell
git pull --ff-only
.\frontend-codex-kit\install.ps1 -Agent codex -InstallAgentsInstructions
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
  version and ensure `FNM_DIR` is available, then rerun.
- **`$frontend-task` is not detected:** restart Codex and open a new task.
  Confirm `~/.agents/skills/frontend-task/SKILL.md` exists.
- **Port 4173 is busy:** stop the existing process or add `--port <port>` to
  the `open` command.
- **The Atlas clone has local changes:** inspect `git status`; do not use
  `git pull` until those changes are committed, moved, or intentionally removed.
- **Installation must continue without MCP:** use `-SkipMcp` as an escape hatch,
  then configure the server later through approved Codex settings.

## Technical documentation

- [Installation and all flags](docs/setup.md)
- [Automatic task workflow and advanced CLI](docs/workflow.md)
- [First-run checklist](frontend-codex-kit/FIRST-RUN-CHECKLIST.md)
- [GUI](docs/gui.md)
- [Architecture](docs/architecture.md)
- [Figma Design Index](docs/design-index.md)
- [Project Memory and write policy](docs/project-memory.md)
- [Token budgets](docs/token-budgets.md)
- [Security and validation boundary](docs/validation.md)
- [Quality audit, stress tests, and performance baseline](docs/quality-audit.md)
- [`frontend-task` capability routing](docs/frontend-task-integration.md)
- [Installer internals and recovery options](frontend-codex-kit/README.md)
