# Frontend Codex Kit

Portable setup for the Component Atlas context engine and the `frontend-task`
workflow. It installs local skills and a local stdio MCP server; it does not
copy, request, or configure corporate credentials.

## What gets installed

- `frontend-task`: prepares a minimal brief from whatever sources exist,
  applies the evidence-backed uncertainty gate, and orchestrates implementation.
- `reuse-first`: enforces Atlas discovery before creating or extending UI.
- Component Atlas MCP: compact component, graph, similarity, impact, decision,
  Figma Design Index, and Project Memory queries.
- Project Memory: project-scoped Markdown knowledge, local episodic outcomes,
  preventive change gates, and proposal-first durable writes.
- `.component-atlas/` in the global Git ignore file. The SQLite database remains
  in local application data outside product repositories.

The Figma Lab and component previews do not exist. The only optional browser
surface is the read-only relationship map.

## Requirements on a new Windows computer

1. Git.
2. Node.js 24 or newer.
3. pnpm 11 (`corepack enable` and `corepack prepare pnpm@11 --activate` are
   acceptable when corporate policy permits).
4. Codex and/or Claude Code already installed and signed in through the method
   approved by the organization.
5. Read access to the product repository.

Jira, Confluence, Figma, Dev Mode, Ready for dev, Code Connect, and global
Figma Variables are optional. Connect them through their normal approved
clients only when available.

## Install

Clone this repository to a stable private path, then run:

```powershell
Set-Location "C:\path\to\component-atlas"
.\frontend-codex-kit\install.ps1 -Agent both
```

Useful variants:

```powershell
# Inspect every action without changing the machine
.\frontend-codex-kit\install.ps1 -Agent both -DryRun

# Codex only
.\frontend-codex-kit\install.ps1 -Agent codex

# Install skills now but configure MCP manually later
.\frontend-codex-kit\install.ps1 -Agent both -SkipMcp

# Copy skills instead of linking them to the clone
.\frontend-codex-kit\install.ps1 -Agent both -InstallMode copy
```

`-CodexSkillsRoot` and `-ClaudeSkillsRoot` can override the personal folders for
managed or isolated environments; use only paths approved by the organization.

The installer is idempotent for its own links and preserves an existing MCP
entry named `component-atlas`. It refuses to overwrite a different skill
directory. Review or remove stale entries explicitly before rerunning.

Codex loads global skills from `~/.agents/skills`; Claude Code loads them from
`~/.claude/skills`. A new top-level skills directory can require restarting the
client once.

## First repository

```powershell
$atlas = "C:\path\to\component-atlas"
$repo = "C:\path\to\product-repository"

node "$atlas\packages\cli\dist\index.js" scan $repo
node "$atlas\packages\cli\dist\index.js" memory index $repo
node "$atlas\packages\cli\dist\index.js" memory orient $repo --budget 2400
node "$atlas\packages\cli\dist\index.js" memory task $repo `
  "confirmation dialog for a destructive async action" --budget 3600
```

The scan should print framework, component and relationship counts. Orientation
and task context should stay within their reported hard budgets and return
expandable IDs rather than source dumps.

Then start a new agent task in the product repository:

```text
$frontend-task Prepara esta tarea: añadir cupón al checkout.
```

In Claude Code:

```text
/frontend-task Prepara esta tarea: añadir cupón al checkout.
```

The agent should identify available sources, create a brief, query Atlas, and
only ask a question if a material decision is unresolved.

After a verified task, the agent may record a local episodic outcome. A durable
decision/convention is only proposed; applying it requires your explicit
confirmation.

## Project Memory on a work repository

Choose storage according to company policy:

- `project-memory/*.md`: optional team/canonical knowledge that may be
  versioned when approved;
- `.component-atlas/memory/*.md`: local/personal and episodic knowledge, ignored
  by Git;
- local application-data SQLite: reconstructed index, safe to rebuild.

Do not turn `AGENTS.md` into an encyclopedia. Copy and adapt
`templates/AGENTS.project-atlas.example.md` as a short map that links to deeper
repository docs and memory.

## Add Figma when it exists

Direct route:

1. Supply a concrete Figma node URL or select the frame in the supported Figma
   client.
2. Tell the agent it is the confirmed target.
3. The agent requests deep context, screenshot, and selection variables only
   for that node.

General route:

1. Supply a file or page.
2. The agent obtains sparse metadata and caches it with `map_figma_file`.
3. Atlas ranks a few nodes with `find_design_candidates`.
4. Confirm one node, then retrieve deep context.

Ready for dev improves ranking but is never required. A personal file without
Dev Mode is ranked by semantic names, hierarchy, annotations, links,
components, variants, device context, and Atlas matches.

Manual fixture smoke:

```powershell
node "$atlas\packages\cli\dist\index.js" figma map $repo `
  "https://www.figma.com/design/PersonalShop/Personal-shop" `
  --metadata "$atlas\fixtures\figma\personal-no-dev-mode.xml" `
  --format figma-mcp-xml

node "$atlas\packages\cli\dist\index.js" figma find $repo `
  "añadir cupón en checkout móvil" `
  --file PersonalShop
```

Expected: node `60:2`, status `none`, with a mobile-match reason. No Ready for
dev node is needed.

## Optional source combinations

| Available evidence | Expected flow |
| --- | --- |
| Repository + conversation | Brief, Atlas reuse context, implement and verify |
| Jira only | Read issue, use acceptance criteria, then Atlas |
| Confluence only | Extract relevant constraints, then Atlas |
| Confirmed Figma node | Direct node inspection plus Atlas |
| Figma file/page | Sparse map, ranked candidates, confirmation, then deep context |
| Screenshot only | Treat as visual evidence; ask only about material missing behavior |
| Any combination | Merge evidence; stop only for contradictions or impact decisions |

If a connector is unavailable, continue with the sources that remain and name
the missing validation honestly.

## Figma permissions and safe fallback

- File metadata needs read access through the connected Figma client or an
  approved read-only REST scope.
- Global Variables enumeration can require an eligible Enterprise organization,
  seat, file access, and `file_variables:read`.
- Without global Variables access, use `get_variable_defs` for the confirmed
  node. Do not request write scopes.
- Code Connect is optional evidence; absence is not proof that no code component
  exists.
- Atlas never stores Figma, Jira, or Confluence credentials.

## Optional read-only relationship map

Build the full workspace once and open it:

```powershell
pnpm build
node "$atlas\packages\cli\dist\index.js" open $repo
```

It binds to `http://127.0.0.1:4173` and shows component relationships only. It
does not run previews or the removed Lab.

## Complete GUI status

The read-only relationship map is not the final Project Atlas GUI. A complete
human surface for Code, Design, Memory, decisions/risks, task context, proposal
inbox, integrations/health, and settings is the last product phase after the
engine gates and real-data validation. See
[../docs/gui-roadmap.md](../docs/gui-roadmap.md).

## Tomorrow checklist

Use [TOMORROW.md](TOMORROW.md) for the short execution checklist and the clear
boundary between local validation and work-data validation.

## Current local validation

The project fixtures cover Vue/Nuxt, React/Next, component reuse context, MCP
surface, sparse Figma REST/XML mapping, incremental cache behavior, variables,
Code Connect evidence, mobile/desktop ranking, confirmed-node handoff, and Figma
without Ready for dev. Project Memory fixtures additionally cover cold start,
current/superseded/conflicting knowledge, failed attempts, code+design+memory
task context, hard budgets/pagination, secret rejection, proposal confirmation,
idempotent rebuilds, and cross-project isolation.

Still external: one real work repository, one real Figma file/selection with
approved read access, and five representative work tasks.
