import type { PreviewStyleEnvironment } from "@component-atlas/core/types";

function styling(): PreviewStyleEnvironment {
  try {
    return JSON.parse(
      process.env.ATLAS_PREVIEW_STYLING ?? "",
    ) as PreviewStyleEnvironment;
  } catch {
    return {
      pipeline: "unknown",
      entryPoints: [],
      sourceRegistration: "not-applicable",
    };
  }
}

export default defineEventHandler(() => ({
  previewOrigin: process.env.ATLAS_PREVIEW_ORIGIN ?? "",
  viewerOrigin: `http://${process.env.NITRO_HOST ?? "127.0.0.1"}:${
    process.env.NITRO_PORT ?? "4173"
  }`,
  styling: styling(),
}));
