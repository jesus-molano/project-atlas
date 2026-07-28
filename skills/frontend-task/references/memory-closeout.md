# Memory closeout

`memoryCloseout` in the shared `AgentCompactResult` domain contract is the only
memory-closeout decision. `$frontend-task` and Codex produce it once. Chat
presents it conversationally; the Project Atlas GUI renders the same structured
object. Neither surface may independently detect candidates, change status, or
authorize persistence.

End every completed frontend task with that result plus a compact `Memory
candidates` presentation. Do not omit it and do not turn it into a broad
interview. The shared result reports one of these states:

| Status | Use when | Write or question |
| --- | --- | --- |
| `none` | No novel durable knowledge was detected | State that clearly; do not ask a question |
| `canonical-candidate` | A novel reusable decision, convention, constraint, integration, known issue, or lesson may help later tasks | Present up to three candidates and ask one explicit canonical-write confirmation |
| `canonical-stored` | The user explicitly authorized the named canonical write and it succeeded | Report the stored item and evidence; do not ask again |
| `local-only` | The useful result is an implementation episode, validation result, temporary condition, or checkout-specific fact | State the local/episodic outcome; do not ask for canonical promotion |
| `declined` | The user rejected, skipped, or omitted the candidate | State that nothing was stored; do not ask again unless scope or evidence changes |

For each `canonical-candidate`, include:

- type;
- short title and one-sentence reusable summary;
- exact evidence handles or verified facts;
- `canonical` scope;
- confidence from `0` to `1`;
- one question that names the candidate and asks whether to store it as
  canonical Project Memory.

Before presenting a candidate, search the relevant active memory. Do not
re-propose an equivalent item. If new evidence changes an existing item,
propose an update or supersession and name the existing ID.

Completion, implementation approval, a prior generic “continue”, or silence is
not memory confirmation. Until the user confirms the exact write, do not call
`record_outcome`, `propose_memory_update`, or `apply_memory_update`.

Map an explicit conversational acceptance to the shared
`confirm-canonical` action and a rejection/omission to `decline`. The GUI sends
those same actions back through the originating Codex task; it does not apply
memory itself.

After an unequivocal confirmation:

1. repeat the duplicate/current-memory check;
2. call `propose_memory_update` with the reviewed evidence, scope, and
   confidence;
3. inspect the normalized proposal;
4. call `apply_memory_update` with `confirmed: true` only when the user's
   confirmation explicitly authorized canonical persistence. If the user only
   authorized drafting, leave the proposal pending;
5. report `canonical-stored` only after the canonical apply succeeds.

If the user asks to retain a `local-only` result, call `record_outcome` with the
observed or verified evidence and report the local scope. Otherwise do not save
it.

Emit this exact structured shape:

```json
{
  "memoryCloseout": {
    "status": "none | canonical-candidate | canonical-stored | local-only | declined",
    "summary": "Compact status summary",
    "candidates": [
      {
        "type": "decision | convention | constraint | integration | known-issue | lesson",
        "title": "Candidate title",
        "summary": "Reusable knowledge",
        "evidence": ["Exact evidence handle or verified fact"],
        "scope": "canonical",
        "confidence": 0.9
      }
    ],
    "localOutcome": {
      "summary": "Checkout-only or episodic result",
      "evidence": ["Verified local evidence"]
    },
    "confirmationRequired": false,
    "confirmationPrompt": ""
  }
}
```

Omit `localOutcome` unless status is `local-only`. `canonical-candidate` requires
at least one candidate, `confirmationRequired: true`, and one non-empty
confirmation prompt. `canonical-stored` requires a successful explicitly
authorized canonical write. All other statuses use no candidates, no
confirmation, and an empty prompt.

Present the same object compactly in conversation as:

```text
Memory candidates — <status>
- <candidate, local outcome, decline, or “No durable project knowledge detected.”>
- Evidence and scope/confidence when applicable
- Confirmation: <only for canonical-candidate>
```
