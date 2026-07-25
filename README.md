# Component Atlas

Local-first component intelligence for Vue/Nuxt and React/Next repositories.

Component Atlas indexes every UI component, resolves composition and test
relationships, finds explainable similarity, and gives both developers and
coding agents a reuse-first workflow.

## Status

This repository contains a working local-first release:

- Vue/Nuxt and React/Next static analyzers
- SQLite-backed local graph
- inferred prop controls and semantic CSS-token discovery
- live Vue and React component preview runtime
- saved, agent-readable preview scenarios
- CLI and MCP server with the same playground contract
- Nuxt viewer with relationship Map and interactive Lab modes
- reusable `reuse-first` Codex skill

## Quick start

```bash
pnpm install
pnpm build
pnpm atlas scan /path/to/project
pnpm atlas search /path/to/project "modal"
pnpm atlas playground /path/to/project UiButton
pnpm atlas open /path/to/project
```

The scanner writes a small, human-readable catalog and saved preview scenarios
under `.component-atlas/` in the analyzed repository. The database stays outside
the repository under the operating system's local application-data directory.
Running `component-atlas setup` keeps those local artifacts globally ignored by
Git.

See [docs/architecture.md](docs/architecture.md) for the data model and
[docs/workflow.md](docs/workflow.md) for the intended agent workflow.
[docs/setup.md](docs/setup.md) covers Codex, Claude Code, MCP, and skill setup.
