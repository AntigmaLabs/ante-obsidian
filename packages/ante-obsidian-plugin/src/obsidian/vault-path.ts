const normalizeFileSystemPath = (path: string): string => {
  const normalized = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .normalize("NFC");

  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
};

export const normalizeVaultRelativePath = (path: string): string =>
  normalizeFileSystemPath(path).replace(/^\/+/, "").replace(/\/+$/, "");

export const toVaultRelativePath = (
  path: string,
  vaultPath: string | null | undefined
): string | null => {
  const normalizedPath = normalizeFileSystemPath(path);
  if (!normalizedPath) {
    return null;
  }

  if (!normalizedPath.startsWith("/")) {
    return normalizeVaultRelativePath(normalizedPath);
  }

  const normalizedVaultPath = vaultPath ? normalizeFileSystemPath(vaultPath) : "";
  if (!normalizedVaultPath) {
    return null;
  }
  if (normalizedPath === normalizedVaultPath) {
    return "";
  }
  if (!normalizedPath.startsWith(`${normalizedVaultPath}/`)) {
    return null;
  }

  return normalizeVaultRelativePath(normalizedPath.slice(normalizedVaultPath.length + 1));
};
