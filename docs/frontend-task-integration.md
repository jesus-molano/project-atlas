# Future `frontend-task` integration

`frontend-task` should orchestrate task sources and use Component Atlas as its
local-code context engine.

## Portable sequence

1. Collect whichever sources are available: pasted requirements, Jira,
   Confluence, Figma nodes, screenshots, or repository instructions.
2. Interrogate missing behavior and acceptance criteria.
3. Reduce the result to one implementation intent.
4. Call `scan_repository` for the target repository.
5. Call `get_reuse_context` once with that intent.
6. Use focused Atlas tools only when a candidate, ownership boundary, or API
   change remains ambiguous.
7. Record the component decision, implement, validate, and rescan.

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
