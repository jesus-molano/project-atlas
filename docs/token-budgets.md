# Token budgets

Atlas is a map, not a context dump. Every Project Memory and task-context
response has a measured character hard cap.

## Defaults and guarantees

- default response budget: 3,600 characters, roughly 900 tokens;
- accepted range: 800–12,000 characters;
- small top-k results and opaque cursor pagination;
- no full database dump by default;
- no duplicated full JSON in MCP text and `structuredContent`;
- explicit `raw` remains a diagnostic action for older Code Atlas queries.

Every compact response reports:

```json
{
  "metrics": {
    "budgetChars": 3600,
    "usedChars": 2471,
    "estimatedTokens": 618,
    "truncated": false,
    "totalMatches": 9,
    "nextCursor": "optional",
    "expandableIds": ["decision-search-url-v2"]
  }
}
```

`estimatedTokens` is deliberately conservative at four characters per token.
The serialized response is tested never to exceed `budgetChars`.

## Retrieval ladder

1. `orient_project`: counts, areas, sources, current decisions, and IDs.
2. `search_project_memory`: a few explainable summaries.
3. `get_memory_item`: expand one confirmed ID.
4. `get_task_context`: one shared budget across memory, code, and design.
5. `raw`/export: only when the user explicitly requests diagnostics.

`get_task_context` preserves at least one relevant item from each available
source before trimming secondary results. Findings/questions outrank candidate
detail. Long evidence strings are shortened before the hard cap can be crossed.

The future GUI may browse large local indexes without token cost. Its Context
Inspector must show selected sources, estimated characters/tokens, hard cap,
and truncation before a package can be copied or sent to an agent.
