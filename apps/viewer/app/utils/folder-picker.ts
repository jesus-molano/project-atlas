export interface AtlasDesktopFolderPicker {
  version: 1;
  capabilities: {
    selectDirectory: true;
  };
  selectDirectory(): Promise<
    | { status: "selected"; absolutePath: string }
    | { status: "cancelled" }
  >;
}

declare global {
  interface Window {
    projectAtlasDesktopHost?: unknown;
  }
}

export function desktopFolderPicker(
  value: unknown,
): AtlasDesktopFolderPicker | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AtlasDesktopFolderPicker>;
  if (
    candidate.version !== 1 ||
    candidate.capabilities?.selectDirectory !== true ||
    typeof candidate.selectDirectory !== "function"
  ) {
    return undefined;
  }
  return candidate as AtlasDesktopFolderPicker;
}

export async function chooseDesktopProjectFolder(
  picker: AtlasDesktopFolderPicker,
): Promise<string | undefined> {
  const result = await picker.selectDirectory();
  if (result.status === "cancelled") return undefined;
  const absolutePath = result.absolutePath.trim();
  if (
    !absolutePath ||
    absolutePath.length > 1_024 ||
    /[\u0000-\u001f]/.test(absolutePath)
  ) {
    throw new Error("The desktop host returned an invalid folder path.");
  }
  return absolutePath;
}

function normalizeDroppedPath(value: string): string | undefined {
  let candidate = value.trim().replace(/^["']|["']$/g, "");
  if (candidate.startsWith("file://")) {
    try {
      candidate = decodeURIComponent(new URL(candidate).pathname);
      if (/^\/[A-Za-z]:\//.test(candidate)) candidate = candidate.slice(1);
    } catch {
      return undefined;
    }
  }
  if (
    !candidate ||
    candidate.length > 1_024 ||
    /[\u0000-\u001f]/.test(candidate) ||
    !/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

export function projectPathFromDrop(
  dataTransfer: Pick<DataTransfer, "files" | "getData">,
): string | undefined {
  const droppedFile = dataTransfer.files.item(0) as
    | (File & { path?: string })
    | null;
  const filePath = droppedFile?.path
    ? normalizeDroppedPath(droppedFile.path)
    : undefined;
  if (filePath) return filePath;
  return normalizeDroppedPath(
    dataTransfer.getData("text/uri-list") ||
      dataTransfer.getData("text/plain"),
  );
}
