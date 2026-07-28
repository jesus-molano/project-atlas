# Source and capability precheck

Run this lightweight precheck before reading external detail or asking the
user for links.

## Detect

1. Resolve the current repository/cwd and the supplied task text.
2. Detect only explicit Jira keys/links, Confluence links, Figma file/node
   links, Swagger/OpenAPI URLs or local contract paths, GitHub references, and
   immediate references already attached to the task. Do not crawl broadly.
   Record each detected reference as task-scoped `pending` evidence. Detection
   does not authorize connector access.
3. Inspect the tools actually available in this session:
   - Atlassian Rovo for Jira/Confluence;
   - Figma Desktop MCP (the local server exposed by the desktop application) as
     the primary Figma route, plus any other Figma connector only as fallback;
   - GitHub for relevant remote repository/issue context;
   - Project Atlas MCP for local code/design/memory context.
   A local or remote Swagger/OpenAPI document is a task source, not evidence
   that a connector exists. Infer availability only from the supplied reference
   and ordinary read capabilities.
   When Atlas is available, report this session observation with
   `report_source_capabilities` and read `get_source_capabilities` only if
   connector health affects an already confirmed task source. Do not call a
   connector, probe a login or credential, search for missing sources, or test
   source health before the user confirms that source.
4. Classify each source for this task:

| Source | Required | Recommended/optional | Not applicable |
| --- | --- | --- | --- |
| Repository | Any code implementation | — | Non-code advice only |
| Figma | Reproduce a declared source-of-truth design | Other visual work | Non-visual work |
| Jira | Missing acceptance criteria live in the ticket | Brief is already sufficient | No ticket relationship |
| Confluence | Declared authorized spec/policy is necessary | Supporting domain context | No spec/policy relationship |
| Swagger/OpenAPI | It is the contract of the API the frontend must consume | API integration, authentication, or biometrics; supplementary endpoint context | No API interaction |
| Atlas | Never | When component/design/impact/memory context helps | No useful indexed context |
| GitHub | Remote issue/PR/repository evidence is needed | Useful remote history | Local evidence is sufficient |

Use `unavailable` instead when a relevant confirmed source is identified but
its capability is absent or unauthorized. Before confirmation, keep a detected
reference `pending`; do not probe it merely to choose `unavailable`. Never
install, initialize, or authorize a plugin, connector, or Atlas automatically.

## Report

Before any deep repository investigation or external retrieval, report one
compact line or small list:

- detected sources and callable capabilities;
- material missing sources;
- what will be used and what will be skipped.

## Ask

Resolve every detected external reference before retrieval. Ask “Is this the
correct source?” and support these outcomes for each source:

- confirm this reference;
- replace it or add another reference;
- continue without it;
- mark it unavailable.

The last two outcomes resolve an optional source and must not block the task.
For a required source, omission is still an explicit decision but blocks
contract-dependent preparation rather than permitting invention.

For every new high-risk task, override the normal relevance shortcut: ask one
grouped question that covers Jira, Confluence, Figma, and Swagger/OpenAPI even
when none was detected and regardless of connector availability. Each row or
part of the question must let the user confirm the detected reference, provide
or replace it, or continue explicitly without it. This is the first planning
checkpoint and must happen before investigating the repository beyond the
cheap precheck. A prior flow or implementation named as an example does not
skip it.

For other tasks, ask about a missing source only when it can materially change
implementation. Do not ask low-risk repository-only tasks to enumerate optional
sources.

When Project Atlas has already supplied a task source ledger, honor the
decisions it actually records and do not repeat them. For a new high-risk task,
the ledger satisfies the grouped checkpoint only when it records an explicit
decision for Jira, Confluence, Figma, and Swagger/OpenAPI. An empty ledger or
one containing detected links only leaves the other rows unresolved. Ask one
grouped question for those unresolved rows. Otherwise, when
`request_user_input` is available, use one grouped native selector question by
default and at most three:

- `Confirmar las fuentes indicadas`
- `Aportar o reemplazar enlaces`
- `Continuar sin las fuentes opcionales`

The native free-form/Other answer can carry one or more labeled URLs or IDs.
For a new high-risk task, the prompt itself must enumerate Jira, Confluence,
Figma, and Swagger/OpenAPI and record a decision for each; do not collapse an
absent row into “not needed”. If a required source is missing, explain that
continuing without it records the choice but stops contract-dependent
preparation.

Use this compact shape when no ledger UI exists:

> Before I investigate this new high-risk task, confirm the source intake in
> one reply. For each row, confirm the detected reference, provide/replace it,
> or say “without”: Jira — [reference or none]; Confluence — [reference or
> none]; Figma — [reference or none]; Swagger/OpenAPI — [reference or none].
> Recommended default: omit only sources you know are not part of this task.

When the selector is unavailable, ask one brief question in chat with the same
evidence and recommended default. The Project Atlas Workbench may render this
contract as an inline intake form; agents must not invent a second form or
block on optional sources.

## Retrieve

Use the provider that owns each source instead of reproducing it:

- Jira/Confluence through available Atlassian Rovo capabilities;
- confirmed Figma through Figma Desktop MCP, the local MCP server exposed by
  the Figma desktop application, first. Use the applicable Codex/Figma skill
  only as instructions or a prerequisite for the intended desktop MCP
  operation, never as a substitute data route. Use another connector, manual
  selection, or alternative evidence only when Figma Desktop MCP is not
  connected, not authorized, or lacks the required operation;
- confirmed Swagger/OpenAPI through the supplied local file, URL, or pasted
  contract; extract only task-relevant operations, schemas, responses, and
  authentication;
- GitHub through the GitHub capability when remote evidence matters;
- Project Atlas through its MCP when its compact context adds value.

Follow only explicit relevant links between sources. Keep provenance, use
orient/search/expand, and retrieve detail only after a source or node is
confirmed.

Keep the ledger in task/thread state. Durable source metadata can be proposed
for project promotion only with an explicit user decision; a task reference is
not durable knowledge by default.
