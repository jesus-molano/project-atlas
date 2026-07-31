import {
  assertLocalSession,
  assertSameOrigin,
} from "../../utils/local-session";
import { inspectProjectRoot } from "../../utils/project";

interface InspectProjectBody {
  rootPath?: string;
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  assertLocalSession(event);
  const body = await readBody<InspectProjectBody>(event);
  return inspectProjectRoot(body?.rootPath ?? "");
});
