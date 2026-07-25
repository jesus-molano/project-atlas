import { tokenize } from "@component-atlas/core";
import type {
  DesignDecisionGate,
  DesignFileIndex,
  DesignFinding,
  DesignIndexNode,
} from "./types.js";

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function canonicalVariantName(value: string): string {
  const devices = new Set([
    "mobile",
    "desktop",
    "tablet",
    "phone",
    "web",
    "ios",
    "android",
    "movil",
  ]);
  return tokenize(normalized(value))
    .filter((token) => !devices.has(token))
    .join(" ");
}

function findingId(code: DesignFinding["code"], nodeIds: string[] = []): string {
  return `${code}:${nodeIds.slice().sort().join(",") || "file"}`;
}

export function decisionGate(findings: DesignFinding[]): DesignDecisionGate {
  const questions = findings
    .filter(
      (finding): finding is DesignFinding & { question: string } =>
        finding.level === "decision-required" && Boolean(finding.question),
    )
    .map((finding) => ({
      findingId: finding.id,
      question: finding.question,
      evidence: finding.evidence,
      recommendation: finding.recommendation,
    }));
  return {
    status:
      questions.length > 0
        ? "blocked"
        : findings.some((finding) => finding.level === "warning")
          ? "review"
          : "clear",
    questions,
  };
}

function duplicateFindings(index: DesignFileIndex): DesignFinding[] {
  const groups = new Map<string, DesignIndexNode[]>();
  for (const node of index.nodes) {
    const key = `${node.pageId}:${normalized(node.name)}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .slice(0, 5)
    .map((group) => {
      const nodeIds = group.map((node) => node.id);
      return {
        id: findingId("duplicate-design-pattern", nodeIds),
        level: "warning",
        code: "duplicate-design-pattern",
        title: `Possible duplicate design pattern: ${group[0]?.name ?? "unnamed"}`,
        evidence: group.map(
          (node) => `${node.path.join(" / ")} (${node.id}, ${node.devStatus})`,
        ),
        recommendation:
          "Compare responsibilities and states before treating these frames as separate implementations; mark true device/state variants explicitly.",
        nodeIds,
      };
    });
}

function inconsistentVariantFindings(index: DesignFileIndex): DesignFinding[] {
  const groups = new Map<string, DesignIndexNode[]>();
  for (const node of index.nodes) {
    const canonical = canonicalVariantName(node.name);
    if (!canonical) continue;
    const key = `${node.pageId}:${node.parentId ?? "page"}:${canonical}`;
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => {
      if (group.length < 2) return false;
      return new Set(group.map((node) => node.devStatus)).size > 1;
    })
    .slice(0, 5)
    .map((group) => {
      const nodeIds = group.map((node) => node.id);
      return {
        id: findingId("inconsistent-variants", nodeIds),
        level: "warning",
        code: "inconsistent-variants",
        title: `Related variants have inconsistent dev status: ${canonicalVariantName(group[0]?.name ?? "")}`,
        evidence: group.map(
          (node) => `${node.name}: ${node.devStatus} (${node.id})`,
        ),
        recommendation:
          "Confirm which device/state variants belong to the same delivery and align their Ready for dev or Completed status.",
        nodeIds,
      };
    });
}

function readyWithoutStatesFindings(index: DesignFileIndex): DesignFinding[] {
  const statePattern =
    /error|loading|empty|disabled|success|pending|focus|hover|pressed|invalid|estado|cargando|vacio/i;
  const interactivePattern =
    /form|dialog|modal|checkout|search|input|login|signup|payment|coupon|promo/i;
  return index.nodes
    .filter(
      (node) =>
        node.devStatus === "ready-for-dev" &&
        interactivePattern.test(node.name) &&
        !statePattern.test(node.name) &&
        node.childIds.length === 0 &&
        node.variantProperties.length === 0,
    )
    .slice(0, 5)
    .map((node) => ({
      id: findingId("ready-without-states", [node.id]),
      level: "warning",
      code: "ready-without-states",
      title: `Ready for dev frame may omit relevant states: ${node.name}`,
      evidence: [
        `${node.path.join(" / ")} is Ready for dev.`,
        "No indexed child state or variant property was exposed by the sparse metadata.",
      ],
      recommendation:
        "When this node is confirmed, inspect its deep context and ask only about missing loading, error, empty, disabled, or responsive states that affect implementation.",
      nodeIds: [node.id],
    }));
}

export function designIndexFindings(index: DesignFileIndex): DesignFinding[] {
  const findings = [
    ...duplicateFindings(index),
    ...inconsistentVariantFindings(index),
    ...readyWithoutStatesFindings(index),
  ];
  if (index.variables.availability !== "global") {
    findings.push({
      id: findingId("global-variables-unavailable"),
      level: "resolved",
      code: "global-variables-unavailable",
      title: "Global Figma variables are not available in this index",
      evidence: [
        index.variables.note ??
          "The current integration did not provide file-level variable collections.",
      ],
      recommendation:
        "Continue with the lightweight map and retrieve exact variables with get_variable_defs only after a node is confirmed.",
    });
  }
  return findings;
}
