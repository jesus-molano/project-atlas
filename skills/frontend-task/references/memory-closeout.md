# Memory closeout

Keep technical completion and Project Memory independent.

1. Complete implementation with `atlas_task_state` action `complete` after
   checks, review, and cleanup. This must not write Project Memory.
2. Decide conversationally whether any novel knowledge is worth retaining.
3. Default to `none` and make no `atlas_memory` call.

## Closeout states

| Status | Use when | Action |
| --- | --- | --- |
| `none` | No novel reusable or episodic knowledge exists | State that; do not ask or write |
| `episodic-candidate` | A verified task/check-out outcome may help diagnose this local project later | Ask one exact `record-episodic` question |
| `canonical-candidate` | A durable decision, convention, constraint, integration, known issue, or note may help future tasks | Ask one exact `propose-canonical` question |
| `proposal-pending` | A canonical proposal exists but has not been authorized for application | Review the exact ID if needed; do not apply |
| `stored` | The exact episodic record or canonical proposal was explicitly authorized and succeeded | Report its ID, scope, and evidence |
| `declined` | The user rejected or skipped the named candidate/proposal | Call `reject-proposal` only for an existing named proposal; otherwise write nothing |

## Consent rules

Literal consent must name the intended mutating memory action or unmistakably
approve the specific candidate/proposal just presented. Implementation
approval, technical completion, generic "continue", prior broad consent, or
silence is not memory consent.

Every mutating action uses the same two-call handshake:

1. Call `atlas_memory` with the complete intended payload and no `consent`.
   Atlas writes no memory and returns `needs-consent`, the full bounded scope,
   a payload-bound `consentToken`, and an issued consent receipt.
2. Show that exact scope to the user. Only after literal approval, repeat the
   unchanged call with `consent` equal to that token. Atlas rejects a token
   from another task/action or any payload change and returns a consumed
   receipt only after the mutation succeeds.

Do not manufacture a token, reuse one for a corrected payload, or treat the
first receipt as approval. If the proposed content changes, restart at step 1.

Use only these `atlas_memory` actions:

- `review-proposal`: read one exact proposal ID; this is non-mutating and never
  authorizes its application or rejection;
- `record-episodic`: after consent to retain the named task-local outcome;
- `propose-canonical`: after consent to create the named durable proposal;
- `apply-canonical`: after separate consent to apply the exact proposal ID;
- `reject-proposal`: after rejection of an existing proposal ID.

Never combine proposal and application into one implicit step. Before proposing
canonical knowledge, search only the relevant active memory returned by
`atlas_prepare_task`; expand one candidate with `atlas_expand_context` if needed.
Do not re-propose an equivalent item. Name any superseded item.

## Candidate content

Present at most three candidates. Include:

- type: decision, convention, constraint, integration, known issue, or note;
- short title and reusable one-sentence summary;
- exact verified evidence or receipt/handle IDs;
- proposed scope: episodic or canonical;
- confidence;
- one confirmation question naming the exact action.

Keep the final conversation compact:

```text
Memory - <status>
- <candidate, stored item, declined proposal, or no memory>
- Evidence/scope/confidence when applicable
- Confirmation: <only when an action still needs consent>
```

The GUI may display the same proposal and return the user's decision through the
originating native task. It must not detect candidates, reclassify scope, or
apply memory independently.
