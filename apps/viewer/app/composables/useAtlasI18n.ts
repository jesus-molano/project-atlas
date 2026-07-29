import {
  SPANISH_UI_MESSAGES,
  type AtlasLocale,
} from "~/i18n/messages";

export type TranslationParams = Record<string, string | number>;

export function translateAtlasUi(
  locale: AtlasLocale,
  source: string,
  params: TranslationParams = {},
): string {
  const template =
    locale === "es" ? (SPANISH_UI_MESSAGES[source] ?? source) : source;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key)
      ? String(params[key])
      : match,
  );
}

export function isAtlasLocale(value: unknown): value is AtlasLocale {
  return value === "en" || value === "es";
}

export function atlasErrorSource(
  caught: unknown,
  fallback = "An unexpected local error occurred.",
): string {
  let source: string | undefined;
  if (
    typeof caught === "object" &&
    caught !== null &&
    "data" in caught &&
    typeof caught.data === "object" &&
    caught.data !== null &&
    "statusMessage" in caught.data &&
    typeof caught.data.statusMessage === "string"
  ) {
    source = caught.data.statusMessage;
  }
  if (!source && caught instanceof Error && caught.message) {
    source = caught.message;
  }
  if (!source && typeof caught === "string" && caught.trim()) {
    source = caught;
  }
  if (!source) return fallback;
  const compact = source.trim();
  if (
    compact.length > 700 ||
    compact.startsWith("{") ||
    compact.startsWith("[") ||
    /invalid_json_schema|codex_output_schema|response_format|invalid_request_error/iu.test(
      compact,
    )
  ) {
    return fallback;
  }
  return compact;
}

