# Figma Design Index

The Design Index gives agents orientation without placing an entire Figma file
in the conversation. It is a read-only, sparse local cache beside the code
graph and does not replace Figma.

In normal use, `$frontend-task` chooses the direct or general route when Figma
is relevant. The user supplies a link/selection or confirms a ranked candidate;
no Design Atlas CLI bootstrap is required.

## Two routes

Direct route:

1. The user provides or selects one concrete frame or component.
2. At the start of preparation, read sparse metadata for the confirmed scope
   through the confirmed Figma route. Pass the exact file/node identity and
   bounded metadata to `atlas_prepare_task` as one confirmed `figma` source
   with its actual adapter, route, operation, scope, observation, hash, and
   freshness. Atlas validates the evidence and creates an immutable
   SourceReceipt bound to the stable task/source decision.
   A direct link skips candidate ranking, not Design Atlas persistence.
   `fileKey+nodeId` remains an immutable pin: a missing, mismatched, or stale
   node blocks and Atlas never substitutes a ranked candidate.
3. Use the returned `design:` handle directly or expand exactly that handle
   with `atlas_expand_context`; never call a legacy design tool from the core
   workflow.
4. Always use `get_metadata` or the available sparse hierarchy to estimate
   complexity before full context. A shallow bounded component/frame is small;
   a broad page, large screen, deep tree, or many sibling sections/frames is
   large. No exact size-estimation API is assumed.
5. For a small target, retrieve `get_design_context` with the standard client
   timeout. For a large target, use sparse child metadata to segment from the
   outset by task-relevant sections, frames, or children, then retrieve one
   bounded subtree at a time. The outer frame is orientation, not the default
   deep-context target.
6. On timeout, keep successful chunks and narrow the remaining scope. Never
   repeat the identical request with a larger timeout.
7. If a full-page read exceeds limits, fails, or times out, preserve the page
   URL/file/node identity and obtain a lightweight overview:
   `get_screenshot` for the page/frame when available, or a supplied
   screenshot/cached Atlas summary. Pair it with economical `get_metadata`
   hierarchy/IDs. A cached `design:` expansion can supplement this only when
   the scope already exists in Design Atlas.
8. Group relevant components, related siblings, or flow/viewport families in
   small adaptive batches. Keep successful batches, shrink the next batch
   after an oversized response, and track covered/remaining scope IDs. The
   workflow need not fall back immediately to one request per node.
9. Retrieve detailed screenshots only for useful bounded targets.
   Use expanded file-global Variables when available. `get_variable_defs` is
   only a node/selection fallback when the audited state is `selection-only`.
10. Reserve the response budget for the target. Shell, navigation, repeated
   assets, and peripheral siblings are omitted first. If the target cannot be
   isolated, ask for a manual selection instead of silently accepting a
   truncated response.
11. If neither sparse metadata nor an overview is available, retain the page
    reference, document the missing evidence, and ask for a narrower link,
    manual selection, screenshot, or export. Do not invent hierarchy.
12. Combine the result with Atlas component context before implementation.

General route:

1. The user provides a Figma file or page.
2. Use the local Desktop MCP first. Call Figma `get_metadata` without a node ID
   to discover pages.
3. Retrieve sparse XML only for relevant pages and pass each bounded snapshot
   as confirmed Figma evidence to `atlas_prepare_task`. Repeated snapshots merge
   by page/scope behind the same evidence version.
4. Use the few ranked design candidates and `design:` handles returned by
   `atlas_prepare_task`; expand only a candidate that can change the decision.
   These are explicitly Atlas candidates, never claims that they match a
   user-confirmed direct node.
5. Confirm one node before following the direct route.

If the local Desktop MCP is not connected, rejects/times out, does not respond,
is unauthorized, or lacks the required operation, another connector or
supplied evidence may be considered only when the task ledger explicitly
allows that adapter. `ask` records a decision still needed; it is not fallback
authorization. A healthy local server is never bypassed in favor of a global
MCP registration or remote connector.

The REST alternative is a file response limited with `depth=2`; it includes
pages and their top-level objects plus file `version` and `lastModified`.
The endpoint requires Figma `file_content:read`. Atlas accepts this JSON but
never requests or stores the access token.

## Inputs and cache behavior

