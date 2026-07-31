# Source preflight

Run this cheap gate before `atlas_prepare_task`, deep repository scanning, or
connector access whenever an external reference is detected or materially
required.

## Detect without retrieving

1. Resolve the repository root and task text.
2. Detect only references supplied in the task or immediately attached to it:
   Jira, Confluence, Figma, GitHub, Swagger/OpenAPI, and local contracts.
3. Record a bare detected reference as `pending`. A vague "use this" beside a
   URL is still ambiguous. Do not probe a connector, login, credential, URL, or
   provider health to classify it.
4. Count the current user turn as confirmation without asking again only when an
   imperative binds the exact identity, provider, intended authority, and task
   scope, for example: "Implement checkout using Figma node X as visual
   authority" or "Use Swagger Y as the API contract for checkout." If any
   boundary is unclear, the link is incidental/secondary, or confirmed sources
   conflict, keep it `pending`.
5. Classify only domains that can affect the task:

| Source | Required | Optional/recommended | Not applicable |
| --- | --- | --- | --- |
| Repository | Any implementation | - | Advice without code |
| Figma | Reproduce a declared design source | Visual comparison/support | Non-visual or settled local pattern |
| Jira | Acceptance criteria live only there | Supporting task context | No ticket relationship |
| Confluence | Governing policy/spec lives there | Supporting domain context | No spec relationship |
| OpenAPI | Governing frontend API contract | API integration evidence | No API interaction |
| GitHub | Remote issue/PR/history is authoritative | Useful history | Local checkout is sufficient |
| Atlas | Never authoritative | Reuse, impact, receipts, memory | No useful indexed context |

Do not ask every high-risk task to enumerate all providers. High risk requires
confirmation of the objective and every materially implicated authority, not a
fixed Jira-to-Confluence-to-Figma-to-OpenAPI checklist.

## Resolve pending decisions

For each pending source, support exactly these outcomes:

- confirm the exact reference;
- replace it or add a more specific reference;
- continue without it;
- mark it unavailable.

Group related decisions into one question and ask at most three questions in
total. Include the evidence, recommended default, and consequence. Optional
omission is non-blocking. Missing required authority blocks only dependent work;
it never authorizes invention.

When Project Atlas already has a task ledger, reuse confirmed/omitted decisions
whose identity and scope still match. A replacement returns only that source to
`pending`. Do not repeat settled questions.

## Retrieve confirmed evidence before preparation

Use the provider that owns the source:

- Jira/Confluence through the connected Atlassian capability;
- Figma through the available confirmed Figma route and its required skill;
- OpenAPI through the supplied URL, local file, or pasted contract with bounded
  same-origin derivation and network safety. When a connector or paste already
  returned the document, pass it once as transient `openapi_content`; Atlas
  hashes and parses it without fetching the reference again;
- GitHub through the connected GitHub capability;
- Atlas through its six core tools.

Preserve exact identity and receipt provenance. Follow only explicit relevant
links. Search results remain candidates and never silently replace a confirmed
source.

For confirmed Figma, inspect sparse metadata before deep context. Segment broad
pages by relevant frames/children, preserve successful chunks, and narrow after
a timeout instead of repeating a larger request. Keep the original file/node
identity visible when evidence is incomplete.

For OpenAPI 502/503/504, retry once. Then use a current validated receipt,
generated repository clients/types/tests, or a supplied local contract in that
order. Ask before using stale authoritative evidence.

## Prepare once for this evidence version

Call `atlas_prepare_task` only after pending decisions are resolved and every
required confirmed source has been retrieved. Pass new provider results in the
matching `sources[].evidence` object; Atlas validates them and creates the
immutable receipt IDs. Pass `receipt_ids` only when resuming receipts that Atlas
already persisted for this task. Pass cross-source relationships separately in
`source_relations`.

Every new evidence object must include the provider's stable ISO-8601
`observed_at`. Reuse that value on an identical retry; never replace it with the
retry time. The receipt identity binds the complete normalized authority tuple,
including route, operation, requested/resolved identity, scope, fallback,
coverage, freshness, content hash, and observation time.

Transient OpenAPI bodies are capped at 1.5 MB and must match an optional
`sha256:` `content_hash`. They exist only for that core call; retain the returned
document and operation receipt IDs, never copy the body into task memory.
Do not pass credentials or signed-token query parameters in a reference,
resolved reference, or route. An internal connector route must be a stable
adapter identifier; keep authenticated transport URLs inside the connector.

- `pending` must return `needs-confirmation` without repository scan or external
  retrieval; normally resolve it before making the call.
- `confirmed` permits only the declared provider route and immutable scope; it
  does not itself claim retrieval. Required confirmed sources need exact,
  current evidence in this call or a current persisted receipt.
- `omitted` and `unavailable` resolve optional sources without retrieval.
- A changed decision, receipt, or relation is a named source-ledger invalidation
  and may re-run preparation under the same task ID.

Never install, initialize, or authorize a plugin automatically.

## Authority conflicts

Do not silently choose contradictory sources. Present the smallest conflict and
recommend a resolution using specificity, freshness, and domain authority:

1. current explicit user clarification;
2. governing acceptance criteria;
3. confirmed OpenAPI for request/response/auth semantics;
4. confirmed Figma for visual structure and annotated states;
5. supporting Confluence;
6. repository behavior and conventions.

Security, accessibility, privacy, and data integrity can override visual
evidence and must be named explicitly.
