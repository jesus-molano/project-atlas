import type {
  DesignVariableCatalog,
  DesignVariableResolvedType,
  DesignVariableToken,
  DesignVariableValue,
} from "./types.js";

const MAX_VARIABLE_COLLECTIONS = 200;
const MAX_VARIABLE_INPUTS = 100_000;
const MAX_EXPANDED_VARIABLES = 1_000;
const MAX_VARIABLE_MODES = 40;
const MAX_VALUES_PER_VARIABLE = 40;
const MAX_VARIABLE_SCOPES = 50;
const MAX_VARIABLE_ID_CHARS = 500;
const MAX_VARIABLE_NAME_CHARS = 500;
const MAX_VARIABLE_SCOPE_CHARS = 120;
const MAX_VARIABLE_STRING_VALUE_CHARS = 4_000;
const MAX_VARIABLE_NOTE_CHARS = 500;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  const normalized = text(value);
  return normalized && normalized.length <= maximum ? normalized : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function variableResolvedType(value: unknown): DesignVariableResolvedType {
  const normalized = text(value)?.toUpperCase();
  return normalized === "BOOLEAN" ||
    normalized === "FLOAT" ||
    normalized === "STRING" ||
    normalized === "COLOR"
    ? normalized
    : "UNKNOWN";
}