The core `atlas_prepare_task` Figma evidence accepts:

- the confirmed Figma URL/file key and exact node when known;
- Figma MCP `get_metadata` XML or REST file JSON;
- at most 2 MB of UTF-8 metadata per task evidence payload, whether supplied as
  text or structured JSON;
- the actual adapter, route, operation, observation time, content hash,
  freshness, scope, and optional file version/modification date;
- optional parent page ID/name for section or frame-only snapshots;
- optional enrichment for dev status/resources, libraries, and Code Connect.

Authoritative ingestion always carries the stable task/source decision identity.
The caller-provided URL may identify a selected child scope, while
`requested`/`resolved` retain the immutable confirmed page or parent identity.
Atlas validates and records `scopeRelation: contained-scope`; it does not turn
the child into a replacement source. A separate task relation can connect
Jira/Confluence requirement authority to the selected Figma scope without
confusing either source's identity or provenance.

Variables can arrive with the source evidence. File-global variable sync remains
an explicit CLI/GUI or legacy-profile administration operation outside the six
core task tools. This prevents an unchanged sparse metadata hash from hiding a
Variables update and lets Atlas record access/permission changes without
remapping nodes.

The cache lives in the repository's Atlas SQLite database under local
application data. An identical source/scope hash returns `unchanged`. New page
snapshots merge into the same version. A different `version` or `lastModified`
starts a fresh map so nodes removed from Figma do not remain indefinitely.
The local workspace refreshes its snapshot while confirmed Figma ingestion
runs, so the Design view can show the persisted map before code components are
created or the native task completes. It reports loading, available,
confirmed-but-unsynchronized, and access/sync-error states explicitly.

The stored node model is deliberately sparse: ID, URL, name, type, page,
breadcrumbs, dimensions, Ready for dev/Completed state, change description,
annotations, resource links, component and variant names, and optional code
connections. Screenshots, generated code, style dumps, and full vector trees
are excluded. Session-local asset URLs such as `localhost` resources are also
excluded because they cannot be resolved durably; Atlas keeps the file/node ID
and resolves relevant assets on demand. Selected assets use a separate bounded
pipeline: Desktop MCP bytes are validated and stored only under
`<platform Atlas storage root>/temp/assets/` behind an expiring handle containing
checkout-bound hash, format, size, selected scope, and receipt provenance.
The handle digest binds checkout identity and content, so a capture from one
worktree cannot be materialized from another. Neither response
bodies nor localhost URLs enter context, ledgers, capsules, or code. An
explicit materialization step may write one validated new production asset
inside the checkout; it refuses overwrite, path escape, unsafe SVG content,
format mismatch, tampering, and expired handles. Its temporary SVG/binary body
is deleted immediately after a successful write; bounded metadata remains
expandable only until task completion, when Atlas removes every v2 asset owned
by that checkout. Legacy metadata remains readable for TTL cleanup but must be
recaptured before authoritative use.

The six-tool core profile exposes this pipeline through two discriminated
`atlas_task_state` actions. `capture-figma-asset` runs while the task is being
prepared and requires a current, exact Figma Desktop MCP `SourceReceipt` from
that task ledger. It returns only expiring `figma-asset:` metadata, checkpoints
the handle, and never transports the body or localhost URL. The handle can be
inspected with `atlas_expand_context` using the same `task_id`. After
`atlas_lock_change_scope` freezes both that handle and its production path,
`materialize-figma-asset` writes only when the immutable ChangeSurface v2 is
active, non-invalidated, and its `allowedFiles` contains that exact normalized
destination. Authorization is checked against the complete task source ledger
and its frozen hash/counts, not only the four receipt IDs projected into the
compact lock. Materialization is intentionally unavailable after validation;
capture, lock, materialize, and validate remain a monotonic sequence.
The compact ChangeSurface stores at most eight evidence handles total,
prioritizing the exact `visual:` contract and Figma assets over code/context
references. A common Jira-sized task can therefore freeze one visual contract
plus several individual assets, including an asset captured during an explicit
relock window. The complete lock remains inside its 12 KB immutable-artifact
limit, while the active capsule carries only its reference inside 4 KB.
Larger export sets or unusually long task identities still require an explicit
batch (or a future content-addressed asset-manifest handle) rather than silent
evidence loss.

