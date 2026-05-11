export interface TmdUpdateConfig {
  anteManifestUrl: string;
  anteInstallUrl: string;
  anteChannel: string;
  pluginRepositoryUrl: string;
  pluginReleaseApiUrl: string;
  pluginReleasesPageUrl: string;
}

export const DEFAULT_UPDATE_CONFIG: TmdUpdateConfig = {
  anteManifestUrl: "https://storage.googleapis.com/release-antigma-public/channels/latest/manifest.json",
  anteInstallUrl: "https://storage.googleapis.com/release-antigma-public/install.sh",
  anteChannel: "latest",
  pluginRepositoryUrl: "https://github.com/AntigmaLabs/ante-obsidian",
  pluginReleaseApiUrl: "https://api.github.com/repos/AntigmaLabs/ante-obsidian/releases/latest",
  pluginReleasesPageUrl: "https://github.com/AntigmaLabs/ante-obsidian/releases"
};
