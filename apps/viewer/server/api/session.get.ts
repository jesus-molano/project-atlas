import { localSessionToken } from "../utils/local-session";

export default defineEventHandler(() => ({
  token: localSessionToken(),
  expires: "server-restart",
  launch: {
    mode: process.env.ATLAS_PROJECT_ROOT ? "project" : "selector",
    ...(process.env.ATLAS_PROJECT_ID
      ? { projectId: process.env.ATLAS_PROJECT_ID }
      : {}),
  },
}));
