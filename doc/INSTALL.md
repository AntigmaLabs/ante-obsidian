# Ante md Installation Guide

This guide explains the supported ways to install Ante md as an Obsidian plugin.

Ante md is a desktop-only plugin. It still depends on a local Ante Runtime to do actual work, but you no longer need to install `ante` manually before installing the plugin.

## Before You Install

Make sure all of the following are true:

- You are using Obsidian desktop.
- Your Obsidian version is at least `1.6.0`.
- Your machine allows Ante md to check, install, or upgrade the local Ante Runtime from settings.
- If you do not plan to rely on Ante defaults, you have the required provider model and credentials ready.

Ante md does not become usable just because the plugin files are installed. Before first use, you still need to confirm the local Ante Runtime status in Ante md settings.

## Option 1: Install From The Obsidian Community Plugins Browser

Use this option after Ante md has been accepted into the official Obsidian community plugins directory.

1. Open `Settings -> Community plugins`.
2. Turn off `Restricted mode` if needed.
3. Select `Browse`.
4. Search for `Ante md`.
5. Install the plugin.
6. Enable the plugin.
7. Open the Ante md settings and confirm the runtime status and provider/model configuration.

This is the simplest option for most users, but it only works after the plugin passes Obsidian's review process.

## Option 2: Manual Install From A GitHub Release

Use this option if a release is available.

1. Open the latest Ante md release on GitHub.
2. Download the plugin release archive, such as `ante-md-0.2.0.zip`.
   Do not download GitHub's automatically generated `Source code` archives.
3. Extract the archive and place the resulting `ante-md/` folder in:

```text
<your-vault>/.obsidian/plugins/
```

The final path should be:

```text
<your-vault>/.obsidian/plugins/ante-md/
```

4. Open Obsidian and enable `Ante md` in `Settings -> Community plugins`.
5. Open the Ante md settings and confirm the runtime status and provider/model configuration.

If the plugin does not appear, verify that the folder name matches the plugin id in `manifest.json`. For this project, the id is `ante-md`.

## Option 3: Local Install From Source

Use this option if you want to build the plugin yourself.

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Build the plugin:

```bash
npm run build
```

4. Create this folder inside your vault:

```text
<your-vault>/.obsidian/plugins/ante-md/
```

5. Copy these files from the repository root into that folder:
- `manifest.json`
- `main.js`
- `styles.css`
6. Open Obsidian and enable `Ante md` in `Settings -> Community plugins`.
7. Open the Ante md settings and confirm the runtime status and provider/model configuration.

For development, you can also place the repository directly in the plugin directory and rebuild in place.

## Post-Install Setup

After installation, verify the runtime configuration:

1. Open Ante md settings.
2. Check the `Runtime` panel for plugin and local Ante Runtime status.
3. If Ante is not installed locally yet, use `Install` directly from the settings page.
4. Confirm the provider and model settings if you are not relying on Ante's own defaults.
5. If you use Gemini, optionally fill in the API key or env var name.
6. Try a simple Ante md action on a test note.

Ante md still depends on a working local Ante Runtime, but it now assumes the standard `ante` executable and provides built-in status checks plus install/upgrade actions in settings.
By default, Ante md follows Ante's local configuration when possible. If your Ante setup is broken, Ante md will also fail.

## Troubleshooting

### The plugin installs but does not work

Most likely causes:

- `ante` is not installed.
- `ante` is not in your `PATH`.
- Ante itself is not configured for your model provider.
- The plugin settings are not configured for your provider or model setup.

### The plugin does not appear in Obsidian

Check all of the following:

- The folder is exactly `<vault>/.obsidian/plugins/ante-md/`.
- `manifest.json` is present in that folder.
- `main.js` is present in that folder.
- Obsidian community plugins are enabled.
- You reloaded plugins or restarted Obsidian.

## Which Option Should I Use?

- Use the community plugins browser if Ante md is officially listed.
- Use manual release installation if you want a stable file-based install.
- Use source installation only if you are comfortable building the plugin yourself.
