import process from "node:process";

if (process.env.ATLAS_GUI_SESSION_TOKEN) {
  if (process.env.ATLAS_TEST_VIEWER_TRACE === "1") {
    process.stderr.write(`atlas-test-viewer-port:${process.env.NITRO_PORT}\n`);
  }

  const delayMs = Number(process.env.ATLAS_TEST_VIEWER_START_DELAY_MS ?? 0);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }

  if (process.env.ATLAS_TEST_VIEWER_FAILURE === "1") {
    process.stderr.write("atlas-test-viewer-failure: simulated startup failure\n");
    process.exit(23);
  }

  if (process.env.ATLAS_TEST_VIEWER_BIND_FAILURE === "1") {
    process.stderr.write(
      `Error: listen EADDRINUSE: address already in use 127.0.0.1:${process.env.NITRO_PORT}\n`,
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);
  }
}
