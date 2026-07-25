import { getTaskContext } from "@component-atlas/runtime";
import { projectRootPath } from "../utils/project";

interface TaskContextBody {
  task?: string;
  figmaFile?: string;
  budgetChars?: number;
  topK?: number;
}

export default defineEventHandler(async (event) => {
  const body = await readBody<TaskContextBody>(event);
  if (!body) {
    throw createError({ statusCode: 400, statusMessage: "Request body is required." });
  }
  const task = body.task?.trim();
  if (!task) {
    throw createError({
      statusCode: 400,
      statusMessage: "Describe the task before generating context.",
    });
  }
  return getTaskContext(projectRootPath(), task, {
    ...(body.figmaFile ? { figmaFile: body.figmaFile } : {}),
    ...(body.budgetChars ? { budgetChars: body.budgetChars } : {}),
    ...(body.topK ? { topK: body.topK } : {}),
  });
});
