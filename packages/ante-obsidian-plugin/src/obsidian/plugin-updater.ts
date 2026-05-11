import { requestUrl } from "obsidian";
import { normalizePluginVersion, shouldOfferPluginUpdate } from "./plugin-version";
import { DEFAULT_UPDATE_CONFIG } from "./update-config";

export interface PluginVersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  sourceAvailable: boolean;
  latestUrl?: string;
  error?: string;
}

export class PluginUpdater {
  constructor(private readonly currentVersion: string) {}

  async checkForUpdate(releaseUrl = DEFAULT_UPDATE_CONFIG.pluginReleaseApiUrl): Promise<PluginVersionCheckResult> {
    const checkedAt = new Date().toISOString();
    try {
      const response = await requestUrl({
        url: releaseUrl,
        method: "GET",
        throw: false,
        headers: {
          Accept: "application/vnd.github+json"
        }
      });

      if (response.status < 200 || response.status >= 300) {
        if (response.status === 404) {
          return {
            currentVersion: normalizePluginVersion(this.currentVersion),
            latestVersion: null,
            updateAvailable: false,
            sourceAvailable: false,
            checkedAt,
            latestUrl: DEFAULT_UPDATE_CONFIG.pluginReleasesPageUrl
          };
        }
        throw new Error(`Failed to fetch Ante Obsidian release info (${response.status})`);
      }

      const body = response.json as Record<string, unknown>;
      const latestVersion = typeof body.tag_name === "string" ? normalizePluginVersion(body.tag_name) : "";
      if (!latestVersion) {
        throw new Error("Ante Obsidian release info missing tag_name");
      }

      const latestUrl = typeof body.html_url === "string" ? body.html_url : undefined;
      return {
        currentVersion: normalizePluginVersion(this.currentVersion),
        latestVersion,
        latestUrl,
        sourceAvailable: true,
        updateAvailable: shouldOfferPluginUpdate(this.currentVersion, latestVersion),
        checkedAt
      };
    } catch (error) {
      return {
        currentVersion: normalizePluginVersion(this.currentVersion),
        latestVersion: null,
        updateAvailable: false,
        sourceAvailable: true,
        checkedAt,
        latestUrl: DEFAULT_UPDATE_CONFIG.pluginReleasesPageUrl,
        error: error instanceof Error ? error.message : "Failed to check Ante Obsidian updates"
      };
    }
  }
}
