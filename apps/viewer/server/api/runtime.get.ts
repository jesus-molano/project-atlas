export default defineEventHandler(() => ({
  previewOrigin: process.env.ATLAS_PREVIEW_ORIGIN ?? "",
  viewerOrigin: `http://${process.env.NITRO_HOST ?? "127.0.0.1"}:${
    process.env.NITRO_PORT ?? "4173"
  }`,
}));
