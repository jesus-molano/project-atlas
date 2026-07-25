# Project Atlas GUI

The local GUI is the human observation and control plane over Code Atlas,
Design Atlas, and Project Memory. It reads the same SQLite database and
Markdown sources used by CLI and MCP. Opening sections, searching, filtering,
and inspecting evidence never invokes an LLM.

Start it for an indexed repository:

```bash
pnpm atlas open /path/to/project
```

The server binds to `127.0.0.1:4173` by default. Use `--port` when that port is
already occupied.

## Sections

- **Overview** exposes index freshness, counts with labels, source health,
  warnings, recent evidence, and the current context contract.
- **Code Atlas** provides component search, scope filters, composition and
  similarity relations, public API, consumers, change impact, and reuse
  candidates.
- **Design Atlas** provides files, pages, sparse nodes, dev status, annotations,
  resources, components, variants, Code Connect evidence, variable collections,
  viewport/flow families, and provenance. Ready for dev raises confidence but
  is not required; unavailable connector metadata is labeled separately from
  an observed missing state.
- **Project Memory** provides typed search, active and historical states,
  authority, confidence, freshness, body, relations, backlinks, and provenance.
- **Decisions & Risks** separates decisions required, warnings, and resolved
  history, always with evidence and a recommendation.
- **Task Context** combines a task with a few relevant code, design, and memory
  candidates under one hard response budget.
- **Memory Inbox** reviews proposed semantic knowledge. A user can revise typed
  items, combine proposals, approve to local or canonical Markdown, or reject
  with an auditable reason.
- **Integrations & Health** shows local source health, optional connector state,
  workspace isolation, and explicit repository/memory refresh actions.
- **Settings** controls browser-local retrieval defaults and explains storage,
  authority, privacy, and write policy.

## Context Inspector

Human browsing is not agent context. Task Context is the only GUI action that
composes a package for Codex or Claude. The inspector reports:

- hard character cap;
- actual characters and estimated tokens;
- total matches;
- whether trimming occurred;
- IDs that can be expanded deliberately.

The runtime clamps every package to 800–12,000 characters. The default remains
3,600 characters, roughly 900 tokens. Copying the result copies only that
bounded package.

## Data and write boundaries

Repository and design facts are reconstructible derived data. Refreshing them
is a local operation. Canonical decisions and conventions remain Markdown.
Personal and episodic records stay in ignored local Markdown plus SQLite.

Memory Inbox is the only GUI path for semantic durable writes. Applying,
rejecting, revising, and combining proposals call the same runtime functions as
CLI/MCP. Secret-like content is rejected before storage. Existing active
knowledge is superseded explicitly rather than overwritten.

## Keyboard, responsive, and failure states

- `Ctrl/Cmd + K` opens transversal code/design/memory search.
- `Escape` closes search.
- Every control has a visible focus treatment and an accessible name.
- At compact widths the navigation becomes a coded rail while retaining full
  labels for assistive technology and tooltips.
- Secondary provenance and budget inspectors move below the main detail instead
  of disappearing.
- Missing design or memory data produces an actionable cold-start state.
- API errors remain in the affected section and can be retried without losing
  the rest of the workspace.