## Ready for Dev provenance

Dev status is stored independently for pages, sections, frames, flows, and
components whenever the source exposes it. REST metadata is status-capable;
MCP sparse XML is treated as status-capable only when it contains the field or
the caller supplies a status enrichment. Reindexing an unchanged file does not
replace an observed status with an unknown value from a weaker source.

Atlas distinguishes:

- `observed`: a status-capable source exposed Ready for Dev or Completed;
- `user-confirmed`: a human confirmed the status while the connector could not
  expose it; this is explicit lower-authority provenance, not an inferred fact;
- `absent`: a status-capable source explicitly exposed no dev status;
- `available`: this source can establish Ready for Dev, Completed, or no state;
- `partial`: some cached scopes have observable status and others do not;
- `source-unavailable`: the connector did not expose the field.

`source-unavailable` never means that the node has no Figma status. Queries and
the GUI state this limitation explicitly and recommend a status-capable source
or direct verification. A page-level Ready for Dev signal also contributes a
smaller ranking boost to its child candidates.

## Ranking and confirmation

Task matching is explainable rather than authoritative. It scores:

- task terms and bilingual semantic aliases against page, section, and frame
  names;
- Ready for dev descriptions and annotations;
- linked resources and contained components/variants;
- mobile/desktop and shared-library intent;
- optional Code Connect evidence;
- nearest component names from the local Atlas graph.

Ready for dev contributes a small boost and can break an otherwise close tie.
It is never an eligibility filter. A file with no Dev Mode statuses follows the
same ranking path using names, hierarchy, annotations, links, contained
components/variants, device context, and Atlas signals.

Related frame dimensions are grouped as viewport families. Multiple wide
frames do not prove mobile/tablet coverage; Atlas warns when no small
breakpoint is evidenced and never invents it. Sibling storyboard frames can be
summarized as a flow family with observed and not-evidenced states, rather than
being reported as duplicate components. Suspicious naming is surfaced for
source confirmation without silently changing product copy.

Repeated findings are grouped by rule and design family. Compact responses
return an occurrence count, at most three evidence examples, at most eight node
handles, and a truncation marker. Storyboard states remain one flow coverage
matrix instead of being elevated as component duplicates.

`atlas_prepare_task` shares its hard 3,600-character task budget across code,
design, receipts, and allowed memory, and exposes metrics plus expandable IDs
when secondary evidence is trimmed. Legacy/CLI design diagnostics retain their
own explicit response budgets outside the normal skill route.

Results include reasons and confidence. A high score is still a proposal, not
permission to fetch deep context. The decision gate asks for confirmation or a
choice with evidence. A direct node link already supplies that decision.

## Decision and uncertainty gate

Findings have three levels:

1. `decision-required`: block deep retrieval when there is no match, the target
   is ambiguous, or task/design/code sources contradict each other. The question
   always includes evidence and a recommended choice.
2. `warning`: continue while surfacing possible duplicate frames, inconsistent
   device/state variants, Ready for dev work without exposed states, or a
   Figma/code mismatch. Atlas can also flag an existing component with a broad
   or boolean-heavy API before another prop is added. The finding explains how
   to verify it.
3. `resolved`: keep low-impact fallbacks in the result without interrupting the
   user. For example, `selection-only` allows `get_variable_defs` for a
   confirmed node, while explicitly stating that it is not the global catalog.

This gate is shared by `frontend-task`. It does not turn every uncertainty into
a question.

## Global Variables and modes

The model supports a bounded file-level catalog:

- collection ID and name;
- modes such as Light/Dark;
- variable count and resolved types;
- local or remote origin in an explicitly expanded result;
- exact colors, scalars, strings, booleans, aliases, and values by mode only
  when the authorized source returned them.

The normal sync and query expose collections, modes, counts, and types—not every
variable. Persistence is catalog-only by default. A caller must explicitly
request `expanded` detail before names/types/origins/scopes are retained, and
must separately mark exact values as included before Atlas retains values or
aliases. Queries also omit persisted values unless `include_values` is
explicitly requested. Inputs and responses have collection, variable, mode,
value, and character-budget limits with truncation flags.

Atlas audits four access states:

- `global`: a confirmed file-global source returned the catalog;
- `selection-only`: `get_variable_defs` is available for a concrete node or
  selection, but no global catalog is available;
