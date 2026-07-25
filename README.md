# Component Atlas

Local-first component intelligence for Vue/Nuxt and React/Next repositories.

Component Atlas indexes every UI component, resolves composition and test
relationships, finds explainable similarity, and gives both developers and
coding agents a reuse-first workflow.

## Status

This repository contains the first working slice:

- Vue/Nuxt and React/Next static analyzers
- SQLite-backed local graph
- CLI and MCP server
- read-only Nuxt graph viewer
- reusable `reuse-first` Codex skill

## Quick start

```bash
pnpm install
pnpm build
pnpm atlas scan /path/to/project
pnpm atlas search /path/to/project "modal"
pnpm atlas open /path/to/project
```

The scanner writes only a small, human-readable catalog under
`.component-atlas/` in the analyzed repository. The database stays outside the
repository under the operating system's local application-data directory.

See [docs/architecture.md](docs/architecture.md) for the data model and
[docs/workflow.md](docs/workflow.md) for the intended agent workflow.
[docs/setup.md](docs/setup.md) covers Codex, Claude Code, MCP, and skill setup.
