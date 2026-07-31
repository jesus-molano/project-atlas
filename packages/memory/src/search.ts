import {
  decodeCursor,
  encodeCursor,
  fitBudgetedResponse,
} from "./budget.js";
import type {
  MemoryItem,
  MemorySearchHit,
  MemorySearchOptions,
} from "./types.js";

function normalizedTokens(value: string): string[] {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function scoreItem(
  item: MemoryItem,
  query: string,
): { score: number; reasons: string[] } {
  const terms = [...new Set(normalizedTokens(query))];
  if (terms.length === 0) {
    return { score: 1, reasons: ["recent scoped memory"] };
  }
  const fields = {
    title: new Set(normalizedTokens(item.title)),
    summary: new Set(normalizedTokens(item.summary)),
    tags: new Set(item.tags.flatMap(normalizedTokens)),
    body: new Set(normalizedTokens(item.body ?? "")),
  };
  let score = 0;
  const reasons: string[] = [];
  const matches = (field: Set<string>, weight: number, label: string) => {
    const hit = terms.filter((term) => field.has(term));
    if (hit.length > 0) {
      score += hit.length * weight;
      reasons.push(`${label}: ${hit.slice(0, 4).join(", ")}`);
    }
  };
  matches(fields.title, 6, "title");
  matches(fields.tags, 5, "tags");
  matches(fields.summary, 3, "summary");
  matches(fields.body, 1, "body");
  // Authority breaks ties between relevant matches; it must never make an
  // unrelated item relevant by itself.
  if (score > 0 && item.authority === "verified") score += 1;
  else if (score > 0 && item.authority === "decided") score += 0.75;
  return { score, reasons };
}

export function rankMemoryItems(
  items: MemoryItem[],
  query: string,
  options: MemorySearchOptions = {},
) {
  const includeInactive = options.includeInactive ?? false;
  const statuses = options.statuses;
  const types = options.types;
  const requiredTags = options.tags ?? [];
  return items
    .filter((item) => {
      if (
        !includeInactive &&
        !statuses &&
        ["superseded", "archived", "rejected"].includes(item.status)
      ) {
        return false;
      }
      if (statuses && !statuses.includes(item.status)) return false;
      if (types && !types.includes(item.type)) return false;
      if (
        requiredTags.length > 0 &&
        !requiredTags.some((tag) => item.tags.includes(tag))
      ) {
        return false;
      }
      return true;
    })
    .map((item) => ({ item, ...scoreItem(item, query) }))
    .filter((candidate) => !query.trim() || candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.item.updatedAt.localeCompare(left.item.updatedAt),
    );
}

export function compactMemorySearch(
  items: MemoryItem[],
  query: string,
  options: MemorySearchOptions = {},
) {
  const ranked = rankMemoryItems(items, query, options);
  const offset = decodeCursor(options.cursor);
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  const page = ranked.slice(offset, offset + limit);
  const hits: MemorySearchHit[] = page.map(({ item, score, reasons }) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    summary: item.summary,
    status: item.status,
    authority: item.authority,
    confidence: item.confidence,
    scope: item.scope,
    updatedAt: item.updatedAt,
    ...(item.reviewAfter ? { reviewAfter: item.reviewAfter } : {}),
    tags: item.tags.slice(0, 6),
    score: Number(score.toFixed(2)),
    reasons: reasons.slice(0, 3),
    expandable: true,
  }));
  const nextOffset = offset + page.length;
  const nextCursor =
    nextOffset < ranked.length ? encodeCursor(nextOffset) : undefined;
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      query: query.trim(),
      results: hits,
    },
    {
      budgetChars: options.budgetChars,
      totalMatches: ranked.length,
      ...(nextCursor ? { nextCursor } : {}),
      expandableIds: hits.map((hit) => hit.id),
    },
  );
}
