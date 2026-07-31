# Project Atlas GUI

The GUI is a local evidence and review workspace. It contains no model runner.

## Navigation

- **Home** shows checkout identity, diff state, recent projects and source
  freshness.
- **Code** explores components, consumers, tests, reuse and change impact.
- **Design** explores indexed Figma evidence, states, variants and mappings.
- **Memory** shows active project knowledge and supersession history.
- **Action Center** resolves evidence-backed decisions, contradictions, risks
  and warnings.
- **Memory Inbox** approves or rejects compact knowledge proposals.
- **Connections** shows source/index health and exact versus estimated usage.
- **Settings** controls local presentation and private evaluation data.

Project selection, branch/worktree creation, local rescans, receipt review and
memory decisions remain explicit local operations. They do not call a model.

## Model-execution boundary

Native Codex owns task text, planning, permissions, implementation and
continuation. The GUI exposes no prepare/implement/continue/retry/cancel action,
no thread state and no Codex adapter health. Removed `/api/agent/runs*` routes
return 404.

## Privacy

Search and browsing read local indexes and consume no model tokens. Health can
show `UsageTraceV2` totals and Atlas context estimates. Prompt text, code, diffs,
tool arguments, tool output and remote source bodies are never persisted.

## Accessibility and responsive behavior

Every evidence pane owns its scroll container, keyboard focus returns to the
active workspace after navigation, and controls expose labels independent of
icons. At narrow widths, navigation and inspectors collapse without hiding the
active evidence or requiring horizontal page scroll.
