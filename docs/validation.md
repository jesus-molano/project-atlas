# Validation and external boundary

Validated locally on 2026-07-25 without corporate data:

- production build: Nuxt 4.5.0, Vite 8.1.5, Vue 3.5.40;
- TypeScript build/typecheck for every package and the viewer;
- 22 tests across Code Atlas, Design Atlas, Project Memory, runtime, and MCP;
- cold start and idempotent Markdown rebuild;
- active versus superseded knowledge;
- contradictory active decisions and stale-memory warnings;
- previous failed attempt raised by `check_before_change`;
- strict isolation between two fixture project roots;
- one shared 2,800-character task budget containing memory, code, and design;
- no-Figma fallback and Figma ranking with zero Ready for dev nodes;
- cursor/truncation metrics and output-size assertions;
- secret-like proposal rejection without echoing the value;
- proposal-first write, explicit confirmation, and episodic outcome;
- MCP in-memory client/server smoke with compact `structuredContent`;
- CLI end-to-end smoke for index, orient, search, task, gate, propose, apply,
  and outcome;
- `frontend-task` official skill validation;
- portable installer PowerShell parse, dry run, isolated link/copy, and
  idempotency checks.

Representative measured CLI output:

| Query | Budget | Actual compact output | Result |
| --- | ---: | ---: | --- |
| Orient | 1,600 chars | 1,498 chars | project/code/design/memory map |
| Task context | 2,800 chars | 2,583 chars | 1 memory + 1 code + 1 design |
| Figma candidate | included above | status `none` | no Ready for dev required |

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
- complete Project Atlas GUI and its final UX tuning.

No credentials, corporate tickets, documents, designs, or repository content
were accessed or copied during local validation.
