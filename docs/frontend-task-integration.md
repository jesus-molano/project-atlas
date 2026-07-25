# `frontend-task` integration

`skills/frontend-task` is the portable task orchestrator. Project Atlas
remains its local-code and cached-design context engine.
This flow composes installed capabilities; Project Atlas itself is not packaged
as a Codex plugin in this phase.

## Adaptive sequence

1. Detect whichever sources are actually available. Repository and conversation
   form the baseline; Jira, Confluence, Figma, screenshots, and pasted
   requirements are optional.
2. Classify relevant sources as required, recommended, optional, unavailable,
   or not applicable. Report the cheap precheck before deep retrieval.
3. Build the minimal brief from
   `skills/frontend-task/references/brief-contract.md`.
4. Ask only questions that can change behavior, ownership, accessibility,
   architecture, design target, or component strategy. Every question includes
   evidence and a recommendation.
5. Use the native `request_user_input` selector when available for a material
   missing source (one question by default, three maximum). Otherwise ask one
   brief chat question. Do not build a separate form.
6. Reduce the brief to one implementation intent.
7. Call `scan_repository` and one budgeted `get_task_context`. This composes the
   most relevant memory, code, and cached-design signals under a shared cap.
8. If a concrete Figma node is confirmed, use it directly. If only a file/page
   exists, map sparse metadata and call `find_design_candidates`.
9. Treat Ready for dev as a ranking boost, never a filter or prerequisite.
   Treat `source-unavailable` as a connector limitation, not a missing state.
10. Stop for `decision-required`, surface `warning` with its recommendation, and
   retain `resolved` findings without interrupting the user.
11. After node confirmation, narrow a large frame to the smallest relevant
   subtree before deep context. Retrieve screenshot and exact variables for the
   same target; ask for a manual selection if it cannot be isolated.
12. Run `check_before_change`, record the component decision, implement,
    validate, and rescan.
13. Record the observed/verified outcome. Propose any durable memory delta;
    apply it only after explicit confirmation.

Focused Atlas queries remain compact. The retrieval ladder is orientation,
search, then expansion of a confirmed ID. The orchestrator requests `raw` nodes
only when diagnosing incorrect extraction.

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

The Figma handoff is also portable. The agent owns its approved Figma
connection; Atlas accepts sparse metadata and serves cached queries. Missing
Figma, Ready for dev, global Variables access, Code Connect, Jira, or Confluence
degrades to repository plus conversation.

## Test matrix

`fixtures/frontend-task/cases.json` describes the portable source combinations.
`fixtures/figma/personal-no-dev-mode.xml` and the design-package tests prove that
a file with zero Ready for dev nodes still yields semantic and device-specific
candidates.

## Distribution

`frontend-codex-kit/install.ps1` links the same skill source into the personal
skill directories used by Codex and Claude Code, builds the Atlas MCP, and
registers it without credentials. The installer can be run in dry-run mode and
refuses to overwrite conflicting skill folders.
