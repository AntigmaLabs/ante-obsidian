export const normalizeAnteVersion = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const withoutBinary = trimmed.replace(/^ante\s+/i, "");
  return withoutBinary.replace(/^v/i, "").trim();
};

export const parseAnteVersionOutput = (stdout: string): string | null => {
  const normalized = normalizeAnteVersion(stdout);
  return normalized || null;
};

export const shouldOfferAnteUpdate = (localVersion: string | null, latestVersion: string | null): boolean => {
  if (!localVersion || !latestVersion) {
    return false;
  }
  return normalizeAnteVersion(localVersion) !== normalizeAnteVersion(latestVersion);
};

export const __test__ = {
  normalizeAnteVersion,
  parseAnteVersionOutput,
  shouldOfferAnteUpdate
};
