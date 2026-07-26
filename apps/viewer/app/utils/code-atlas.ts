export const CODE_ATLAS_PAGE_SIZE = 80;

export function codeAtlasPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / CODE_ATLAS_PAGE_SIZE));
}

export function codeAtlasPageForIndex(index: number): number {
  return Math.max(0, Math.floor(index / CODE_ATLAS_PAGE_SIZE));
}

export function codeAtlasPageSlice<T>(items: T[], page: number): T[] {
  const safePage = Math.min(
    codeAtlasPageCount(items.length) - 1,
    Math.max(0, page),
  );
  const start = safePage * CODE_ATLAS_PAGE_SIZE;
  return items.slice(start, start + CODE_ATLAS_PAGE_SIZE);
}
