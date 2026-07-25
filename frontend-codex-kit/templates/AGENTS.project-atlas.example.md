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
- Project Memory: `project-memory/`
- Local Atlas artifacts: `.component-atlas/` (ignored)

## Non-negotiable rules

- Use `frontend-task` for frontend work when available; missing optional
  connectors or Atlas never block repository-first progress.
- Search existing components and request compact Project Atlas task context
  before creating shared UI.
- Check impact before changing a public component API.
- Treat Figma Ready for dev as useful evidence, never a prerequisite.
- Never place credentials or secrets in Project Memory.
- Propose durable memory changes; do not confirm them without explicit approval.

## Task close

Run the relevant validation, rescan Atlas after structural component changes,
record the observed outcome, and propose only genuinely durable learnings.
