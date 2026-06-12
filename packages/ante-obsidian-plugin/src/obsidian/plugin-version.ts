export const normalizePluginVersion = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^v/i, "").trim();
};

const parseVersionParts = (value: string): { numeric: number[]; prerelease: string | null } => {
  const normalized = normalizePluginVersion(value);
  if (!normalized) {
    return {
      numeric: [],
      prerelease: null,
    };
  }

  const [core, prerelease] = normalized.split("-", 2);
  return {
    numeric: core
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0)),
    prerelease: prerelease?.trim() || null,
  };
};

export const comparePluginVersions = (left: string, right: string): number => {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const maxLength = Math.max(leftParts.numeric.length, rightParts.numeric.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts.numeric[index] ?? 0;
    const rightValue = rightParts.numeric[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  if (leftParts.prerelease === rightParts.prerelease) {
    return 0;
  }
  if (!leftParts.prerelease) {
    return 1;
  }
  if (!rightParts.prerelease) {
    return -1;
  }
  return leftParts.prerelease.localeCompare(rightParts.prerelease);
};

export const shouldOfferPluginUpdate = (
  currentVersion: string,
  latestVersion: string | null,
): boolean => {
  if (!currentVersion || !latestVersion) {
    return false;
  }
  return comparePluginVersions(currentVersion, latestVersion) < 0;
};

export const __test__ = {
  normalizePluginVersion,
  comparePluginVersions,
  shouldOfferPluginUpdate,
};
