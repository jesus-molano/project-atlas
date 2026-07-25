---
id: "decision-search-url-v2"
project: "*"
namespace: "fixture-search"
type: "decision"
title: "Search filters live in the URL"
summary: "Every user-visible search filter, including study, is encoded in query parameters so results are shareable and restorable."
status: "active"
confidence: 0.98
authority: "decided"
scope: "canonical"
created_at: "2026-06-01T10:00:00.000Z"
updated_at: "2026-07-22T09:00:00.000Z"
verified_at: "2026-07-22T09:00:00.000Z"
tags: ["search", "filters", "url", "study"]
supersedes: ["decision-search-local-state-v1"]
relations: [{"kind":"supersedes","targetId":"decision-search-local-state-v1"},{"kind":"references_code","targetId":"app/components/feature/SearchFilters.vue"}]
evidence: ["Decision review 2026-06-01", "Route restoration tests"]
---
# Search filters live in the URL

Update the route query as the filter source of truth. Components may keep
transient editing state, but applied filters must be serialized to the URL.