export function translateAtlasRuntimeMessage(
  locale: AtlasLocale,
  source: string,
): string {
  if (locale === "en") return source;
  const direct = SPANISH_UI_MESSAGES[source];
  if (direct) return direct;

  const proposalMissing = source.match(/^Memory proposal "(.+)" was not found\.$/);
  if (proposalMissing) {
    return translateAtlasUi(locale, 'Memory proposal "{id}" was not found.', {
      id: proposalMissing[1] ?? "",
    });
  }
  const proposalState = source.match(
    /^Memory proposal "(.+)" is already ([a-z-]+)\.$/,
  );
  if (proposalState) {
    return translateAtlasUi(
      locale,
      'Memory proposal "{id}" is already {status}.',
      {
        id: proposalState[1] ?? "",
        status: translateAtlasUi(locale, proposalState[2] ?? ""),
      },
    );
  }
  const unresolvedProposal = source.match(
    /^Memory proposal "(.+)" has unresolved decision-required findings and cannot be applied(?:: (.+)|\.)$/,
  );
  if (unresolvedProposal) {
    const base = translateAtlasUi(
      locale,
      'Memory proposal "{id}" has unresolved decision-required findings and cannot be applied.',
      { id: unresolvedProposal[1] ?? "" },
    );
    return unresolvedProposal[2]
      ? `${base.replace(/\.$/u, "")}: ${unresolvedProposal[2]}`
      : base;
  }
  const invalidProposalItem = source.match(
    /^Memory proposal item (\d+) is invalid\.$/,
  );
  if (invalidProposalItem) {
    return translateAtlasUi(locale, "Memory proposal item {index} is invalid.", {
      index: invalidProposalItem[1] ?? "",
    });
  }
  const bulkUnsafe = source.match(/^(.+) is not bulk-safe\.$/);
  if (bulkUnsafe) {
    return translateAtlasUi(locale, "{command} is not bulk-safe.", {
      command: translateAtlasUi(locale, bulkUnsafe[1] ?? ""),
    });
  }
  const commandNotAllowed = source.match(
    /^(.+) is not allowed for ([a-z-]+)\.$/,
  );
  if (commandNotAllowed) {
    return translateAtlasUi(locale, "{command} is not allowed for {type}.", {
      command: translateAtlasUi(locale, commandNotAllowed[1] ?? ""),
      type: translateAtlasUi(locale, commandNotAllowed[2] ?? ""),
    });
  }
  const commandNotBulk = source.match(/^(.+) cannot be applied in bulk\.$/);
  if (commandNotBulk) {
    return translateAtlasUi(locale, "{command} cannot be applied in bulk.", {
      command: translateAtlasUi(locale, commandNotBulk[1] ?? ""),
    });
  }
  const figmaTargetMissing = source.match(
    /^The confirmed Figma target (.+) has not been synchronized\. Map this exact target through Figma Desktop MCP before context retrieval; Atlas candidates cannot replace it\.$/u,
  );
  if (figmaTargetMissing) {
    return translateAtlasUi(
      locale,
      "The confirmed Figma target {target} has not been synchronized. Map this exact target through Figma Desktop MCP before context retrieval; Atlas candidates cannot replace it.",
      { target: figmaTargetMissing[1] ?? "" },
    );
  }
  const figmaFileReceiptMissing = source.match(
    /^The confirmed Figma file (.+) has no exact current source receipt\. Synchronize that file through the confirmed adapter before context retrieval\.$/u,
  );
  if (figmaFileReceiptMissing) {
    return translateAtlasUi(
      locale,
      "The confirmed Figma file {fileKey} has no exact current source receipt. Synchronize that file through the confirmed adapter before context retrieval.",
      { fileKey: figmaFileReceiptMissing[1] ?? "" },
    );
  }
  const openApiConflict = source.match(
    /^Required OpenAPI contracts conflict for ([A-Z]+) (.+)\. Confirm the governing contract or version before context retrieval\.$/u,
  );
  if (openApiConflict) {
    return translateAtlasUi(
      locale,
      "Required OpenAPI contracts conflict for {method} {path}. Confirm the governing contract or version before context retrieval.",
      { method: openApiConflict[1] ?? "", path: openApiConflict[2] ?? "" },
    );
  }
  const openApiUnavailable = source.match(
    /^A required OpenAPI contract could not be resolved \((receipt-[a-f0-9]{16})\)\. (.+)$/u,
  );
  if (openApiUnavailable) {
    const prefix = translateAtlasUi(
      locale,
      "A required OpenAPI contract could not be resolved ({receiptId}).",
      { receiptId: openApiUnavailable[1] ?? "" },
    );
    return `${prefix} ${openApiUnavailable[2] ?? ""}`;
  }

  // Validation can join several Atlas-owned sentences into one status message.
  // Translate only known catalog entries; arbitrary external/user text remains raw.
  let localized = source;
  const sentences = Object.entries(SPANISH_UI_MESSAGES)
    .filter(([key]) => key.endsWith(".") && key.length >= 16)
    .sort(([left], [right]) => right.length - left.length);
  for (const [key, value] of sentences) {
    localized = localized.replaceAll(key, value);
  }
  return localized;
}

export function useAtlasI18n() {
  const localeCookie = useCookie<AtlasLocale>("project-atlas-locale", {
    default: () => "en",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  const locale = useState<AtlasLocale>("project-atlas-locale", () =>
    isAtlasLocale(localeCookie.value) ? localeCookie.value : "en",
  );

  watch(
    locale,
    (value) => {
      localeCookie.value = value;
    },
    { immediate: true },
  );

  useHead(() => ({
    htmlAttrs: {
      lang: locale.value,
    },
  }));

  const t = (source: string, params?: TranslationParams) =>
    translateAtlasUi(locale.value, source, params);
  const statusLabel = (value: string) => {
    if (value === "clear") return t("No blockers");
    if (locale.value === "es" && SPANISH_UI_MESSAGES[value]) {
      return t(value);
    }
    return t(
      value
        .replaceAll("_", " ")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase()),
    );
  };
  const runtimeMessage = (
    caught: unknown,
    fallback = "An unexpected local error occurred.",
  ) =>
    translateAtlasRuntimeMessage(
      locale.value,
      atlasErrorSource(caught, fallback),
    );
  const formatDate = (value: string | undefined) => {
    if (!value) return t("not indexed");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale.value === "es" ? "es-ES" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };
  const formatNumber = (value: number) =>
    new Intl.NumberFormat(locale.value === "es" ? "es-ES" : "en-US").format(
      value,
    );
  const setLocale = (value: AtlasLocale) => {
    locale.value = value;
  };

  return {
    formatDate,
    formatNumber,
    locale,
    runtimeMessage,
    setLocale,
    statusLabel,
    t,
  };
}
