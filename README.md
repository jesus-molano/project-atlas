# Component Atlas

Local-first component context for Vue/Nuxt and React/Next repositories.

Component Atlas indexes the existing UI surface, resolves composition and test
relationships, finds explainable similarity, and gives Codex or Claude compact
reuse context before implementation.

## Status

The repository contains a working context-engine release:

- Nuxt 4.5, TypeScript 7, and Vite 8 toolchain
- Vue/Nuxt and React/Next static analyzers
- SQLite-backed component graph
- public, feature, and internal scope classification
- explainable similarity and transitive impact analysis
- compact reuse-context bundle through CLI and MCP
- explicit reuse/extend/compose/extract/create decision records
- read-only relationship map
- reusable `reuse-first` workflow module

Component previews and the Lab have intentionally been removed. Atlas does not
try to reproduce an application's runtime or styling pipeline.

## Quick start

```bash
pnpm install
pnpm build
pnpm atlas scan /path/to/project
pnpm atlas context /path/to/project "confirmation dialog for destructive action"
pnpm atlas open /path/to/project
```

`context` is the primary agent query. It returns a compact candidate list with
scope, source path, public API, composition, consumers, similarity evidence,
tests, and change impact.

Focused `search`, `show`, `similar`, and `impact` queries are also compact by
default. Their `--raw` option is reserved for indexer diagnostics because it can
include large style-token and source-analysis payloads. MCP follows the same
contract with `raw: true`.

The scanner writes a small human-readable catalog and decision records under
`.component-atlas/` in the analyzed repository. The database stays outside the
repository under the operating system's local application-data directory.
Running `component-atlas setup` keeps local artifacts globally ignored by Git.

See [docs/architecture.md](docs/architecture.md) for the data model,
[docs/workflow.md](docs/workflow.md) for the intended agent workflow, and
[docs/frontend-task-integration.md](docs/frontend-task-integration.md) for the
future portable skill boundary.
