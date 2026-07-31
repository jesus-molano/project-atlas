import type { ActionCenterItem } from "@component-atlas/core/browser";
import type { MemoryFinding } from "@component-atlas/memory";
import type { SourceHealthViewModel } from "@component-atlas/runtime";
import type { AtlasLocale } from "./messages";

export interface LocalizedActionCenterCopy {
  title: string;
  detected: string;
  whyItMatters: string;
  affectedTask: string;
  consequence: string;
  recommendation: string;
  options: Array<{ id: string; label: string; detail?: string }>;
}

export interface LocalizedMemoryFindingCopy {
  title: string;
  recommendation: string;
  question?: string;
}

export interface WorkspaceRiskCopy {
  kind: string;
  title: string;
  recommendation: string;
}

export interface LocalizedSourceHealthCopy {
  label: string;
  detail: string;
}

export function localizeSourceHealth(
  source: SourceHealthViewModel,
  locale: AtlasLocale,
): LocalizedSourceHealthCopy {
  const original = {
    label: source.label,
    detail: source.detail ?? "",
  };
  if (locale === "en") return original;

  const label =
    source.id === "repository"
      ? "Índice del repositorio"
      : source.id === "figma"
        ? "Índice de diseño"
        : source.id === "memory"
          ? "Memoria del proyecto"
          : source.label;
  const counts = original.detail.match(/^(\d+) ([^·]+) · (\d+) (.+)$/u);
  if (counts) {
    const left = Number(counts[1]);
    const right = Number(counts[3]);
    if (source.id === "repository") {
      return {
        label,
        detail: `${left} componente${left === 1 ? "" : "s"} · ${right} ${right === 1 ? "relación" : "relaciones"}`,
      };
    }
    if (source.id === "figma") {
      return {
        label,
        detail: `${left} archivo${left === 1 ? "" : "s"} · ${right} nodo${right === 1 ? "" : "s"} indexado${right === 1 ? "" : "s"}`,
      };
    }
    if (source.id === "memory") {
      return {
        label,
        detail: `${left} elemento${left === 1 ? "" : "s"} · ${right} propuesta${right === 1 ? "" : "s"} pendiente${right === 1 ? "" : "s"}`,
      };
    }
  }

  if (source.id === "figma" && original.detail === "No Figma metadata mapped for this project") {
    return { label, detail: "No hay metadatos de Figma vinculados a este proyecto" };
  }
  if (source.id === "memory" && original.detail === "Cold start · no declared memory yet") {
    return { label, detail: "Inicio en frío · aún no hay memoria declarada" };
  }
  return { label, detail: original.detail };
}

function primaryRule(item: ActionCenterItem): string {
  return item.provenance[0]?.rule ?? "";
}

function evidenceLabel(item: ActionCenterItem, index = 0): string {
  return item.evidence[index]?.label ?? item.title;
}

function designFindingTitle(code: string): string {
  const titles: Readonly<Record<string, string>> = {
    "confirm-design-target": "Confirma el objetivo de diseño",
    "ambiguous-design-target": "El objetivo de diseño es ambiguo",
    "no-design-match": "No se encontró un diseño correspondiente",
    "duplicate-design-pattern": "Posible patrón de diseño duplicado",
    "inconsistent-variants": "Las variantes de diseño son inconsistentes",
    "ready-without-states": "Faltan estados en un diseño listo para desarrollo",
    "figma-code-mismatch": "El diseño indexado y el código no coinciden",
    "suspicious-component-api": "La API del componente requiere revisión",
    "source-contradiction": "Las fuentes de diseño se contradicen",
    "global-variables-unavailable": "Las variables globales no están disponibles",
    "dev-status-unavailable": "El estado de desarrollo no está disponible",
    "naming-inconsistency": "La nomenclatura del diseño es inconsistente",
    "responsive-coverage-gap": "Falta cobertura responsive en el diseño",
    "low-impact-default": "Hallazgo de diseño para revisar",
  };
  return titles[code] ?? "Hallazgo de diseño para revisar";
}

