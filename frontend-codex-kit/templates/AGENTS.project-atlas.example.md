# Project instructions

Keep this file as a map, not a manual.

## Essential commands

- Install: `<repository install command>`
- Test: `<focused test command>`
- Typecheck: `<typecheck command>`
- Build: `<build command>`

## Architecture map

- Product/domain overview: `<link to repository document>`
- Frontend conventions: `<link to repository document>`
- Component ownership: `<link to repository document>`
- Project Memory and local Atlas state: centralized Project Atlas storage
  outside the checkout (`pnpm atlas storage`)

## Non-negotiable rules

- Let `frontend-task` activate selectively for complex frontend implementation,
  or invoke `$frontend-task` explicitly when Atlas is desired. Do not add a
  catch-all rule that routes every frontend request through Atlas.
- Resolve supplied/material external sources before deep retrieval. Missing
  optional connectors or Atlas never block repository-first progress.
- Decide reuse/extend/compose/extract/create/not-applicable and lock that
  decision plus scope before editing shared UI.
- Check impact before changing a public component API.
- Treat Figma Ready for dev as useful evidence, never a prerequisite.
- Never place credentials or secrets in Project Memory.
- Do not perform any memory action without literal approval for its exact
  action and target.

## Task close

Run relevant validation, validate the complete task delta against the lock, and
close technically without memory. Handle any genuinely durable learning later
through a separately approved `atlas_memory` action.
