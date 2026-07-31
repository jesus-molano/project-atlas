import type { ResponseMetrics } from "./types.js";

export const DEFAULT_RESPONSE_BUDGET_CHARS = 3_600;
export const MIN_RESPONSE_BUDGET_CHARS = 800;
export const MAX_RESPONSE_BUDGET_CHARS = 12_000;

export interface BudgetOptions {
  budgetChars?: number | undefined;
  totalMatches?: number;
  nextCursor?: string;
  expandableIds?: string[];
  preserveKeys?: string[];
  preserveFirstKeys?: string[];
  retrieval?: NonNullable<ResponseMetrics["retrieval"]>;
}

function normalizedBudget(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RESPONSE_BUDGET_CHARS;
  return Math.max(
    MIN_RESPONSE_BUDGET_CHARS,
    Math.min(Math.floor(value!), MAX_RESPONSE_BUDGET_CHARS),
  );
}

function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new Error(
      "Compact responses must contain finite, JSON-serializable data without cycles.",
    );
  }
}

interface ArrayRef {
  value: unknown[];
  key?: string;
}

interface StringRef {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
  value: string;
}

function collectShrinkable(
  value: unknown,
  arrays: ArrayRef[],
  strings: StringRef[],
): void {
  const pending: Array<{
    value: unknown;
    parent?: Record<string, unknown> | unknown[];
    key?: string | number;
    depth: number;
  }> = [{ value, depth: 0 }];
  let visitedNodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visitedNodes += 1;
    if (visitedNodes > 20_000 || current.depth > 128) {
      throw new Error(
        "Compact response exceeds the structural safety limit.",
      );
    }
    if (typeof current.value === "string") {
      if (
        current.parent &&
        current.key !== undefined &&
        current.value.length > 48
      ) {
        strings.push({
          parent: current.parent,
          key: current.key,
          value: current.value,
        });
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      arrays.push({
        value: current.value,
        ...(typeof current.key === "string" ? { key: current.key } : {}),
      });
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          parent: current.value,
          key: index,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    const object = current.value as Record<string, unknown>;
    const entries = Object.entries(object);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [childKey, child] = entries[index]!;
      if (childKey === "metrics") continue;
      pending.push({
        value: child,
        parent: object,
        key: childKey,
        depth: current.depth + 1,
      });
    }
  }
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function settleMetrics(
  response: Record<string, unknown> & { metrics: ResponseMetrics },
): number {
  for (let pass = 0; pass < 4; pass += 1) {
    const usedChars = serializedLength(response);
    response.metrics.usedChars = usedChars;
    response.metrics.estimatedTokens = Math.ceil(usedChars / 4);
  }
  return serializedLength(response);
}

export function fitBudgetedResponse<T extends Record<string, unknown>>(
  payload: T,
  options: BudgetOptions = {},
): T & { metrics: ResponseMetrics } {
  const budgetChars = normalizedBudget(options.budgetChars);
  const expandableLimit =
    budgetChars <= 2_400 ? 6 : budgetChars <= 3_600 ? 12 : 20;
  const response = {
    ...clone(payload),
    metrics: {
      budgetChars,
      usedChars: 0,
      estimatedTokens: 0,
      truncated: false,
      totalMatches: options.totalMatches ?? 0,
      ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
      expandableIds: [...new Set(options.expandableIds ?? [])].slice(
        0,
        expandableLimit,
      ),
      ...(options.retrieval ? { retrieval: options.retrieval } : {}),
    },
  } as T & { metrics: ResponseMetrics };

  let safety = 0;
  while (settleMetrics(response) > budgetChars && safety < 1_000) {
    safety += 1;
    const arrays: ArrayRef[] = [];
    const strings: StringRef[] = [];
    collectShrinkable(response, arrays, strings);
    const populatedArrays = arrays.filter(
      (candidate) =>
        candidate.value.length > 0 &&
        !(
          candidate.key &&
          options.preserveFirstKeys?.includes(candidate.key) &&
          candidate.value.length <= 1
        ),
    );
    const unprotectedArrays = populatedArrays.filter(
      (candidate) => !options.preserveKeys?.includes(candidate.key ?? ""),
    );
    const array = (unprotectedArrays.length > 0
      ? unprotectedArrays
      : populatedArrays
    )
      .sort(
        (left, right) =>
          serializedLength(right.value) - serializedLength(left.value),
      )[0];
    if (array) {
      array.value.pop();
      response.metrics.truncated = true;
      continue;
    }
    const string = strings.sort(
      (left, right) => right.value.length - left.value.length,
    )[0];
    if (string) {
      const shortened = `${string.value.slice(0, Math.max(32, Math.floor(string.value.length / 2) - 1))}…`;
      if (Array.isArray(string.parent)) {
        string.parent[string.key as number] = shortened;
      } else {
        string.parent[string.key as string] = shortened;
      }
      response.metrics.truncated = true;
      continue;
    }
    break;
  }

  const used = settleMetrics(response);
  if (used > budgetChars) {
    const largestFields = Object.entries(response)
      .map(([key, value]) => [key, serializedLength(value)] as const)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([key, size]) => `${key}=${size}`)
      .join(", ");
    throw new Error(
      `Compact response cannot fit the minimum ${budgetChars}-character budget (${used} characters; largest fields: ${largestFields}).`,
    );
  }
  return response;
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { offset?: unknown };
    if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) {
      throw new Error("Invalid Project Atlas cursor.");
    }
    return parsed.offset as number;
  } catch {
    throw new Error("Invalid Project Atlas cursor.");
  }
}
