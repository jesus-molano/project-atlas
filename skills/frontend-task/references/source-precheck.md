# Source and capability precheck

Run this lightweight precheck before reading external detail or asking the
user for links.

## Detect

1. Resolve the current repository/cwd and the supplied task text.
2. Detect only explicit Jira keys/links, Confluence links, Figma file/node
   links, GitHub references, and immediate references already attached to the
   task. Do not crawl broadly.
   Record each detected reference as task-scoped `pending` evidence. Detection
   does not authorize connector access.
3. Inspect the tools actually available in this session:
   - Atlassian Rovo for Jira/Confluence;
   - Figma for design;
   - GitHub for relevant remote repository/issue context;
   - Project Atlas MCP for local code/design/memory context.
   When Atlas is available, report this session observation with
   `report_source_capabilities` and read `get_source_capabilities` only if
   connector health affects the task. Do not probe a login or credential.
4. Classify each source for this task:

| Source | Required | Recommended/optional | Not applicable |
| --- | --- | --- | --- |
| Repository | Any code implementation | — | Non-code advice only |
| Figma | Reproduce a declared source-of-truth design | Other visual work | Non-visual work |
| Jira | Missing acceptance criteria live in the ticket | Brief is already sufficient | No ticket relationship |
| Confluence | Declared authorized spec/policy is necessary | Supporting domain context | No spec/policy relationship |
| Atlas | Never | When component/design/impact/memory context helps | No useful indexed context |
| GitHub | Remote issue/PR/repository evidence is needed | Useful remote history | Local evidence is sufficient |

Use `unavailable` instead when a relevant source is identified but its
capability is absent or unauthorized. Never install, initialize, or authorize a
plugin, connector, or Atlas automatically.

## Report

Before deep retrieval, report one compact line or small list:

- detected sources and callable capabilities;
- material missing sources;
- what will be used and what will be skipped.

## Ask

Resolve every detected external reference before retrieval. Ask “Is this the
correct source?” and support four outcomes:

- confirm this reference;
- replace it or add another reference;
- continue without it;
- mark it unavailable.

The last two outcomes resolve an optional source and must not block the task.
Ask about a missing source only when it can materially change implementation.
Do not ask low-risk repository-only tasks to enumerate optional sources.

When Project Atlas has already supplied a task source ledger, honor it and do
not repeat the questions. Otherwise, when `request_user_input` is available,
use one grouped native selector question by default and at most three:

- `Usar fuentes detectadas`
- `Añadir enlaces`
- `Continuar solo con el repositorio`

The native free-form/Other answer can carry a URL or ID. If a required source
is missing, replace the last option with `Detener preparación` when continuing
would fabricate requirements.

When the selector is unavailable, ask one brief question in chat with the same
evidence and recommended default. The Project Atlas Workbench may render this
contract as an inline intake form; agents must not invent a second form or
block on optional sources.

## Retrieve

Use the provider that owns each source instead of reproducing it:

- Jira/Confluence through available Atlassian Rovo capabilities;
- Figma through available Figma capabilities;
- GitHub through the GitHub capability when remote evidence matters;
- Project Atlas through its MCP when its compact context adds value.

Follow only explicit relevant links between sources. Keep provenance, use
orient/search/expand, and retrieve detail only after a source or node is
confirmed.

Keep the ledger in task/thread state. Durable source metadata can be proposed
for project promotion only with an explicit user decision; a task reference is
not durable knowledge by default.
