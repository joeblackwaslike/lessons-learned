export class UnsupportedOperationError extends Error {}

export function getFileMetadata(entry) {
  if (entry.special) throw new UnsupportedOperationError(`unsupported inode: ${entry.path}`);
  return { path: entry.path, size: entry.size };
}

export function indexFiles(entries) {
  const index = [];
  for (const entry of entries) {
    index.push(getFileMetadata(entry));
  }
  return index;
}
