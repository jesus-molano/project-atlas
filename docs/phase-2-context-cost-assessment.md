# Phase 2: context cost measurement

Status: implemented. Phase 2 preserved the original 33 public MCP tool names
and the frontend skill. Phase 4 later added `validate_diff`, bringing the
current public surface to 34 tools without removing or renaming an existing
operation. The generated quality summary is authoritative for the current
count.

## Implemented outcome

Project Atlas records a versioned, content-free `ContextCostAudit` outside the
checkout. One task-level record joins:

- MCP description, schema, and serialized-contract sizes;
- the main skill and references actually loaded;
- generated prompt and compact retrieved-context sizes;
- capsule, manifest, receipt, and delegation byte totals;
- question, retry, correction, duration, and completion counters;
- actual SDK input, cached-input, and output tokens when available;
- a clearly labelled four-characters-per-token estimate otherwise.

The SQLite migration is idempotent and retention is bounded. Settings and
Health show run count plus median and P95 input. The CLI exposes:

```text
atlas context-cost list <project>
atlas context-cost report <project>
atlas context-cost export <project> --output audit.json
atlas context-cost import <project> --input audit.json
atlas context-cost clear <project> --confirm
```

`pnpm benchmark:context-cost` runs a fixed 12-case matrix: four small tasks,
four normal frontend tasks, and four complex Figma/OpenAPI tasks. It uses an
isolated temporary checkout and data home, prints only a content-free aggregate,
and leaves no persistent fixture state in the repository.

## Storage and use across computers

There is intentionally no automatic communication between computers. Audits
stay under the local Project Atlas data home rather than the product or Atlas
checkout.

Export is explicit and non-overwriting. Portable records exclude project and
checkout IDs, task text, prompts, paths, URLs, code, source or receipt bodies,
screenshots, Figma deep responses, and connector responses. Import binds the
numeric records to the selected local project through opaque source
fingerprints.

A normal two-computer workflow is:

1. collect real task records on the work computer;
2. export a sanitized JSON bundle explicitly;
3. transfer that file through a user-chosen route;
4. import it on the Atlas development computer;
5. compare task classes, median, and P95 locally.

Without export and transfer, the development computer has no visibility into
the work computer.

## Current measured contract

The current post-Phase-4 inventory contains 34 public tools. The reproducible
checkout snapshot measured:

| Portion | Characters | Fallback token estimate |
| --- | ---: | ---: |
| MCP descriptions | 4,842 | 1,211 |
| MCP input/output schemas | 26,289 | 6,573 |
| Complete serialized tool list | 34,575 | 8,644 |
| Normal loaded frontend skill path | 44,260 | 11,065 |

The fixed 12-case benchmark produced a fallback median input of 20,588 tokens
and P95 of 20,756 tokens in the implementation checkout. These are deterministic
character estimates, not an SDK billing statement. Real task reports prefer
the SDK totals and keep cached input separate.

The 33-tool, 33,807-character inventory recorded before `validate_diff` remains
a historical Phase 2 baseline only. It must not be described as the current
live contract.

## Privacy boundary

An audit may contain only:

- opaque project, checkout, task, contract, skill, and manifest fingerprints;
- task class and run mode;
- counts, character or byte totals, token totals, duration, and booleans;
- bounded categorical retry, failure, or completion reasons.

It rejects task and prompt text, source bodies, source paths, URLs, receipt
bodies, code, screenshots, and connector responses. Instrumentation does not
inject metrics into prompts and adds no more than 200 characters to normal MCP
responses. Network telemetry remains disabled by default.

## What the audit answers

The report groups records by task and task class and exposes median and P95. It
can distinguish:

- static MCP and skill cost;
- compact task-context cost;
- receipts, manifests, and resume state;
- delegation and retry overhead;
- actual versus estimated SDK usage.

It does not decide automatically that a tool or skill should be removed.
Measurement is deliberately separate from optimization.

## Decision gates for a later optimization

No optimization should remove or rename the original 33 public tool names or
reduce task quality. Use representative real runs to answer:

1. Is static contract or skill material still a large fraction of uncached P95
   input?
2. Which tools or references are rarely relevant but frequently loaded?
3. Would a proposal save at least 10% of P95 input or 2,000 uncached input
   tokens per affected task?
4. Does it preserve completion, top-three reuse quality, question rate,
   conflict detection, and rework rate?
5. Does it preserve the privacy and normal-response overhead limits?

If those gates are not met, keep the current MCP and skill surface.

## Recommendation

Collect representative runs on the work computer and transfer the sanitized
bundle only when comparison on the development computer is useful. Make any
future MCP or skill reduction as a separate, evidence-based decision.
