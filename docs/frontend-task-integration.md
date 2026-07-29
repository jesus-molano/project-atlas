# `frontend-task` integration

`skills/frontend-task` is the portable task orchestrator. Project Atlas
remains its local-code and cached-design context engine.
This flow composes installed capabilities; Project Atlas itself is not packaged
as a Codex plugin in this phase.

The normal user action is:

```text
/plan $frontend-task Prepara e implementa esta tarea: <description>
```

No manual scan, memory, context, or Figma command is required first.

## Adaptive sequence

1. Detect whichever sources are actually available. Repository and conversation
   form the baseline; Jira, Confluence, Figma, Swagger/OpenAPI, screenshots, and
   pasted requirements may add evidence.
2. Classify relevant sources as required, recommended, optional, unavailable,
   or not applicable. Report the cheap precheck before deep retrieval.
3. For every new high-risk task, pause during preparation before repository
   investigation or external retrieval and ask one grouped confirmation for
   Jira, Confluence, Figma, and Swagger/OpenAPI, even when no links or
   connectors were detected. Each source can be confirmed, supplied/replaced,
   or explicitly omitted. Do not probe connectors first. An omitted optional
   source does not block; a required API contract remains blocking.
4. Treat earlier flows, components, or implementations as reuse evidence. Use
   continuation mode only when the user unequivocally resumes the same task.
5. Build the minimal brief from
   `skills/frontend-task/references/brief-contract.md`.
6. Ask only questions that can change behavior, ownership, accessibility,
   architecture, design target, or component strategy. Every question includes
   evidence and a recommendation.
   Authentication, biometrics, privacy/data, permissions, destructive,
   financial, and accessibility-critical tasks always require a current-turn
   planning checkpoint before implementation. If their material decisions are
   resolved, ask for explicit confirmation to proceed. Earlier conversation
   and source URLs do not silently satisfy the checkpoint.
7. Use the native `request_user_input` selector when available for the grouped
   high-risk intake or another material missing source (one question by
   default, three maximum). Otherwise ask one brief chat question. Do not build
   a separate form.
8. Reduce the brief to one implementation intent.
9. Call `scan_repository` and one budgeted `get_task_context`. This composes the
   most relevant memory, code, and cached-design signals under a shared cap.
10. At the start of preparation, ingest every confirmed Figma reference into
   Design Atlas: retrieve sparse metadata and call `map_figma_file`, including
   for a concrete node. A concrete node skips candidate ranking; a file/page
   continues with `find_design_candidates`. Refresh the task/design snapshot so
   persisted nodes are visible before code work or task completion. Use the
   Figma Desktop MCP at `http://127.0.0.1:3845/mcp` first for every context
   read and operation it exposes. Do not choose a global MCP registration or
   remote connector first while the local server is connected, responsive,
   authorized, and supports the operation. Codex/Figma skills provide
   instructions or mandatory prerequisites, not a replacement route. Use
   another connector, manual selection, or alternative evidence only when the
   local MCP is not connected, rejects/times out, does not respond, is
   unauthorized, or lacks the operation, and briefly state the fallback
   reason. Never probe it before source confirmation, and surface loading,
   available, confirmed-unsynchronized, or access/sync-error state instead of
   an unexplained empty design view.
11. Treat Ready for dev as a ranking boost, never a filter or prerequisite.
   Treat `source-unavailable` as a connector limitation, not a missing state.
12. Stop for `decision-required`, surface `warning` with its recommendation, and
   retain `resolved` findings without interrupting the user.
    Medium-risk work also stops when sources conflict, persistence/cancel
    semantics are unclear, states are missing, the target is uncertain, or a
    shared API changes. Group one question by default and no more than three.
13. After node confirmation, preinspect `get_metadata` or the available sparse
   hierarchy before full design context. Read a small bounded node directly
   with the standard timeout. For a large page/frame, segment from the outset
   by relevant sections, frames, or children and retrieve incrementally.
   Following a timeout, narrow the scope instead of repeating the same request
   with a larger timeout. If a full-page read still exceeds limits, fails, or
   times out, preserve the original page link, obtain an available lightweight
   screenshot/summary plus economical hierarchy/IDs, and retrieve related
   groups in small adaptive batches. Record covered and remaining scopes so
   successful batches are not repeated. Retrieve screenshots and exact
   variables only for useful bounded targets. If no metadata or overview is
   available, document the limitation and ask for a narrower link, manual
   selection, screenshot, or export.
14. Run `check_before_change`, record the component decision, implement,
    validate, and rescan.
15. Always return a compact `Memory candidates` closeout: `none`,
    `canonical-candidate`, `canonical-stored`, `local-only`, or `declined`.
    A canonical candidate includes evidence, scope, confidence, and one exact
    confirmation question. Local-only outcomes and empty closeouts do not ask
    for promotion. Do not record an outcome, create a proposal, or apply memory
    until the user explicitly authorizes that exact write.

`memoryCloseout` in `AgentCompactResult` is the single domain contract.
`$frontend-task`/Codex produces it once; conversation formats it as a compact
section and the GUI only renders that same object. The GUI does not run a
second candidate detector, state transition, or approval path.

Focused Atlas queries remain compact. The retrieval ladder is orientation,
search, then expansion of a confirmed ID. The orchestrator requests `raw` nodes
only when diagnosing incorrect extraction.

Invoking the skill authorizes this task-scoped orchestration. It does not
authorize plugin installation, connector login, access to an unconnected
source, external writes, or any local/canonical memory write. Task completion
and implementation approval do not count as memory confirmation.

## Stable Atlas handoff

Input:

```json
{
  "root_path": "C:/absolute/repository",
  "intent": "destructive confirmation dialog with async pending state",
  "limit": 5
}
```

Output: a hard-capped Project Atlas bundle with relevant memory, code
candidates, optional design candidates, findings, uncertainty gate, next
actions, and size metrics. It is independent from Codex, Claude, and
task-source connectors.

`get_reuse_context` accepts at most five candidates in CLI and MCP. Larger
limits fail clearly rather than being silently accepted or clamped. When the
budget trims candidate detail, metrics report truncation and preserve component
IDs for focused expansion.

The Figma handoff is also portable. The agent owns its approved Figma
connection; Atlas accepts sparse metadata and serves cached queries. Missing
Figma, Ready for dev, global Variables access, Code Connect, Jira, or Confluence
degrades to repository plus conversation.

## Test matrix

`fixtures/frontend-task/cases.json` describes 21 portable source combinations,
including new high-risk biometrics with a prior-flow reuse reference and no
links, plus a required Swagger/OpenAPI contract that has not yet been supplied.
`fixtures/figma/personal-no-dev-mode.xml` and the design-package tests prove that
a file with zero Ready for dev nodes still yields semantic and device-specific
candidates.

## Distribution

`frontend-codex-kit/install.ps1` links the same skill source into the personal
skill directories used by Codex and Claude Code, builds the Atlas MCP, and
registers it without credentials. The installer can be run in dry-run mode and
refuses to overwrite conflicting skill folders.