- `permission-required`: the global read was denied by authorization, plan, or
  account policy;
- `unavailable`: no confirmed global read was exposed.

`selection-only`, `permission-required`, and `unavailable` never mean that the
file has no variables. A selection result is discarded from the global catalog
shape, even if it happens to contain token names and values.

As of this implementation, the documented Figma Desktop MCP tools include
`get_variable_defs` for variables used by a selection/node, but no documented
file-global Variables enumeration tool. Atlas therefore does not claim a
Desktop-global read. It can accept one only if a future active Desktop MCP
explicitly advertises and successfully returns that scope. The current Plugin
API methods that enumerate local collections/variables are available through
Figma's remote `use_figma` path, not the documented Desktop path, so they are
not relabeled as Desktop evidence.

The Figma `GET /v1/files/:file_key/variables/local` endpoint is currently
Enterprise-gated, requires an eligible organization member/seat, view access to
the file, and the `file_variables:read` scope. Corporate policy can still deny
it. A caller may submit its authorized response as `figma-variables-rest`;
Atlas never receives or persists the token. Atlas never requests
`file_variables:write` and never creates, edits, or publishes Figma variables.

## Task semantic snapshots

The Design Index is reusable orientation data. A task that depends on final
Figma fidelity also records a separate, immutable semantic snapshot through
`atlas_task_state`: the exact receipt-bound
`fileKey`/`nodeId`/`version`/`lastModified` identity, plus bounded nodes,
components, styles, states and asset references. It never stores raw MCP
responses, XML, SVG, binary bytes, localhost URLs, or tokens.

The snapshot states what was covered or omitted. It is not a claim that an
unread Figma subtree was inspected. If the confirmed receipt, any exact identity
field, or required scoped semantic content changes, the prior snapshot is stale
for final use and the workflow records a linked successor. Context receives its
opaque handle and expands it only when that exact design decision needs detail.

## Optional evidence

Code Connect mappings improve Figma-to-code evidence through component name and
source path, but remain optional. Libraries and file dev resources are also
optional enrichments. A missing integration lowers confidence; it does not
block repository analysis or cause Atlas to invent a relationship. Without
Code Connect, Atlas still crosses semantic task terms with component names,
paths, rendered children, imports/composables, tests, and graph consumers, and
reports the resulting confidence. The inspection contract exposes missing Code
Connect only as `optionalEnrichmentTools`; it is never a required/recommended
step, never pauses fidelity, and never asks the user to map components first.

## Advanced CLI diagnostics

These commands are optional tools for explicit cache bootstrap, diagnostics,
or automation. They are not required before invoking `$frontend-task`.

```powershell
pnpm atlas:cli -- figma map <root> <figma-url> `
  --metadata <xml-or-json-file> `
  [--format auto|figma-mcp-xml|figma-rest] `
  [--file-version <version>] `
  [--last-modified <timestamp>] `
  [--scope-node <id>] `
  [--scope-page-id <id> --scope-page-name <name>] `
  [--enrichment <json-file>]

pnpm atlas:cli -- figma list <root>
pnpm atlas:cli -- figma find <root> <task> [--file <url-or-key>]
pnpm atlas:cli -- figma inspect <root> <url-or-key> <confirmed-node>
```

The legacy profile also exposes `map_figma_file`, `sync_figma_variables`,
`get_figma_variables`, `list_figma_indexes`, `find_design_candidates`, and
`inspect_design_node` temporarily for parity/migration. They are not available
in the installed core profile and must not appear in `$frontend-task` calls.

## Validation boundary

Synthetic fixtures validate REST and MCP XML normalization, incremental cache
behavior, Ready for dev as an optional boost, ranking with zero Ready nodes,
mobile/desktop ranking, Code Connect evidence, all four Variables access
states, bounded catalog/expanded persistence, exact color and alias
normalization, MCP synchronization, and confirmed-node handoff. No test uses a
real token or team file. Live validation of a future Desktop-global operation
is deliberately deferred until Figma exposes and documents such an operation.

## Figma references

- [MCP tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Plugin API variable reads](https://developers.figma.com/docs/plugins/working-with-variables/)
- [REST file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
- [Variables REST endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints/)
