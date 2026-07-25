# Figma Design Index

The Design Index gives agents orientation without placing an entire Figma file
in the conversation. It is a read-only, local cache beside the component graph;
it is not a preview runtime or a Figma replacement.

## Two routes

Direct route:

1. The user provides or selects one concrete frame or component.
2. If the node is cached, call `inspect_design_node`; otherwise the calling
   agent can use the confirmed Figma link directly.
3. Retrieve `get_design_context` and `get_screenshot` only for that node.
4. Retrieve exact selection variables with `get_variable_defs`.
5. Combine the result with Atlas component context before implementation.

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
- optional enrichment for dev status/resources, libraries, Code Connect, and
  global Variables.

The cache lives in the repository's Atlas SQLite database under local
application data. An identical source/scope hash returns `unchanged`. New page
snapshots merge into the same version. A different `version` or `lastModified`
starts a fresh map so nodes removed from Figma do not remain indefinitely.

The stored node model is deliberately sparse: ID, URL, name, type, page,
breadcrumbs, dimensions, Ready for dev/Completed state, change description,
annotations, resource links, component and variant names, and optional code
connections. Screenshots, generated code, style dumps, and full vector trees
are excluded.

## Ranking and confirmation

Task matching is explainable rather than authoritative. It scores:

- task terms and bilingual semantic aliases against page, section, and frame
  names;
- Ready for dev descriptions and annotations;
- linked resources and contained components/variants;
- mobile/desktop and shared-library intent;
- optional Code Connect evidence;
- nearest component names from the local Atlas graph.

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
   user. For example, missing global Variables access falls back to
   `get_variable_defs` for the confirmed node.

This gate is intended to be shared later by `frontend-task`; it is not a visual
UI and does not turn every uncertainty into a question.

## Global Variables and modes

The model supports a cheap file-level catalog:

- collection ID and name;
- modes such as Light/Dark;
- variable count and resolved types;
- local or remote origin;
- aliases and optional values by mode.

The normal map summary exposes collections, modes, counts, and types—not every
value. Exact values belong to the confirmed-node step. If a permitted Variables
API response is supplied, Atlas can normalize its collections and variables;
values are omitted unless the input explicitly marks them as included.

The Figma `GET /v1/files/:file_key/variables/local` endpoint is currently
Enterprise-gated, requires an eligible organization member/seat, view access to
the file, and the `file_variables:read` scope. Corporate policy can still deny
it. Atlas therefore records availability as `global`, `selection-only`, or
`unavailable`. `selection-only` is a supported operating mode: continue with
the sparse map and call `get_variable_defs` after node confirmation. Atlas never
requests `file_variables:write` and never creates, edits, or publishes Figma
variables.

## Optional evidence

Code Connect mappings improve Figma-to-code evidence through component name and
source path, but remain optional. Libraries and file dev resources are also
optional enrichments. A missing integration lowers confidence; it does not
block repository analysis or cause Atlas to invent a relationship.

## CLI

```powershell
component-atlas figma map <root> <figma-url> `
  --metadata <xml-or-json-file> `
  [--format auto|figma-mcp-xml|figma-rest] `
  [--file-version <version>] `
  [--last-modified <timestamp>] `
  [--scope-node <id>] `
  [--enrichment <json-file>]

component-atlas figma list <root>
component-atlas figma find <root> <task> [--file <url-or-key>]
component-atlas figma inspect <root> <url-or-key> <confirmed-node>
```

MCP equivalents are `map_figma_file`, `list_figma_indexes`,
`find_design_candidates`, and `inspect_design_node`.

## Validation boundary

Fixtures validate REST and MCP XML normalization, incremental cache behavior,
Ready for dev, mobile/desktop ranking, Code Connect evidence, variable modes,
and confirmed-node handoff. The remaining environment validation is to map one
real team file and run five real tasks. That requires a file link or active
selection plus read permission; it does not require Atlas to receive a token.

## Figma references

- [MCP tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [REST file endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
- [Variables REST endpoints](https://developers.figma.com/docs/rest-api/variables-endpoints/)
