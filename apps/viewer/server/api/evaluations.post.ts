import { recordTaskEvaluation } from "@component-atlas/runtime";
import { assertLocalSession } from "../utils/local-session";
import { projectRootPath } from "../utils/project";

interface EvaluationBody {
  task?: string;
  necessaryQuestions?: number;
  contextChars?: number;
  preparationMs?: number;
  conflictCount?: number;
  reworkRequired?: boolean;
}

export default defineEventHandler(async (event) => {
  assertLocalSession(event);
  const body = await readBody<EvaluationBody>(event);
  if (!body?.task) {
    throw createError({
      statusCode: 400,
      statusMessage: "A task is required for its content-free fingerprint.",
    });
  }
  return recordTaskEvaluation({
    rootPath: projectRootPath(),
    task: body.task,
    necessaryQuestions: body.necessaryQuestions,
    contextChars: body.contextChars,
    preparationMs: body.preparationMs,
    conflictCount: body.conflictCount,
    reworkRequired: body.reworkRequired,
  });
});
