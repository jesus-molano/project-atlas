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
   through Figma Desktop MCP and pass it to `map_figma_file`. A direct link
   skips candidate ranking, not Design Atlas persistence.
3. If the node is cached, call `inspect_design_node`; otherwise use the
   just-mapped node identity.
4. If it is a large screen/frame, use its sparse child metadata to identify the
   smallest task-relevant subtree. The outer frame is orientation, not the
   default deep-context target.
5. Retrieve `get_design_context` and `get_screenshot` only for that subtree.
   Use expanded file-global Variables when available. `get_variable_defs` is
   only a node/selection fallback when the audited state is `selection-only`.
6. Reserve the response budget for the target. Shell, navigation, repeated
   assets, and peripheral siblings are omitted first. If the target cannot be
   isolated, ask for a manual selection instead of silently accepting a
   truncated response.
7. Combine the result with Atlas component context before implementation.

General route:

1. The user provides a Figma file or page.
2. Call Figma `get_metadata` without a node ID to discover pages.
3. Retrieve sparse XML only for relevant pages and pass each snapshot to
   `map_figma_file`. Repeated snapshots merge by page/scope.
4. Call `find_design_candidates` with the task. It returns a few candidates,
   evidence, confidence, findings, and a decision gate.
5. Confirm one node before following the direct route.

The REST alternative is a file response limited with `depth=2`; it includes
pages and their top-level objects plus file `version` and `lastModified`.
The endpoint requires Figma `file_content:read`. Atlas accepts this JSON but
never requests or stores the access token.

## Inputs and cache behavior

`map_figma_file` accepts:

- a Figma URL or file key;
- Figma MCP `get_metadata` XML or REST file JSON;
- optional file version, modification date, and scope node;
- optional parent page ID/name for section or frame-only snapshots;
- optional enrichment for dev status/resources, libraries, and Code Connect.

Variables can arrive with the initial map for backwards compatibility, but the
normal route is the independent `sync_figma_variables` operation. This prevents
an unchanged sparse metadata hash from hiding a Variables update and lets Atlas
record access/permission changes without remapping nodes.

The cache lives in the repository's Atlas SQLite database under local
application data. An identical source/scope hash returns `unchanged`. New page
snapshots merge into the same version. A different `version` or `lastModified`
starts a fresh map so nodes removed from Figma do not remain indefinitely.
The Task Workbench refreshes the workspace snapshot while confirmed Figma
ingestion runs, so the Design view can show the persisted map before code
components are created or the task completes. It reports loading, available,
confirmed-but-unsynchronized, and access/sync-error states explicitly.

The stored node model is deliberately sparse: ID, URL, name, type, page,
breadcrumbs, dimensions, Ready for dev/Completed state, change description,
annotations, resource links, component and variant names, and optional code
connections. Screenshots, generated code, style dumps, and full vector trees
are excluded. Session-local asset URLs such as `localhost` resources are also
excluded because they cannot be resolved durably; Atlas keeps the file/node ID
and resolves relevant assets on demand.

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

`map_figma_file`, `list_figma_indexes`, and `find_design_candidates` accept a
hard response budget. MCP and CLI default to 3,600 characters and expose
metrics plus expandable IDs when secondary evidence is trimmed.

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

## Optional evidence

Code Connect mappings improve Figma-to-code evidence through component name and
source path, but remain optional. Libraries and file dev resources are also
optional enrichments. A missing integration lowers confidence; it does not
block repository analysis or cause Atlas to invent a relationship. Without
Code Connect, Atlas still crosses semantic task terms with component names,
paths, rendered children, imports/composables, tests, and graph consumers, and
reports the resulting confidence.

## Advanced CLI diagnostics

These commands are optional tools for explicit cache bootstrap, diagnostics,
or automation. They are not required before invoking `$frontend-task`.

```powershell
component-atlas figma map <root> <figma-url> `
  --metadata <xml-or-json-file> `
  [--format auto|figma-mcp-xml|figma-rest] `
  [--file-version <version>] `
  [--last-modified <timestamp>] `
  [--scope-node <id>] `
  [--scope-page-id <id> --scope-page-name <name>] `
  [--enrichment <json-file>]

component-atlas figma list <root>
component-atlas figma find <root> <task> [--file <url-or-key>]
component-atlas figma inspect <root> <url-or-key> <confirmed-node>
```

MCP equivalents are `map_figma_file`, `sync_figma_variables`,
`get_figma_variables`, `list_figma_indexes`, `find_design_candidates`, and
`inspect_design_node`.

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
