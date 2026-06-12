export interface TmdUpdateConfig {
  anteManifestUrl: string;
  anteInstallUrl: string;
  anteChannel: string;
  pluginRepositoryUrl: string;
  pluginReleaseApiUrl: string;
  pluginReleasesPageUrl: string;
}

export const DEFAULT_UPDATE_CONFIG: TmdUpdateConfig = {
  anteManifestUrl: "https://download.ante.run/channels/stable/manifest.json",
  anteInstallUrl: "https://download.ante.run/install.sh",
  anteChannel: "stable",
  pluginRepositoryUrl: "https://github.com/AntigmaLabs/ante-obsidian",
  pluginReleaseApiUrl: "https://api.github.com/repos/AntigmaLabs/ante-obsidian/releases/latest",
  pluginReleasesPageUrl: "https://github.com/AntigmaLabs/ante-obsidian/releases",
};
