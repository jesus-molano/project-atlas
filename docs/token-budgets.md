# Token budgets

Atlas is a map, not a context dump. Every Project Memory and task-context
response has a measured character hard cap.

## Defaults and guarantees

- default response budget: 3,600 characters, roughly 900 tokens;
- accepted range: 800–12,000 characters;
- small top-k results and opaque cursor pagination;
- no full database dump by default;
- no full SourceReceipt or persistent index in the default task bundle;
- no duplicated full JSON in MCP text and `structuredContent`;
- Design map/list/candidate queries use the same hard cap and group repeated
  findings before fitting the response;
- `get_reuse_context` returns at most five candidates and exposes their IDs for
  deliberate expansion;
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
    "expandableIds": ["decision-search-url-v2"],
    "retrieval": {
      "indexedBytesInjected": 0,
      "hits": 4,
      "misses": 1,
      "retries": 0,
      "connectorsQueried": ["openapi"],
      "receiptsExpanded": 0
    }
  }
}
```

`estimatedTokens` is deliberately conservative at four characters per token.
The serialized response is tested never to exceed `budgetChars`.

## Retrieval ladder

1. `orient_project`: counts, areas, sources, current decisions, and IDs.
2. `search_project_memory`: a few explainable summaries.
3. `get_memory_item`: expand one confirmed ID.
4. `get_task_context`: one shared budget across memory, code, design, and a
   bounded API operation subset; returns handles and receipt IDs.
5. `expand_source_receipt`: expand one immutable evidence receipt by ID.
6. `checkpoint_task`: persist one explicit semantic milestone under the stable
   task ID; never call it per action or by polling context percentage.
7. `resume_task_capsule`: rehydrate one strict task checkpoint after context
   compaction; expand its handles/receipt IDs separately.
8. `raw`/export: only when the user explicitly requests diagnostics.

Resume transport uses [TOON](https://github.com/toon-format/spec) only when the
official encoder/strict decoder round trip preserves the canonical JSON value
and produces fewer bytes. JSON remains the readable storage/fallback format,
but is never emitted alongside a successful TOON transport. TOON is not the
storage format or accepted without validation.

`get_task_context` preserves at least one relevant item from each available
source before trimming secondary results. Findings/questions outrank candidate
detail. Long evidence strings are shortened before the hard cap can be crossed.

The GUI browses large local indexes without token cost. Its context inspector
shows selected sources, characters/tokens, retrieval telemetry, receipt IDs,
and a progressively disclosed resume capsule before a handoff is copied to
Codex. Indexing cost is amortized in SQLite/local artifacts and is never
re-injected into each task.
