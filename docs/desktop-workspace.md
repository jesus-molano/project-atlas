# Desktop evidence-workspace contract

Project Atlas is a local desktop-shaped browser for project evidence. Its
primary question is: “What exists, what is authoritative, and what requires a
human decision?” Model execution is deliberately outside the product.

| Area | User decision | Evidence | Recovery |
| --- | --- | --- | --- |
| Home | Open/rescan the correct checkout | logical project, branch, HEAD, diff, snapshot | reopen project or rescan locally |
| Code | reuse, extend, extract or change | exact consumers/tests and explainable similarity | refresh index and revise selection |
| Design | choose exact frame/state/mapping | file/node identity, receipt, indexed properties | synchronize the exact source through approved tooling |
| Memory | accept, supersede or reject knowledge | authority, confidence, provenance, scope | review history and active decision |
| Action Center | resolve or defer a finding | rule, evidence handles, fingerprint | stale the resolution when evidence changes |
| Connections | trust or repair a source/index | capability, freshness, provenance, usage | local diagnostic or explicit reconnection |

## Local mutations

The workspace may select projects, inspect or open existing checkouts, refresh
indexes, record Action Center resolutions, approve memory and clear local
metrics. It cannot create branches or worktrees. Each mutation is bound to the
local GUI session and active project/checkout. None authorizes model execution.

## Search

Global search covers code, design and memory. It returns local IDs and concise
reasons. Selecting a result opens its evidence view; results are not copied into
a model prompt automatically.

## Native Codex integration

Users start `$frontend-task` in native Codex. Atlas core tools return bounded
handles and receipts to that task. The GUI can later inspect resulting outcomes
and memory proposals, but cannot launch or continue the task. Orca, not Atlas,
owns workspace and multi-agent orchestration.