function designFindingRecommendation(code: string): string {
  const recommendations: Readonly<Record<string, string>> = {
    "confirm-design-target":
      "Confirma el nodo o flujo exacto antes de preparar la implementación.",
    "ambiguous-design-target":
      "Elige explícitamente el objetivo correcto y conserva esa decisión con su alcance.",
    "no-design-match":
      "Selecciona otra evidencia de diseño o continúa sin ella dejando constancia del motivo.",
    "duplicate-design-pattern":
      "Compara los patrones, confirma cuál es autoritativo y evita introducir otra variante.",
    "inconsistent-variants":
      "Revisa los estados y propiedades indexados y acuerda una estructura coherente.",
    "ready-without-states":
      "Confirma los estados que faltan o registra que no aplican antes de implementar.",
    "figma-code-mismatch":
      "Compara la evidencia indexada con el componente y decide qué fuente debe gobernar.",
    "suspicious-component-api":
      "Valida la API prevista frente al diseño antes de cambiar el componente.",
    "source-contradiction":
      "Resuelve qué fuente es autoritativa y registra el alcance de la decisión.",
    "global-variables-unavailable":
      "Conecta una fuente con variables disponibles o continúa indicando esta limitación.",
    "dev-status-unavailable":
      "Confirma manualmente la preparación del diseño o continúa indicando esta limitación.",
    "naming-inconsistency":
      "Confirma la nomenclatura prevista antes de crear nuevas variantes o componentes.",
    "responsive-coverage-gap":
      "Confirma el comportamiento de los anchos ausentes antes de implementar.",
    "low-impact-default":
      "Revisa la evidencia indexada y resuelve el hallazgo si afecta a esta tarea.",
  };
  return recommendations[code] ??
    "Revisa la evidencia indexada y resuelve el hallazgo antes de continuar.";
}

/**
 * Localizes only Atlas-authored analysis. Evidence labels, evidence summaries,
 * file names, handles, and user-authored memory remain exactly as indexed.
 */
