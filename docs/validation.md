# Validation and external boundary

Validated locally on 2026-07-26 without corporate data:

- relative documentation links and the five-minute installation command;
- production build: Nuxt 4.5.0, Vite 8.1.5, Vue 3.5.40;
- TypeScript build/typecheck for every package and the viewer;
- 29 tests across 11 files covering Code Atlas, Design Atlas, Project Memory,
  runtime, MCP, and the `frontend-task` source precheck;
- cold start and idempotent Markdown rebuild;
- active versus superseded knowledge;
- contradictory active decisions and stale-memory warnings;
- previous failed attempt raised by `check_before_change`;
- strict isolation between two fixture project roots;
- one shared 2,800-character task budget containing memory, code, and design;
- no-Figma fallback and Figma ranking with zero Ready for dev nodes;
- status-capable and status-unavailable Figma sources without treating
  unavailable metadata as `none`;
- page/frame status preservation, scoped-page provenance, idempotent forced
  reindexing, transient-asset filtering, and staged subtree inspection;
- responsive/storyboard family grouping, naming findings, and small-breakpoint
  coverage warnings without false duplicate claims;
- route/layout consumers and task-aware code retrieval for dialogs, security,
  authentication, and biometric concepts;
- cursor/truncation metrics and output-size assertions;
- secret-like proposal rejection without echoing the value;
- proposal-first write, explicit confirmation, and episodic outcome;
- MCP in-memory client/server smoke with compact `structuredContent`;
- CLI end-to-end smoke for index, orient, search, task, gate, propose, apply,
  and outcome;
- `frontend-task` metadata/reference validation and 11 capability-routing cases:
  repository-only, Jira, Figma, all sources, absent plugins, absent Atlas,
  design-required, non-visual, native selector, and chat fallback;
- portable installer PowerShell parse, dry run, isolated link/copy, and
  idempotency checks;
- optional managed `AGENTS.md` routing block: preservation, replacement,
  idempotency, dry-run, absent file, and malformed-marker refusal;
- direct Codex MCP config registration: absent/existing configs, comments and
  unrelated sections, backups, matching/conflicting blocks, explicit force,
  Windows paths, alternate `CODEX_HOME`, dry-run, and idempotency;
- complete nine-section GUI over Vuenime (78 nodes, 230 relations) and a
  temporary full fixture (4 components, 8 Figma nodes, 6 memory items);
- browser interaction checks for transversal search, design and memory detail,
  evidence-backed risks, proposal revision/application, responsive navigation,
  accessible names, empty states, and zero horizontal overflow;
- production-server API smokes for Overview, Workspace, bounded Task Context,
  repository refresh through the CLI boundary, and memory refresh.

Representative measured CLI output:

| Query | Budget | Actual compact output | Result |
| --- | ---: | ---: | --- |
| Orient | 1,600 chars | 1,498 chars | project/code/design/memory map |
| Task context | 2,800 chars | 2,583 chars | 1 memory + 1 code + 1 design |
| Figma candidate | included above | status `none` | no Ready for dev required |
| CLI Task Context on Vuenime | 2,400 chars | 1,242 chars / 311 tokens | 2 code candidates |
| GUI Task Context on Vuenime | 3,600 chars | 2,026 chars / 507 tokens | 5 code candidates |

The fixture deliberately contains contradictory search-filter decisions, so the
task and pre-change gates correctly return `blocked` with a specific question,
evidence, and recommendation. This is expected evaluation behavior, not a
runtime failure.

Still external and not claimed as validated:

- scope classification and component relevance on the real work repository;
- one approved Figma file/page map and one direct node selection;
- real Figma version/`lastModified` refresh behavior through the work connector;
- availability of global Variables and Code Connect;
- Jira/Confluence connector availability and source-conflict quality;
- five representative work tasks and candidate usefulness;
- company policy for committing `project-memory/` and for Obsidian/sync;
- final ranking and UX calibration with real company-scale data.

No credentials, corporate tickets, documents, designs, or repository content
were accessed or copied during local validation.