function variableValue(value: unknown): DesignVariableValue | undefined {
  if (typeof value === "string") {
    return value.length <= MAX_VARIABLE_STRING_VALUE_CHARS
      ? value
      : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") return value;
  const item = record(value);
  const normalizedAliasId = boundedText(
    item?.aliasTo,
    MAX_VARIABLE_ID_CHARS,
  );
  if (normalizedAliasId) return { aliasTo: normalizedAliasId };
  const aliasType = text(item?.type)?.toUpperCase();
  const aliasId =
    aliasType === "VARIABLE_ALIAS"
      ? boundedText(item?.id, MAX_VARIABLE_ID_CHARS)
      : undefined;
  if (aliasId) return { aliasTo: aliasId };
  const r = numberValue(item?.r);
  const g = numberValue(item?.g);
  const b = numberValue(item?.b);
  const a = numberValue(item?.a);
  if (r !== undefined && g !== undefined && b !== undefined) {
    return {
      r,
      g,
      b,
      ...(a !== undefined ? { a } : {}),
    };
  }
  return undefined;
}

function keyedEntries(value: unknown): Array<[string, unknown]> {
  const item = record(value);
  if (item) return Object.entries(item);
  return array(value).map((entry, index) => [
    text(record(entry)?.id) ?? String(index),
    entry,
  ]);
}

function emptyVariableCatalog(
  syncedAt: string | undefined,
): DesignVariableCatalog {
  return {
    availability: "unavailable",
    source: "none",
    detailLevel: "catalog",
    valuesIncluded: false,
    ...(syncedAt ? { syncedAt } : {}),
    totalCollections: 0,
    totalVariables: 0,
    collections: [],
    variables: [],
    truncated: {
      collections: false,
      variables: false,
      values: false,
    },
    note:
      "No file-global Variables read was supplied. This is an access state, not evidence that the Figma file has no variables.",
  };
}

export function normalizeDesignVariableCatalog(
  value: unknown,
  syncedAt?: string,
): DesignVariableCatalog {
  const raw = record(value);
  if (!raw) {
    return emptyVariableCatalog(syncedAt);
  }
  const rawSyncedAt = boundedText(raw.syncedAt, 100);
  const catalogSyncedAt =
    rawSyncedAt && Number.isFinite(Date.parse(rawSyncedAt))
      ? rawSyncedAt
      : syncedAt;
  const meta = record(raw.meta) ?? raw;
  const rawCollections =
    meta.variableCollections ?? meta.collections ?? [];
  const rawVariables = meta.variables ?? [];
  const collectionEntries = keyedEntries(rawCollections);
  const variableEntries = keyedEntries(rawVariables);
  const requestedAvailability = text(raw.availability);
  const requestedSource = text(raw.source);
  const availability =
    requestedAvailability === "selection-only" ||
    requestedAvailability === "unavailable" ||
    requestedAvailability === "permission-required"
      ? requestedAvailability
      : requestedAvailability === "global" ||
          collectionEntries.length > 0
        ? "global"
        : "unavailable";
  if (availability !== "global") {
    const source =
      availability === "selection-only"
        ? "figma-selection"
        : requestedSource === "figma-desktop-mcp-global" ||
            requestedSource === "figma-variables-rest"
          ? requestedSource
          : "none";
    const defaultNote =
      availability === "selection-only"
        ? "Only node/selection variables are readable through get_variable_defs. This fallback is not a file-global Variables catalog."
        : availability === "permission-required"
          ? "File-global Variables require additional authorization or plan access. No absence of variables is inferred."
          : "File-global Variables were not exposed by the confirmed source. No absence of variables is inferred.";
    return {
      availability,
      source,
      detailLevel: "catalog",
      valuesIncluded: false,
      ...(catalogSyncedAt ? { syncedAt: catalogSyncedAt } : {}),
      totalCollections: 0,
      totalVariables: 0,
      collections: [],
      variables: [],
      truncated: {
        collections: false,
        variables: false,
        values: false,
      },
      note:
        boundedText(raw.note, MAX_VARIABLE_NOTE_CHARS) ??
        defaultNote,
    };
  }
  if (
    requestedAvailability === "global" &&
    requestedSource !== "figma-desktop-mcp-global" &&
    requestedSource !== "figma-variables-rest" &&
    requestedSource !== "figma-variables-api"
  ) {
    throw new Error(
      "A global Variables catalog must identify a confirmed file-global source.",
    );
  }
  if (
    requestedSource === "figma-selection" ||
    requestedSource === "none"
  ) {
    throw new Error(
      "Selection-scoped or absent Variables evidence cannot be normalized as a global catalog.",
    );
  }
  const source =
    requestedSource === "figma-desktop-mcp-global" ||
    requestedSource === "figma-variables-rest"
      ? requestedSource
      : requestedSource === "figma-variables-api"
        ? "figma-variables-rest"
        : "figma-variables-rest";
  const detailLevel =
    text(raw.detailLevel) === "expanded" ||
    text(raw.detail_level) === "expanded" ||
    raw.valuesIncluded === true ||
    raw.includeValues === true
      ? "expanded"
      : "catalog";
  const includeValues =
    detailLevel === "expanded" &&
    (raw.valuesIncluded === true || raw.includeValues === true);
  let valuesTruncated = false;
  let variablesTruncated = false;
  const normalizedTokens = variableEntries
    .slice(0, MAX_VARIABLE_INPUTS)
    .map(([fallbackId, variable]): DesignVariableToken | undefined => {
      const item = record(variable);
      const id =
        boundedText(item?.id, MAX_VARIABLE_ID_CHARS) ??
        boundedText(fallbackId, MAX_VARIABLE_ID_CHARS);
      const name = boundedText(item?.name, MAX_VARIABLE_NAME_CHARS);
      const collectionId =
        boundedText(item?.variableCollectionId, MAX_VARIABLE_ID_CHARS) ??
        boundedText(item?.collectionId, MAX_VARIABLE_ID_CHARS) ??
        boundedText(item?.variable_collection_id, MAX_VARIABLE_ID_CHARS);
      if (!item || !id || !name || !collectionId) {
        variablesTruncated = true;
        return undefined;
      }
      const valuesByMode = record(item.valuesByMode);
      const normalizedValues = includeValues && valuesByMode
        ? Object.entries(valuesByMode)
            .slice(0, MAX_VALUES_PER_VARIABLE)
            .flatMap(([modeId, modeValue]) => {
              const boundedModeId = boundedText(
                modeId,
                MAX_VARIABLE_ID_CHARS,
              );
              const normalized = variableValue(modeValue);
              if (!boundedModeId || normalized === undefined) {
                valuesTruncated = true;
                return [];
              }
              return [[boundedModeId, normalized] as const];
            })
        : [];
      if (
        includeValues &&
        valuesByMode &&
        Object.keys(valuesByMode).length > MAX_VALUES_PER_VARIABLE
      ) {
        valuesTruncated = true;
      }
      const rawScopes = array(item.scopes);
      const scopes = rawScopes
        .slice(0, MAX_VARIABLE_SCOPES)
        .map((scope) =>
          boundedText(scope, MAX_VARIABLE_SCOPE_CHARS),
        )
        .filter((scope): scope is string => Boolean(scope));
      if (
        rawScopes.length > MAX_VARIABLE_SCOPES ||
        scopes.length < Math.min(rawScopes.length, MAX_VARIABLE_SCOPES)
      ) {
        variablesTruncated = true;
      }
      return {
        id,
        name,
        collectionId,
        resolvedType: variableResolvedType(
          item.resolvedType ?? item.type,
        ),
        origin: item.remote === true ? "remote" : "local",
        scopes,
        ...(includeValues && normalizedValues.length > 0
          ? {
              valuesByMode: Object.fromEntries(normalizedValues),
            }
          : {}),
      };
    })
    .filter((item): item is DesignVariableToken => Boolean(item));
  if (variableEntries.length > MAX_VARIABLE_INPUTS) {
    variablesTruncated = true;
    valuesTruncated = true;
  }
  let collectionsTruncated =
    collectionEntries.length > MAX_VARIABLE_COLLECTIONS;
  const collections = collectionEntries
    .slice(0, MAX_VARIABLE_COLLECTIONS)
    .map(([fallbackId, collection], collectionIndex) => {
      const item = record(collection);
      const parsedId =
        boundedText(item?.id, MAX_VARIABLE_ID_CHARS) ??
        boundedText(fallbackId, MAX_VARIABLE_ID_CHARS);
      if (!parsedId) collectionsTruncated = true;
      const id = parsedId ?? `collection:${collectionIndex}`;
      const collectionVariables = normalizedTokens.filter(
        (variable) => variable.collectionId === id,
      );
      const rawModes = array(item?.modes);
      if (rawModes.length > MAX_VARIABLE_MODES) collectionsTruncated = true;
      const defaultModeId = boundedText(
        item?.defaultModeId,
        MAX_VARIABLE_ID_CHARS,
      );
      const declaredTypes = array(item?.resolvedTypes)
        .slice(0, 10)
        .map(variableResolvedType);
      return {
        id,
        name:
          boundedText(item?.name, MAX_VARIABLE_NAME_CHARS) ?? id,
        modes: rawModes
          .slice(0, MAX_VARIABLE_MODES)
          .map((mode) => {
            const modeItem = record(mode);
            const modeId =
              boundedText(modeItem?.modeId, MAX_VARIABLE_ID_CHARS) ??
              boundedText(modeItem?.id, MAX_VARIABLE_ID_CHARS);
            const modeName = boundedText(
              modeItem?.name,
              MAX_VARIABLE_NAME_CHARS,
            );
            if (!modeId || !modeName) collectionsTruncated = true;
            return modeId && modeName
              ? { id: modeId, name: modeName }
              : undefined;
          })
          .filter(
            (mode): mode is { id: string; name: string } => Boolean(mode),
          ),
        ...(defaultModeId ? { defaultModeId } : {}),
        variableCount:
          numberValue(item?.variableCount) ??
          (array(item?.variableIds).length || collectionVariables.length),
        remoteVariables:
          numberValue(item?.remoteVariables) ??
          collectionVariables.filter(
            (variable) => variable.origin === "remote",
          ).length,
        resolvedTypes: [
          ...new Set(
            [
              ...declaredTypes,
              ...collectionVariables.map(
                (variable) => variable.resolvedType,
              ),
            ],
          ),
        ].sort(),
      };
    });
  const inferredVariables = collections.reduce(
    (total, collection) => total + collection.variableCount,
    0,
  );
  const totalCollections =
    numberValue(raw.totalCollections) ??
    numberValue(raw.collectionCount) ??
    collectionEntries.length;
  const totalVariables =
    numberValue(raw.totalVariables) ??
    numberValue(raw.variableCount) ??
    Math.max(variableEntries.length, inferredVariables);
  const variables =
    detailLevel === "expanded"
      ? normalizedTokens.slice(0, MAX_EXPANDED_VARIABLES)
      : [];
  const note = boundedText(raw.note, MAX_VARIABLE_NOTE_CHARS);
  const inputTruncated = record(raw.truncated);
  return {
    availability: "global",
    source,
    detailLevel,
    valuesIncluded: includeValues,
    ...(catalogSyncedAt ? { syncedAt: catalogSyncedAt } : {}),
    totalCollections,
    totalVariables,
    collections,
    variables,
    truncated: {
      collections:
        inputTruncated?.collections === true ||
        collectionsTruncated ||
        collections.length < totalCollections,
      variables:
        inputTruncated?.variables === true ||
        variablesTruncated ||
        (detailLevel === "expanded" &&
          (normalizedTokens.length > MAX_EXPANDED_VARIABLES ||
            variables.length < totalVariables)),
      values: inputTruncated?.values === true || valuesTruncated,
    },
    ...(note ? { note } : {}),
  };
}
