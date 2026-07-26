import { describe, expect, it, vi } from "vitest";
import {
  chooseDesktopProjectFolder,
  desktopFolderPicker,
  projectPathFromDrop,
} from "../apps/viewer/app/utils/folder-picker";

describe("desktop folder picker boundary", () => {
  it("accepts the versioned capability and returns a selected absolute path", async () => {
    const host = {
      version: 1 as const,
      capabilities: { selectDirectory: true as const },
      selectDirectory: vi.fn(async () => ({
        status: "selected" as const,
        absolutePath: "C:\\work\\frontend",
      })),
    };
    const picker = desktopFolderPicker(host);
    expect(picker).toBeDefined();
    await expect(chooseDesktopProjectFolder(picker!)).resolves.toBe(
      "C:\\work\\frontend",
    );
    expect(host.selectDirectory).toHaveBeenCalledOnce();
  });

  it("treats cancellation as a no-op and rejects malformed host results", async () => {
    const cancelled = desktopFolderPicker({
      version: 1,
      capabilities: { selectDirectory: true },
      selectDirectory: async () => ({ status: "cancelled" }),
    });
    await expect(chooseDesktopProjectFolder(cancelled!)).resolves.toBeUndefined();
    expect(desktopFolderPicker({ version: 2 })).toBeUndefined();
    await expect(
      chooseDesktopProjectFolder({
        version: 1,
        capabilities: { selectDirectory: true },
        selectDirectory: async () => ({
          status: "selected",
          absolutePath: "\u0000bad",
        }),
      }),
    ).rejects.toThrow("invalid folder path");
  });

  it("accepts absolute paths from desktop drops and dropped text", () => {
    expect(
      projectPathFromDrop({
        files: {
          item: () => ({ path: "C:\\work\\frontend" }),
        } as unknown as FileList,
        getData: () => "",
      }),
    ).toBe("C:\\work\\frontend");
    expect(
      projectPathFromDrop({
        files: { item: () => null } as unknown as FileList,
        getData: (kind) =>
          kind === "text/uri-list" ? "file:///C:/work/frontend" : "",
      }),
    ).toBe("C:/work/frontend");
  });

  it("does not invent a path when the browser hides folder locations", () => {
    expect(
      projectPathFromDrop({
        files: {
          item: () => ({ name: "frontend" }),
        } as unknown as FileList,
        getData: () => "",
      }),
    ).toBeUndefined();
  });
});