export function localizeActionCenterItem(
  item: ActionCenterItem,
  locale: AtlasLocale,
): LocalizedActionCenterCopy {
  const original: LocalizedActionCenterCopy = {
    title: item.title,
    detected: item.detected,
    whyItMatters: item.whyItMatters,
    affectedTask: item.affectedTask,
    consequence: item.consequence,
    recommendation: item.recommendation,
    options: item.options?.map((option) => ({ ...option })) ?? [],
  };
  if (locale === "en") return original;

  const rule = primaryRule(item);
  if (rule === "active-memory-contradiction") {
    const left = evidenceLabel(item);
    const right = evidenceLabel(item, 1);
    return {
      title: `${left} entra en conflicto con ${right}`,
      detected:
        "Atlas encontró dos reglas activas de Project Memory que se contradicen.",
      whyItMatters:
        "Ambas reglas no pueden regir la misma implementación sin definir autoridad y alcance de forma explícita.",
      affectedTask: `Cualquier tarea regida por ${item.evidence.map((entry) => entry.id).join(" o ")}`,
      consequence:
        "Una tarea puede aplicar la regla equivocada u oscilar entre resultados incompatibles.",
      recommendation:
        "Compara la procedencia, elige la fuente autoritativa y su alcance, o solicita una aclaración.",
      options: item.evidence.map((entry) => ({
        id: entry.handle,
        label: `${entry.label} es la fuente autoritativa`,
        detail: entry.summary,
      })),
    };
  }

  if (rule === "superseded-memory") {
    return {
      ...original,
      title: evidenceLabel(item),
      detected: "Atlas encontró conocimiento que ya está marcado como sustituido.",
      whyItMatters:
        "Las indicaciones inactivas no deben usarse como contexto vigente.",
      affectedTask: item.affectedTask.startsWith("Tasks should use replacement ")
        ? `Las tareas deben usar la sustitución ${item.affectedTask.slice("Tasks should use replacement ".length)}`
        : "Tareas que recuperan Project Memory",
      consequence:
        "No hay consecuencias mientras los consumidores usen la sustitución activa.",
      recommendation: "Usa la sustitución activa.",
    };
  }

  if (rule === "memory-review-date") {
    const date = item.detected.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    return {
      ...original,
      title: `Revisar ${evidenceLabel(item)}`,
      detected: date
        ? `Ha pasado la fecha de revisión ${date}.`
        : "Ha pasado la fecha de revisión.",
      whyItMatters:
        "La regla guardada puede haber dejado de coincidir con el código o el diseño actual.",
      affectedTask: item.affectedTask === "The current task using this memory item"
        ? "La tarea actual que usa este elemento de memoria"
        : item.affectedTask,
      consequence: "Codex puede basarse en indicaciones desactualizadas.",
      recommendation:
        "Contrasta la memoria con la evidencia actual, añádela como comprobación, posponla o ignórala indicando el motivo.",
    };
  }

  if (rule === "fragile-memory") {
    return {
      ...original,
      title: evidenceLabel(item),
      detected:
        "Atlas relacionó esta área de tarea con una zona frágil, una incidencia conocida o un intento fallido.",
      whyItMatters:
        "Repetir el mismo enfoque puede reproducir un fallo conocido.",
      affectedTask: item.affectedTask === "The current task using this memory item"
        ? "La tarea actual que usa este elemento de memoria"
        : item.affectedTask,
      consequence:
        "La tarea puede provocar una regresión o repetir trabajo ya descartado.",
      recommendation:
        "Revisa la evidencia y después acepta el riesgo o aplaza la decisión de forma explícita.",
    };
  }

  if (rule === "connector-capability") {
    const connector = item.connector ?? item.evidence[0]?.id ?? "conector";
    const state = item.detected.match(/\bis ([\w-]+)\.?$/)?.[1] ?? "";
    const states: Readonly<Record<string, string>> = {
      unavailable: "no está disponible",
      "permission-required": "requiere permiso",
      degraded: "está degradado",
    };
    return {
      ...original,
      title: `La evidencia de ${connector} no está disponible`,
      detected: `El informe local de capacidades indica que ${connector} ${states[state] ?? state}.`,
      whyItMatters:
        "Una tarea que dependa de esta fuente no puede afirmar que verificó sus requisitos o su evidencia de diseño.",
      affectedTask: `Tareas que dependen de ${connector}`,
      consequence:
        "Atlas continuará en un modo degradado claramente indicado y excluirá la evidencia no disponible.",
      recommendation:
        "Conecta o selecciona la fuente, elige un identificador alternativo o continúa sin ella de forma explícita.",
    };
  }

  if (item.source === "design") {
    const file = item.evidence[0]?.label ?? "el diseño indexado";
    const targets = Math.max(1, item.evidence.length - 1);
    return {
      ...original,
      title: designFindingTitle(rule),
      detected: `Atlas aplicó la regla ${rule} a los metadatos de diseño indexados.`,
      // This field is indexed design evidence, so it intentionally remains original.
      whyItMatters: item.whyItMatters,
      affectedTask: `Implementación que usa ${file} y ${targets} objetivo${targets === 1 ? "" : "s"} indexado${targets === 1 ? "" : "s"}`,
      consequence: item.type === "decision-required"
        ? "La implementación no debe continuar hasta resolver la ambigüedad."
        : "La tarea puede desviarse de la intención de diseño indexada.",
      recommendation: designFindingRecommendation(rule),
    };
  }

  return original;
}

