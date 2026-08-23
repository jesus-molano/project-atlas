import {
  buildComponentContext,
  buildReuseContext,
  SOURCE_RECEIPT_SCHEMA_VERSION,
  tokenize,
  type SourceReceipt,
  type TaskContextSourcePolicy,
} from "@component-atlas/core";
import {
  decisionGate,
  parseFigmaReference,
  rankDesignCandidates,
  resolveExplicitDesignTarget,
  type DesignFinding,
} from "@component-atlas/design";
import {
  fitBudgetedResponse,
  rankMemoryItems,
} from "@component-atlas/memory";
import { loadProjectGraph } from "./scan.js";
import {
  loadConfirmedOpenApiContext,
  type ConfirmedOpenApiSource,
  type OpenApiTaskContext,
  type OpenApiSourceResolver,
} from "./openapi.js";
import {
  persistSourceReceipts,
} from "./task-state.js";
import {
  claimTaskRetrieval,
  completeTaskRetrieval,
  loadTaskRetrievalResult,
  reuseRetrievalKey,
  type TaskRetrievalInvalidationReason,
} from "./task-execution.js";
import {
  boundedLimit,
  memoryStore,
  graphCheckoutId,
  ensureMemoryIndexed,
  indexProjectMemory,
  memoryGate,
  findingsForMemory,
} from "./memory.js";

function compactTaskReuseContext(
  reuse: ReturnType<typeof buildReuseContext>,
): ReturnType<typeof buildReuseContext> {
  const candidates = reuse.candidates.map((candidate) => ({
    rank: candidate.rank,
    component: candidate.component,
    match: candidate.match,
    impact: {
      directConsumers: candidate.impact.directConsumers,
      transitiveConsumers: candidate.impact.transitiveConsumers,
      direct: [],
    },
    api: { props: [], totalProps: 0, events: [], totalEvents: 0, slots: [], models: [] },
    relations: { renders: [], renderedBy: [], similar: [] },
    tests: [],
  }));
  const areas = reuse.areas ?? [
    ...new Map(
      candidates.map((candidate) => {
        const id = candidate.component.owner ?? "unowned";
        const matching = candidates.filter(
          (item) => (item.component.owner ?? "unowned") === id,
        );
        return [
          id,
          {
            id,
            candidateCount: matching.length,
            topCandidateIds: matching.slice(0, 3).map((item) => item.component.id),
          },
        ];
      }),
    ).values(),
  ];
  return { ...reuse, areas, candidates };
}

