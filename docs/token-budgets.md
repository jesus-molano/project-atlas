# Token budgets

Atlas is a map, not a context dump. Every Project Memory and task-context
response has a measured character hard cap.

## Defaults and guarantees

- default response budget: 3,600 characters, roughly 900 tokens;
- accepted range: 800 to 12,000 characters;
- small top-k results and opaque cursor pagination;
- no full database dump by default;
- no full SourceReceipt or persistent index in the default task bundle;
- no duplicated full JSON in MCP text and `structuredContent`;
- Design map/list/candidate queries use the same hard cap and group repeated
  findings before fitting the response;
- `atlas_prepare_task` groups broad code candidates by feature area, returns a
  compact area summary plus at most five candidates, and keeps full details
  behind opaque handles for deliberate expansion;
- `atlas_lock_change_scope` returns one primary component, at most two
  reference-only components, twelve bounded file entries, compact API/impact,
  the persisted reuse decision, and explicit exclusions under a
  2,800-character default;
- one stable task permits an initial reuse retrieval and one bounded re-ranking
  as its objective becomes precise. A later retrieval requires an explicit
  graph, scope, source-ledger, or user-requested invalidation; otherwise prepare
  returns a low-risk continuation using existing context so the lock remains
  available;
- ChangeSurface retains at most eight prioritized evidence handles total;
  evidence contracts and visual/Figma evidence precede code/context references, only
  asset metadata enters context, and SVG/binary bodies never do;
- optional delegation admits at most two concurrent read-only jobs, each with
  an 800 to 4,000 character result; combined coordinator injection is capped at
  8,000 characters and recursively rejects raw bodies;
- raw/bulk diagnostics remain outside the six-tool core in the CLI/GUI or
  temporary legacy profile.

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

1. `atlas_prepare_task`: one shared budget across code, design, approved memory,
   source receipts and a bounded API operation subset. Call it only after source
   preflight is resolved.
2. `atlas_expand_context`: expand one named code, design, memory, relation, or
   receipt handle in concise form first; request detail only when necessary.
3. Decide reuse from that bounded evidence.
4. `atlas_lock_change_scope`: persist the decision, primary code path,
   reference-only examples, exact allowed files, derived APIs/impact, and
   exclusions before editing.
5. `atlas_validate_change`: compare the local diff with that lock and return
   only evidence-backed findings.
6. `atlas_task_state`: record the medium/large evidence contract, persist a
   semantic continuation checkpoint, semantic Figma snapshot, rehydrate via
   `resume`, or mark technical `complete`; never call it per action or based on
   a context percentage.
7. `atlas_memory`: review one exact proposal or perform one consent-bound
   mutation after technical close or an explicit standalone memory request.
8. CLI/GUI diagnostics or legacy export: only when explicitly requested; they
   are not part of the normal agent context ladder.

Resume transport uses [TOON](https://github.com/toon-format/spec) only when the
official encoder/strict decoder round trip preserves the canonical JSON value
and produces fewer bytes. JSON remains the readable storage/fallback format,
but is never emitted alongside a successful TOON transport. TOON is not the
storage format or accepted without validation.

`atlas_prepare_task` preserves at least one relevant item from each confirmed,
available source before trimming secondary results. Findings/questions outrank
candidate detail. Long evidence strings are shortened before the hard cap can
be crossed.

The GUI browses large local indexes without token cost. Its context inspector
shows selected sources, characters/tokens, retrieval telemetry, receipt IDs,
and a progressively disclosed resume capsule before a handoff is copied to
Codex. Indexing cost is amortized in SQLite/local artifacts and is never
re-injected into each task.

Contracts, continuations and Figma snapshots are stored outside the normal
prompt budget. The workflow receives opaque handles and expands only the item
needed for the next decision. This preserves recovery context across host
compaction without treating storage as an unlimited prompt cache.
