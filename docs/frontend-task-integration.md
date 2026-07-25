# Future `frontend-task` integration

`frontend-task` should orchestrate task sources and use Component Atlas as its
local-code context engine.

## Portable sequence

1. Collect whichever sources are available: pasted requirements, Jira,
   Confluence, Figma nodes, screenshots, or repository instructions.
2. Build a minimal brief and ask only questions that can change behavior,
   ownership, design target, or component strategy.
3. Reduce the result to one implementation intent.
4. Call `scan_repository` for the target repository.
5. Call `get_reuse_context` once with that intent.
6. If Figma exists, use a confirmed node directly or call
   `find_design_candidates` against an existing Design Index. Do not require
   Figma when the task does not provide it.
7. Stop for a `decision-required` finding, surface `warning` findings with a
   recommendation, and retain `resolved` findings without interrupting the
   user.
8. Only after node confirmation, request `get_design_context`,
   `get_screenshot`, and exact selection variables.
9. Record the component decision, implement, validate, and rescan.

Focused queries remain compact by default. The orchestrator should never request
`raw` Atlas nodes unless it is explicitly diagnosing index extraction.

The skill must feature-detect sources. Missing Jira, Figma, or Confluence access
must not block repository analysis, and Atlas must never invent external context.

## Stable Atlas handoff

Input:

```json
{
  "root_path": "C:/absolute/repository",
  "intent": "destructive confirmation dialog with async pending state",
  "limit": 5
}
```

Output: the `ReuseContextBundle` JSON contract documented in
`docs/architecture.md`. This contract is deliberately independent from Codex,
Claude, and any specific task-source connector.

The Figma handoff is likewise portable: the parent skill orchestrates the Figma
connector when present, while Atlas only accepts sparse metadata and serves
cached queries. Missing Figma, file-level Variables access, Code Connect, Jira,
or Confluence must degrade to repository plus conversation.