export async function getTaskContext(
  rootPath: string,
  task: string,
  options: {
    figmaFile?: string;
    budgetChars?: number;
    refreshMemory?: boolean;
    topK?: number;
    selectedHandles?: string[];
    sourcePolicy?: TaskContextSourcePolicy;
    confirmedFigmaReferences?: string[];
    confirmedOpenApiReferences?: string[];
    confirmedOpenApiSources?: ConfirmedOpenApiSource[];
    currentOpenApiReceipts?: SourceReceipt[];
    openApiResolver?: OpenApiSourceResolver;
    preloadedOpenApiContext?: OpenApiTaskContext;
    taskId?: string;
    retrievalInvalidationReason?: TaskRetrievalInvalidationReason;
    sourceLedgerHash?: string;
    sourceWarnings?: string[];
  } = {},
) {
  const graph = await loadProjectGraph(rootPath);
  if (options.refreshMemory) await indexProjectMemory(rootPath);
  else await ensureMemoryIndexed(rootPath, graph);
  const store = memoryStore(graph);
  try {
    const topK = boundedLimit(options.topK, 3);
    const selectedHandles = [...new Set(options.selectedHandles ?? [])]
      .filter((handle) => /^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/.test(handle))
      .slice(0, 8);
    const selectedCodeIds = selectedHandles
      .filter((handle) => handle.startsWith("code:"))
      .map((handle) => handle.slice("code:".length));
    const selectedMemorySelectors = selectedHandles
      .filter((handle) => handle.startsWith("memory:"))
      .flatMap((handle) => [handle, handle.slice("memory:".length)]);
    const selectedDesign = selectedHandles
      .filter((handle) => handle.startsWith("design:"))
      .map((handle) => handle.slice("design:".length))
      .map((handle) => {
        const separator = handle.indexOf("::");
        return separator > 0
          ? { fileKey: handle.slice(0, separator), nodeId: handle.slice(separator + 2) }
          : { fileKey: handle };
      })[0];
    const memoryCandidates = store.searchMemoryCandidates(
      graph.project.id,
      task,
      100,
      graphCheckoutId(graph),
    );
    const selectedMemory = store
      .listMemoryItems(graph.project.id, graphCheckoutId(graph))
      .filter((item) => selectedMemorySelectors.includes(item.id))
      .map((item) => ({
        item,
        score: 1,
        reasons: ["Selected in Project Atlas"],
      }));
    const rankedMemory = [
      ...selectedMemory,
      ...rankMemoryItems(memoryCandidates, task),
    ]
      .filter(
        (candidate, index, collection) =>
          collection.findIndex((item) => item.item.id === candidate.item.id) === index,
      )
      .slice(0, topK);
    let reuse: ReturnType<typeof buildReuseContext>;
    if (options.taskId) {
      const claim = await claimTaskRetrieval(rootPath, {
        taskId: options.taskId,
        kind: "reuse",
        key: reuseRetrievalKey({
          projectId: graph.project.id,
          intent: task,
          ...(graph.project.identity?.checkoutId
            ? { checkoutId: graph.project.identity.checkoutId }
            : {}),
          ...(graph.project.scan?.fingerprint
            ? { graphFingerprint: graph.project.scan.fingerprint }
            : {}),
          ...(options.sourceLedgerHash
            ? { sourceLedgerHash: options.sourceLedgerHash }
            : {}),
        }),
        ...(options.retrievalInvalidationReason
          ? { invalidationReason: options.retrievalInvalidationReason }
          : {}),
      });
      if (claim.status === "cached") {
        reuse = compactTaskReuseContext(
          (await loadTaskRetrievalResult(
            rootPath,
            claim.handle,
          )) as ReturnType<typeof buildReuseContext>,
        );
      } else {
        reuse = compactTaskReuseContext(buildReuseContext(graph, task, topK));
        await completeTaskRetrieval(rootPath, claim.handle, reuse);
      }
    } else {
      reuse = compactTaskReuseContext(buildReuseContext(graph, task, topK));
    }
    const indexes = store.listDesignIndexes(graph.project.id);
    const designAllowed =
      options.sourcePolicy === undefined ||
      options.sourcePolicy.confirmedKinds.includes("figma");
    const openApiAllowed =
      options.sourcePolicy === undefined
        ? (options.confirmedOpenApiReferences?.length ?? 0) > 0
        : options.sourcePolicy.confirmedKinds.includes("openapi");
    const api = openApiAllowed
      ? options.preloadedOpenApiContext ??
        (await loadConfirmedOpenApiContext(
          rootPath,
          task,
          options.confirmedOpenApiSources ??
            options.confirmedOpenApiReferences ??
            [],
          options.openApiResolver,
          options.currentOpenApiReceipts,
        ))
      : undefined;
    const confirmedFigmaTargets = (
      options.confirmedFigmaReferences ?? []
    ).flatMap((reference) => {
      try {
        return [{ reference, ...parseFigmaReference(reference) }];
      } catch {
        return [];
      }
    });
    const confirmedFigmaKeys = new Set(
      confirmedFigmaTargets.map((target) => target.fileKey),
    );
    const directFigmaTargets = confirmedFigmaTargets.filter(
      (target): target is typeof target & { nodeId: string } =>
        Boolean(target.nodeId),
    );
    const relatedFigmaScopes = (options.sourcePolicy?.relations ?? [])
      .filter(
        (relation) =>
          relation.targetScope?.provider === "figma" &&
          ["node", "selection"].includes(relation.targetScope?.kind ?? ""),
      )
      .map((relation) => relation.targetScope!)
      .filter(
        (scope, index, collection) =>
          collection.findIndex((candidate) => candidate.id === scope.id) ===
          index,
      );
    const relatedDirectTarget =
      confirmedFigmaTargets.length === 1 && relatedFigmaScopes.length === 1
        ? {
            ...confirmedFigmaTargets[0]!,
            nodeId: relatedFigmaScopes[0]!.id,
          }
        : undefined;
    const effectiveDirectFigmaTargets = relatedDirectTarget
      ? [relatedDirectTarget]
      : directFigmaTargets;
    const selectedDirectTarget =
      effectiveDirectFigmaTargets.length === 1
        ? effectiveDirectFigmaTargets[0]
        : selectedDesign?.nodeId
          ? effectiveDirectFigmaTargets.find(
              (target) =>
                target.fileKey === selectedDesign.fileKey &&
                target.nodeId === selectedDesign.nodeId,
            )
          : undefined;
    const eligibleIndexes =
      options.sourcePolicy === undefined
        ? indexes
        : indexes.filter((index) => confirmedFigmaKeys.has(index.file.key));
    const selectedIndex = !designAllowed
      ? undefined
      : selectedDirectTarget
        ? eligibleIndexes.find(
            (index) => index.file.key === selectedDirectTarget.fileKey,
          )
      : options.figmaFile
        ? eligibleIndexes.find(
            (index) =>
              index.file.key === options.figmaFile ||
              index.file.url === options.figmaFile,
          )
        : selectedDesign
          ? eligibleIndexes.find(
              (index) => index.file.key === selectedDesign.fileKey,
            )
          : eligibleIndexes.length === 1
            ? eligibleIndexes[0]
            : undefined;
    const designIdentityFindings: DesignFinding[] =
      effectiveDirectFigmaTargets.length > 1 && !selectedDirectTarget
        ? [
            {
              id: "source-contradiction:multiple-explicit-figma-targets",
              level: "decision-required",
              code: "source-contradiction",
              title: "Multiple explicit Figma nodes are confirmed as the target",
              evidence: effectiveDirectFigmaTargets
                .slice(0, 5)
                .map((target) => `${target.fileKey}::${target.nodeId}`),
              recommendation:
                "Select one exact target or explicitly define how the confirmed nodes form one implementation scope.",
              question: "Which confirmed Figma node is the implementation target?",
              nodeIds: effectiveDirectFigmaTargets.map(
                (target) => target.nodeId,
              ),
            },
          ]
        : selectedDirectTarget && !selectedIndex
          ? [
              {
                id: `explicit-target-missing:${selectedDirectTarget.fileKey}:${selectedDirectTarget.nodeId}`,
                level: "decision-required",
                code: "explicit-target-missing",
                title: "The confirmed Figma target has not been synchronized",
                evidence: [
                  `${selectedDirectTarget.fileKey}::${selectedDirectTarget.nodeId}`,
                ],
                recommendation:
                  "Map this exact node through Figma Desktop MCP. Do not use a cached candidate from another file or node.",
                question:
                  "Can the exact confirmed Figma node be synchronized before continuing?",
                nodeIds: [selectedDirectTarget.nodeId],
              },
            ]
          : [];
    const design = selectedIndex
      ? selectedDirectTarget
        ? resolveExplicitDesignTarget(
            selectedIndex,
            selectedDirectTarget.nodeId,
          )
        : rankDesignCandidates(selectedIndex, task, {
            limit: topK,
            codeSignals: reuse.candidates.map(
              (candidate) => candidate.component.name,
            ),
          })
      : undefined;
    const memoryFindings = findingsForMemory(
      rankMemoryItems(memoryCandidates, task, {
        includeInactive: true,
      }),
    );
    const designFindings: DesignFinding[] = [
      ...designIdentityFindings,
      ...(design?.findings ?? []),
    ];
    const apiFindings = [
      ...(api?.conflicts.map((conflict) => ({
        id: conflict.id,
        level: "decision-required" as const,
        code: "source-contradiction" as const,
        title: `${conflict.method} ${conflict.path} differs across confirmed OpenAPI contracts`,
        evidence: conflict.receiptIds,
        recommendation:
          "Confirm which exact contract/version governs this operation. Atlas will not merge incompatible definitions.",
        question: `Which confirmed contract governs ${conflict.method} ${conflict.path}?`,
        source: "api" as const,
      })) ?? []),
      ...(api?.errors.map((failure) => ({
        id: `openapi-source-error:${failure.receiptId}`,
        level: failure.required ? ("decision-required" as const) : ("warning" as const),
        code: "source-unavailable" as const,
        title: failure.required
          ? "A required OpenAPI contract could not be resolved"
          : "An optional OpenAPI source is unavailable",
        evidence: [
          failure.receiptId,
          ...(failure.httpStatus ? [`HTTP ${failure.httpStatus}`] : []),
          failure.message,
          "Repository clients, types, and tests remain available as bounded secondary evidence.",
        ],
        recommendation: failure.required
          ? "Confirm cached repository evidence for only the contract-dependent scope, or provide a local specification."
          : "Continue with repository evidence and retain this structured source warning.",
        ...(failure.required
          ? {
              question:
                "Use cached repository evidence for the blocked contract scope, or provide a local specification?",
            }
          : {}),
        source: "api" as const,
      })) ?? []),
    ];
    const findings = [
      ...memoryFindings,
      ...designFindings.map((finding) => ({
        ...finding,
        source: "design" as const,
      })),
      ...apiFindings,
    ];
    const gate = {
      memory: memoryGate(memoryFindings),
      design:
        design || designIdentityFindings.length > 0
          ? decisionGate(designFindings)
          : { status: "clear", questions: [] },
      api: {
        status: apiFindings.some((finding) => finding.level === "decision-required")
          ? ("blocked" as const)
          : apiFindings.length > 0
            ? ("review" as const)
            : ("clear" as const),
        questions: apiFindings.flatMap((finding) => finding.question ? [finding.question] : []),
      },
    };
    const overallGate = {
      status:
        gate.memory.status === "blocked" ||
        gate.design.status === "blocked" ||
         gate.api.status === "blocked"
          ? ("blocked" as const)
            : gate.memory.status === "review" ||
              gate.design.status === "review" ||
              gate.api.status === "review"
            ? ("review" as const)
            : ("clear" as const),
      questions: [
        ...gate.memory.questions,
        ...gate.design.questions,
        ...gate.api.questions,
      ],
    };
    const selectedCode = selectedCodeIds
      .filter((id) => graph.components.some((component) => component.id === id))
      .map((id) => buildComponentContext(graph, id))
      .map((item) => ({
        id: item.component.id,
        name: item.component.name,
        path: item.component.path,
        scope: item.component.scope,
        kind: item.component.kind,
        role: item.component.role,
        runtime: item.component.runtime,
        routePath: item.component.routePath,
        reasons: ["Selected in Project Atlas"],
        directConsumers: item.impact.directConsumers,
        transitiveConsumers: item.impact.transitiveConsumers,
      }));
    const codeCandidates = [
      ...selectedCode,
      ...reuse.candidates.map((candidate) => ({
        id: candidate.component.id,
        name: candidate.component.name,
        path: candidate.component.path,
        scope: candidate.component.scope,
        kind: candidate.component.kind,
        role: candidate.component.role,
        runtime: candidate.component.runtime,
        routePath: candidate.component.routePath,
        reasons: candidate.match.reasons.slice(0, 2),
        directConsumers: candidate.impact.directConsumers,
        transitiveConsumers: candidate.impact.transitiveConsumers,
      })),
      ]
      .filter(
        (candidate, index, collection) =>
          collection.findIndex((item) => item.id === candidate.id) === index,
      )
      .slice(0, topK);
    const taskTokens = new Set(tokenize(task));
    const codeCandidateIds = new Set(codeCandidates.map((candidate) => candidate.id));
    const relevantDecisions = store
      .listDecisions(graph.project.id, graphCheckoutId(graph))
      .filter((decision) => decision.status !== "superseded")
      .map((decision) => ({
        decision,
        score:
          (decision.taskId && decision.taskId === options.taskId ? 100 : 0) +
          decision.selectedComponentIds.filter((id) => codeCandidateIds.has(id)).length * 20 +
          tokenize(`${decision.intent} ${decision.rationale}`)
            .filter((term) => taskTokens.has(term)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.decision.createdAt.localeCompare(left.decision.createdAt),
      )
      .slice(0, topK)
      .map(({ decision }) => ({
        id: decision.id,
        taskId: decision.taskId,
        decision: decision.decision,
        intent: decision.intent,
        selectedComponentIds: decision.selectedComponentIds,
        rationale: decision.rationale,
      }));
    const taskTerms = new Set(tokenize(task));
    const candidateIds = new Set(codeCandidates.map((candidate) => candidate.id));
    const linkedEntityIds = new Set(
      graph.edges
        .filter((edge) => candidateIds.has(edge.source))
        .map((edge) => edge.target),
    );
    const semanticEntities = graph.entities
      .map((entity) => ({
        entity,
        score:
          (linkedEntityIds.has(entity.id) ? 4 : 0) +
          tokenize(
            `${entity.name} ${entity.relativePath} ${entity.endpoint?.path ?? ""} ${entity.endpoint?.operationId ?? ""}`,
          ).filter((term) => taskTerms.has(term)).length,
      }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.entity.id.localeCompare(right.entity.id),
      )
      .slice(0, Math.min(6, topK + 2))
      .map(({ entity }) => entity);
    const semanticEntityIds = new Set(
      semanticEntities.map((entity) => entity.id),
    );
    const semanticRelations = graph.edges
      .filter(
        (edge) =>
          semanticEntityIds.has(edge.source) ||
          semanticEntityIds.has(edge.target),
      )
      .slice(0, 12)
      .map((edge) => ({
        kind: edge.kind,
        source: edge.source,
        target: edge.target,
        resolution: edge.resolution,
        provenance: edge.provenance,
      }));
    const rankedDesignCandidates =
      design?.candidates.map((candidate) => ({
        id: candidate.node.id,
        name: candidate.node.name,
        url: candidate.node.url,
        origin: candidate.origin,
        sourceReceiptIds: candidate.sourceReceiptIds,
        status: candidate.node.status,
        statusAvailability: candidate.node.statusAvailability,
        pageStatus: candidate.node.pageStatus,
        pageStatusAvailability: candidate.node.pageStatusAvailability,
        confidence: candidate.confidence,
        reasons: candidate.reasons.slice(0, 3),
      })) ?? [];
    const selectedDesignNode =
      selectedIndex && selectedDesign?.nodeId
        ? selectedIndex.nodes.find((node) => node.id === selectedDesign.nodeId)
        : undefined;
    const selectedDesignPage = selectedDesignNode
      ? selectedIndex?.pages.find((page) => page.id === selectedDesignNode.pageId)
      : undefined;
    const designCandidates = [
      ...(selectedDesignNode
        ? [
            {
              id: selectedDesignNode.id,
              name: selectedDesignNode.name,
              url: selectedDesignNode.url,
              origin: "user-confirmed-target" as const,
              sourceReceiptIds: selectedDesignNode.sourceReceiptIds,
              status: selectedDesignNode.devStatus,
              statusAvailability: selectedDesignNode.devStatusAvailability,
              pageStatus: selectedDesignPage?.devStatus ?? "none",
              pageStatusAvailability:
                selectedDesignPage?.devStatusAvailability ?? "source-unavailable",
              confidence: "high" as const,
              reasons: ["Selected in Project Atlas"],
            },
          ]
        : []),
      ...rankedDesignCandidates,
    ]
      .filter(
        (candidate, index, collection) =>
          collection.findIndex((item) => item.id === candidate.id) === index,
      )
      .slice(0, topK);
    const designReceiptIds = new Set(
      designCandidates.flatMap((candidate) => candidate.sourceReceiptIds),
    );
    const sourceReceipts = [
      ...(selectedIndex?.sources
        .map((source) => source.receipt)
        .filter((receipt) => designReceiptIds.has(receipt.id)) ?? []),
      ...(api?.receipts ?? []),
    ]
      .filter(
        (receipt) => receipt.schemaVersion === SOURCE_RECEIPT_SCHEMA_VERSION,
      )
      .filter(
        (receipt, index, collection) =>
          collection.findIndex((candidate) => candidate.id === receipt.id) ===
          index,
      );
    await persistSourceReceipts(rootPath, sourceReceipts);
    const payload = {
      schemaVersion: 1,
      task: task.trim(),
      sourcePolicy: options.sourcePolicy ?? {
        scope: "task" as const,
        confirmedKinds: selectedIndex ? (["figma"] as const) : [],
        omittedKinds: [],
        unavailableKinds: [],
      },
      project: {
        name: graph.project.name,
        framework: graph.project.framework,
        scannedAt: graph.project.scannedAt,
        ...(graph.project.profile
          ? {
              profile: {
                frameworks: graph.project.profile.frameworks,
                metaFrameworks: [
                  ...new Set(
                    graph.project.profile.packages.flatMap((packageProfile) =>
                      packageProfile.metaFramework
                        ? [packageProfile.metaFramework]
                        : [],
                    ),
                  ),
                ],
                confidence: graph.project.profile.confidence,
                ...(graph.project.scan?.coverage
                  ? {
                      coverage: {
                        candidateFiles:
                          graph.project.scan.coverage.candidateFiles,
                        parsedFiles: graph.project.scan.coverage.parsedFiles,
                        skippedFiles:
                          graph.project.scan.coverage.skippedFiles,
                        errorFiles: graph.project.scan.coverage.errorFiles,
                        complete: graph.project.scan.coverage.complete,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      memory: rankedMemory.slice(0, topK).map(({ item, score, reasons }) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        authority: item.authority,
        confidence: item.confidence,
        score,
        reasons: reasons.slice(0, 2),
      })),
      ...(relevantDecisions.length > 0
        ? { decisions: relevantDecisions }
        : {}),
      selections: selectedHandles,
      reuse: { areas: reuse.areas ?? [] },
      code: codeCandidates,
      semantic: {
        entities: semanticEntities.map((entity) => ({
          id: entity.id,
          handle: `entity:${entity.id}`,
          kind: entity.kind,
          name: entity.name,
          path: entity.relativePath,
          resolution: entity.resolution,
          endpoint: entity.endpoint,
        })),
        relations: semanticRelations,
      },
      design: {
        available: Boolean(selectedIndex),
        ...(selectedDirectTarget
          ? {
              explicitTarget: {
                fileKey: selectedDirectTarget.fileKey,
                nodeId: selectedDirectTarget.nodeId,
                status:
                  designCandidates[0]?.origin === "user-confirmed-target"
                    ? ("verified" as const)
                    : ("blocked" as const),
              },
            }
          : {}),
        ...(indexes.length > 1 && !selectedIndex
          ? {
              selectionRequired: true,
              files: indexes.slice(0, 5).map((index) => ({
                key: index.file.key,
                name: index.file.name,
              })),
            }
          : {}),
        candidates: designCandidates,
      },
      sourceReceiptIds: sourceReceipts.map((receipt) => receipt.id),
      ...(options.sourceWarnings?.length
        ? { sourceWarnings: options.sourceWarnings.slice(0, 4) }
        : {}),
      ...(api
        ? {
            api: {
              available: api.available,
              format: api.format,
              contracts: api.contracts,
              operationIndex: api.operations.map(
                ({ method, path, operationId, sourceReceiptIds }) => ({
                  method,
                  path,
                  ...(operationId ? { operationId } : {}),
                  sourceReceiptIds,
                }),
              ),
              operations: api.operations,
              authentication: api.authentication,
              conflicts: api.conflicts,
              errors: api.errors.map(
                ({
                  receiptId,
                  message,
                  required,
                  recoverableWithConnector,
                }) => ({
                  receiptId,
                  message,
                  required,
                  recoverableWithConnector,
                }),
              ),
            },
          }
        : {}),
      findings: findings.slice(0, 8),
      gate: { ...gate, overall: overallGate },
      nextSteps: [
        "Expand only the memory or component IDs needed for the decision.",
        "Run check_before_change on the chosen files before editing.",
        "After validation, close the technical task without writing memory implicitly.",
      ],
    };
    const responseBudget = options.budgetChars ?? 4_200;
    // Below the normal 3.2-3.6K task bundle, omit repository-profile detail
    // that is already available through project/entity handles. Keeping the
    // full object shell at 2K can otherwise consume the budget even after all
    // candidate arrays have been shortened.
    const responsePayload =
      responseBudget <= 2_400
        ? {
            schemaVersion: payload.schemaVersion,
            task: payload.task,
            sourcePolicy: payload.sourcePolicy,
            project: {
              name: payload.project.name,
              framework: payload.project.framework,
            },
            memory: payload.memory,
            ...(payload.decisions ? { decisions: payload.decisions } : {}),
            selections: payload.selections,
            reuse: payload.reuse,
            code: payload.code,
            ...(payload.semantic.entities.length > 0 ||
            payload.semantic.relations.length > 0
              ? { semantic: payload.semantic }
              : {}),
            design: payload.design,
            sourceReceiptIds: payload.sourceReceiptIds,
            ...(payload.sourceWarnings
              ? { sourceWarnings: payload.sourceWarnings }
              : {}),
            ...(payload.api ? { api: payload.api } : {}),
            findings: payload.findings,
            gate: payload.gate,
            nextSteps: payload.nextSteps.slice(0, 1),
          }
        : payload;
    return fitBudgetedResponse(responsePayload, {
      budgetChars: responseBudget,
      totalMatches:
        memoryCandidates.length +
        reuse.candidates.length +
        (design?.candidates.length ?? 0) +
        (api?.operations.length ?? 0),
      expandableIds: [
        ...selectedCodeIds.map((id) => `code:${id}`),
        ...rankedMemory.map(({ item }) =>
          item.id.startsWith("memory:") ? item.id : `memory:${item.id}`,
        ),
        ...reuse.candidates.map(
          (candidate) => `code:${candidate.component.id}`,
        ),
        ...semanticEntities.map((entity) => `entity:${entity.id}`),
        ...(design?.candidates.map(
          (candidate) => `design:${candidate.node.id}`,
        ) ?? []),
      ],
      preserveKeys: [
        "findings",
        "questions",
        "decisions",
        "selections",
        "reuse",
        "areas",
        "sourceReceiptIds",
        "sourceWarnings",
        "operationIndex",
      ],
      preserveFirstKeys: ["memory", "code", "candidates", "operations"],
      retrieval: {
        indexedBytesInjected: 0,
        hits:
          rankedMemory.length +
          codeCandidates.length +
          designCandidates.length +
          (api?.operations.length ?? 0),
        misses:
          Math.max(
            0,
            selectedHandles.filter((handle) => handle.startsWith("memory:"))
              .length - selectedMemory.length,
          ) +
          Math.max(0, selectedCodeIds.length - selectedCode.length) +
          (selectedDirectTarget && designCandidates.length === 0 ? 1 : 0),
        retries: 0,
        connectorsQueried: api ? ["openapi"] : [],
        receiptsExpanded: 0,
      },
    });
  } finally {
    store.close();
  }
}
