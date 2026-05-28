# Ante Installation Guide

This guide explains the supported ways to install Ante as an Obsidian plugin.

Ante is a desktop-only plugin. It depends on a local Ante Runtime, but you can install `ante` directly from the plugin settings after installation.

## Option 1: Install From A GitHub Release

### Automated Installation (Recommended)

You can use the provided install script to automatically download and extract the latest release. Run this in your terminal, replacing `/path/to/your/vault` with your actual vault path:

```bash
curl -sS https://raw.githubusercontent.com/AntigmaLabs/ante-obsidian/main/scripts/install.sh | bash -s -- /path/to/your/vault
```

### Manual Extraction

1. Open the latest Ante release on GitHub.
2. Download the plugin release archive (e.g., `ante-0.6.3.zip`).
3. Extract the archive and place the `ante/` folder in `<your-vault>/.obsidian/plugins/`.
4. Open Obsidian and enable `Ante` in `Settings -> Community plugins`.

## Option 2: Install From The Obsidian Community Plugins Browser

Use this option once Ante is accepted into the official directory.

1. Open `Settings -> Community plugins`.
2. Select `Browse`, search for `Ante`, and install it.
3. Enable the plugin.

## Option 3: Local Install From Source

1. Clone the repository and run `npm install` followed by `npm run build`.
2. Create `<your-vault>/.obsidian/plugins/ante/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. Enable `Ante` in `Settings -> Community plugins`.

## Post-Install Setup

After installation, verify the runtime configuration:

1. Open Ante settings.
2. Check the `Runtime` panel for plugin and local Ante Runtime status.
3. If Ante is not installed locally yet, use `Install` directly from the settings page.
4. Confirm your provider and model settings.
