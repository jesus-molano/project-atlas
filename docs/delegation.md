# Optional retrieval delegation

Project Atlas does not recommend subagents by default. Delegation is an
optional context-pressure control, not a source-discovery or implementation
strategy.

## Activation gate

All conditions are required:

1. the user or host explicitly allows delegation;
2. source confirmation, authority, and immutable scope are already resolved by
   the coordinator;
3. at least two independent retrieval domains each exceed 6,000 estimated raw
   characters, or one domain exceeds 24,000 while coordinator context is under
   12,000 characters;
4. compact results save at least 8,000 coordinator characters;
5. each result fits an 800–4,000 character domain budget.

The plan reports both costs:

- coordinator cost without delegation: raw evidence it would otherwise ingest;
- coordinator cost with delegation: compact result injection;
- total work cost: raw delegate reads + compact results + 900 characters of
  coordination overhead per delegate.

Delegation usually increases total work. It activates only when that extra work
materially lowers coordinator-context pressure. At most two delegates run
concurrently.

## Authority boundary

The coordinator retains source confirmation, authority/contradiction
resolution, scope decisions, provider-fallback permission, and the only
implementation. Delegates are read-only retrieval workers. They receive only
confirmed source-decision IDs, the ledger primary adapter, immutable scope, and
an output budget. A failure returns a compact blocker. It never triggers a
browser, Chrome, web, remote Figma, or other provider fallback.

If delegation is unavailable or not cost-effective, the coordinator performs
the same confirmed-route retrieval within the existing task budget.

## Output contracts

| Domain | Compact output | Hard omissions |
| --- | --- | --- |
| Figma | file/confirmed/selected scope IDs, bounded states, overlays, viewport evidence, asset handles/hash/format/size, receipt IDs, Code Connect availability | metadata XML, design-context body, screenshots, SVG/binary bodies, localhost asset URLs |
| Jira + Confluence | bounded requirement statements with source-decision IDs, contradictions, versions, receipt IDs | page/issue bodies, search dumps, browser output |
| Swagger/OpenAPI | confirmed contract identity, at most six relevant operations, type names, error statuses, auth summary, derivation receipt | UI HTML/JS, config/spec bodies, cross-origin substitution |
| Code/Backoffice | one ChangeSurface, primary/files, at most two reference-only IDs, exclusions, reuse decision | file bodies, repository dumps, implementation edits |

Every result declares `rawBodiesIncluded: false`, stays under its job budget,
and is checked recursively. Atlas rejects fields such as `raw`, `body`,
`content`, `document`, `html`, `xml`, `svg`, `blob`, Base64, metadata XML,
OpenAPI bodies, code dumps, `data:` URLs, and Desktop localhost endpoints. The
coordinator receives only validated compact JSON; omitted bodies are never
reinserted after delegation or context compaction.

`metrics.outputChars` is reproducible: it is the serialized result length with
that numeric field set to `0`, avoiding a self-referential size calculation.
