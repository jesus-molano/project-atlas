---
id: "attempt-search-deep-watch"
project: "*"
namespace: "fixture-search"
type: "attempt"
title: "Deep-watch the route query for filter synchronization"
summary: "The deep watcher failed because route replacement triggered duplicate fetches and a navigation loop."
status: "active"
confidence: 0.95
authority: "observed"
scope: "episodic"
created_at: "2026-07-15T10:00:00.000Z"
updated_at: "2026-07-15T10:00:00.000Z"
tags: ["search", "filters", "failed", "routing"]
supersedes: []
relations: [{"kind":"failed_for","targetId":"decision-search-url-v2"},{"kind":"references_code","targetId":"app/components/feature/SearchFilters.vue"}]
evidence: ["Duplicate request test failure", "Navigation loop reproduction"]
---
# Deep-watch the route query for filter synchronization

Do not repeat a bidirectional deep watcher. Use one normalized route update and
derive applied filter state from the route.
