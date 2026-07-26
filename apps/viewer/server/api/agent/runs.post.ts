import type {
  AgentRunMode,
  AgentSandbox,
  AgentSourceReference,
} from "@component-atlas/agent";
import { startAgentRun } from "../../utils/agent-runs";
import { assertAgentSession } from "../../utils/agent-session";

interface StartBody {
  mode?: AgentRunMode;
  task?: string;
  sources?: AgentSourceReference[];
  sandbox?: AgentSandbox;
  budgetChars?: number;
  topK?: number;
  selectedHandles?: string[];
  figmaFile?: string;
  expectedFingerprint?: string;
}

export default defineEventHandler(async (event) => {
  assertAgentSession(event);
  const body = await readBody<StartBody>(event);
  if (
    !body?.task ||
    !body.expectedFingerprint ||
    !["prepare", "implement", "continue", "correct"].includes(body.mode ?? "") ||
    !["read-only", "workspace-write"].includes(body.sandbox ?? "")
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reviewed agent launch payload is required.",
    });
  }
  return startAgentRun({
    mode: body.mode!,
    task: body.task,
    sources: body.sources ?? [],
    sandbox: body.sandbox!,
    budgetChars: body.budgetChars ?? 3_600,
    topK: body.topK ?? 5,
    selectedHandles: body.selectedHandles ?? [],
    expectedFingerprint: body.expectedFingerprint,
    ...(body.figmaFile ? { figmaFile: body.figmaFile } : {}),
  });
});