export function localizeMemoryFinding(
  finding: MemoryFinding,
  locale: AtlasLocale,
): LocalizedMemoryFindingCopy {
  if (locale === "en") {
    return {
      title: finding.title,
      recommendation: finding.recommendation,
      ...(finding.question ? { question: finding.question } : {}),
    };
  }

  const copy: Readonly<
    Record<
      MemoryFinding["code"],
      { title: string; recommendation: string; question?: string }
    >
  > = {
    "memory-contradiction": {
      title: "Hay memorias activas contradictorias",
      recommendation:
        "Compara la procedencia y elige qué conocimiento es autoritativo antes de aprobar.",
      question: "¿Qué memoria debe regir y con qué alcance?",
    },
    "duplicate-memory": {
      title: "La propuesta duplica conocimiento existente",
      recommendation:
        "Combina o sustituye el elemento existente en lugar de crear una segunda autoridad.",
    },
    "failed-attempt": {
      title: "La propuesta contiene un intento fallido",
      recommendation:
        "Conserva el resultado y sus límites sin promover el enfoque fallido como recomendación.",
    },
    "stale-memory": {
      title: "La propuesta depende de memoria desactualizada",
      recommendation:
        "Contrasta la memoria con la evidencia actual antes de aprobar la propuesta.",
    },
    "superseded-memory": {
      title: "La propuesta hace referencia a memoria sustituida",
      recommendation: "Usa la sustitución activa o explica por qué ya no aplica.",
    },
    "cold-start": {
      title: "Project Memory está en inicio en frío",
      recommendation:
        "Revisa cada elemento propuesto y aprueba solo conocimiento duradero respaldado por evidencia.",
    },
    "secret-like-content": {
      title: "Se detectó contenido parecido a un secreto",
      recommendation:
        "Elimina credenciales, tokens y valores sensibles antes de volver a validar.",
    },
    "low-impact-default": {
      title: "Hallazgo de memoria para revisar",
      recommendation:
        "Revisa la evidencia y confirma si este hallazgo afecta a la propuesta.",
    },
  };
  const localized = copy[finding.code];
  return {
    title: localized.title,
    recommendation: localized.recommendation,
    ...(finding.question || localized.question
      ? { question: localized.question ?? finding.question }
      : {}),
  };
}

export function localizeWorkspaceRisk<T extends WorkspaceRiskCopy>(
  risk: T,
  locale: AtlasLocale,
): Pick<T, "title" | "recommendation"> {
  if (locale === "en") {
    return { title: risk.title, recommendation: risk.recommendation };
  }
  if (risk.kind === "contradiction") {
    const [left, right] = risk.title.split(" conflicts with ");
    return {
      title: right ? `${left} entra en conflicto con ${right}` : risk.title,
      recommendation:
        "Revisa la procedencia y sustituye explícitamente la regla que ya no sea autoritativa.",
    };
  }
  if (risk.kind === "duplicate-design-pattern") {
    return {
      title: designFindingTitle(risk.kind),
      recommendation: designFindingRecommendation(risk.kind),
    };
  }
  if (risk.kind === "inconsistent-variants") {
    return {
      title: designFindingTitle(risk.kind),
      recommendation: designFindingRecommendation(risk.kind),
    };
  }
  if (risk.kind === "stale-knowledge") {
    return {
      title: risk.title.startsWith("Review ")
        ? `Revisar ${risk.title.slice("Review ".length)}`
        : risk.title,
      recommendation:
        "Contrasta este conocimiento con el código o la evidencia de producto actuales.",
    };
  }
  if (risk.kind === "failed-attempt") {
    return {
      title: risk.title,
      recommendation:
        "Comprueba por qué falló el enfoque anterior antes de cambiar esta área.",
    };
  }
  if (risk.kind === "fragile-area" || risk.kind === "known-issue") {
    return {
      title: risk.title,
      recommendation:
        "Inspecciona la evidencia enlazada y las entidades afectadas antes de editar.",
    };
  }
  if (risk.kind === "superseded") {
    return {
      title: risk.title,
      recommendation: "Usa el reemplazo activo.",
    };
  }
  return { title: risk.title, recommendation: risk.recommendation };
}
