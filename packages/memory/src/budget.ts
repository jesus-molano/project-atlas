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
}

function normalizedBudget(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RESPONSE_BUDGET_CHARS;
  return Math.max(
    MIN_RESPONSE_BUDGET_CHARS,
    Math.min(Math.floor(value!), MAX_RESPONSE_BUDGET_CHARS),
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
  parent?: Record<string, unknown> | unknown[],
  key?: string | number,
): void {
  if (typeof value === "string") {
    if (parent && key !== undefined && value.length > 48) {
      strings.push({ parent, key, value });
    }
    return;
  }
  if (Array.isArray(value)) {
    arrays.push({
      value,
      ...(typeof key === "string" ? { key } : {}),
    });
    value.forEach((item, index) =>
      collectShrinkable(item, arrays, strings, value, index),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  const object = value as Record<string, unknown>;
  for (const [childKey, child] of Object.entries(object)) {
    if (childKey === "metrics") continue;
    collectShrinkable(child, arrays, strings, object, childKey);
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
  const response = {
    ...clone(payload),
    metrics: {
      budgetChars,
      usedChars: 0,
      estimatedTokens: 0,
      truncated: false,
      totalMatches: options.totalMatches ?? 0,
      ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
      expandableIds: [...new Set(options.expandableIds ?? [])].slice(0, 20),
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
    throw new Error(
      `Compact response cannot fit the minimum ${budgetChars}-character budget.`,
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
    return Number.isInteger(parsed.offset) && (parsed.offset as number) >= 0
      ? (parsed.offset as number)
      : 0;
  } catch {
    throw new Error("Invalid Project Atlas cursor.");
  }
}
