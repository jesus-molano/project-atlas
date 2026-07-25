# Project Atlas

Local-first project context for Vue/Nuxt and React/Next repositories.

Project Atlas indexes code and design, relates durable project knowledge, and
gives Codex or Claude compact evidence before implementation.

## Status

The repository contains a working context-engine release:

- Nuxt 4.5, TypeScript 7, and Vite 8 toolchain
- Vue/Nuxt and React/Next static analyzers
- components, routes, and layouts in the consumer/dependency graph
- SQLite-backed component graph
- public, feature, and internal scope classification
- explainable similarity and transitive impact analysis
- compact reuse-context bundle through CLI and MCP
- lightweight cached Figma Design Index with explainable task matching
- optional Ready for dev, Code Connect, library, and variable-catalog signals
- explicit Figma status availability and staged subtree retrieval for large
  frames
- typed Project Memory from canonical/local Markdown with SQLite FTS5 indexing
- hard-capped project orientation, memory search, task context, and change gates
- proposal-first durable memory writes and auditable task outcomes
- strict per-project isolation and preventive secret-like content rejection
- decision/uncertainty findings with evidence and recommendations
- explicit reuse/extend/compose/extract/create decision records
- complete local GUI for code, design, memory, risks, task context, proposal
  review, source health, and retrieval settings
- portable, capability-aware `frontend-task` orchestration skill with native
  source questions when the host supports them
- reusable `reuse-first` workflow module
- `frontend-codex-kit` installer for Codex and Claude Code
- opt-in, idempotent `AGENTS.md` routing block that preserves existing
  instructions

## Quick start

```bash
pnpm install
pnpm build
pnpm atlas scan /path/to/project
pnpm atlas context /path/to/project "confirmation dialog for destructive action"
pnpm atlas memory index /path/to/project
pnpm atlas memory task /path/to/project "add a study filter to search"
pnpm atlas figma find /path/to/project "add coupon validation to checkout"
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
[docs/gui.md](docs/gui.md) for the complete local human interface,
[docs/project-memory.md](docs/project-memory.md) for durable project knowledge,
[docs/token-budgets.md](docs/token-budgets.md) for compact-query guarantees,
[docs/validation.md](docs/validation.md) for the local/external validation line,
[docs/design-index.md](docs/design-index.md) for the two Figma routes,
[docs/workflow.md](docs/workflow.md) for the intended agent workflow, and
[frontend-codex-kit/README.md](frontend-codex-kit/README.md) for installation
and the first run on another computer.

The Project Atlas GUI is available through `pnpm atlas open /path/to/project`.
It reads the same local indexes as CLI and MCP, performs no LLM calls while
browsing, and creates agent context only through an explicit hard-capped task
package.
