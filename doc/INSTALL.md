# Ante Obsidian Installation Guide

This guide explains the supported ways to install Ante Obsidian as an Obsidian plugin.

Ante Obsidian is a desktop-only plugin. It also depends on a local `ante` command to do any actual work after installation.

## Before You Install

Make sure all of the following are true:

- You are using Obsidian desktop.
- Your Obsidian version is at least `1.6.0`.
- You have a local `ante` executable installed and runnable from your machine.
- If your Ante setup uses a remote model provider, that provider is already configured in Ante.

Ante Obsidian does not become usable just because the plugin files are installed. The local Ante runtime must also be available.

## Option 1: Install From The Obsidian Community Plugins Browser

Use this option after Ante Obsidian has been accepted into the official Obsidian community plugins directory.

1. Open `Settings -> Community plugins`.
2. Turn off `Restricted mode` if needed.
3. Select `Browse`.
4. Search for `Ante Obsidian`.
5. Install the plugin.
6. Enable the plugin.
7. Open the Ante Obsidian settings and confirm the Ante command, provider, and model configuration.

This is the simplest option for most users, but it only works after the plugin passes Obsidian's review process.

## Option 2: Install With BRAT

Use this option if Ante Obsidian is not yet in the official plugin browser, or if you want a beta version.

BRAT is a community plugin that installs plugins directly from GitHub repositories.

For best results, use a repository or release that already exposes a valid Obsidian plugin build, including `manifest.json`, `main.js`, and `styles.css`.

1. Install `Obsidian42 - BRAT` from the Obsidian community plugins browser.
2. Open BRAT settings.
3. Choose the action to add a beta plugin from a GitHub repository.
4. Paste the Ante Obsidian repository URL, or the `owner/repo` identifier.
5. Let BRAT install the plugin.
6. Enable `Ante Obsidian`.
7. Open the Ante Obsidian settings and confirm the Ante command, provider, and model configuration.

BRAT is usually the easiest way to distribute test builds before official review is complete.

## Option 3: Manual Install From A GitHub Release

Use this option if a release is available but you do not want to use BRAT.

1. Open the latest Ante Obsidian release on GitHub.
2. Download the plugin release archive, such as `ante-md-0.2.0.zip`.
   Do not use GitHub's automatically generated `Source code (zip)` or `Source code (tar.gz)` files unless you plan to build the plugin yourself.
3. Extract the archive.
   It should expand to an `ante-md/` folder that already contains:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. Create this folder inside your vault:

```text
<your-vault>/.obsidian/plugins/
```

5. Copy the extracted `ante-md/` folder into that directory so the final path is:

```text
<your-vault>/.obsidian/plugins/ante-md/
```

6. Open Obsidian.
7. Go to `Settings -> Community plugins`.
8. Reload plugins if needed.
9. Enable `Ante Obsidian`.
10. Open the Ante Obsidian settings and confirm the Ante command, provider, and model configuration.

If the plugin does not appear, verify that the folder name matches the plugin id in `manifest.json`. For this project, the id is `ante-md`.

## Option 4: Local Install From Source

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
6. Open Obsidian and enable `Ante Obsidian` in `Settings -> Community plugins`.
7. Open the Ante Obsidian settings and confirm the Ante command, provider, and model configuration.

For development, you can also place the repository directly in the plugin directory and rebuild in place.

## Post-Install Setup

After installation, verify the runtime configuration:

1. Open Ante Obsidian settings.
2. Confirm the Ante command. The default is `ante`.
3. Confirm any required command arguments.
4. Confirm the provider and model settings, if you are not relying on Ante's own defaults.
5. Try a simple Ante Obsidian action on a test note.

By default, Ante Obsidian follows Ante's local configuration when possible. If your Ante setup is broken, Ante Obsidian will also fail.

## Troubleshooting

### The plugin installs but does not work

Most likely causes:

- `ante` is not installed.
- `ante` is not in your `PATH`.
- Ante itself is not configured for your model provider.
- The plugin settings point to the wrong command or arguments.

### The plugin does not appear in Obsidian

Check all of the following:

- The folder is exactly `<vault>/.obsidian/plugins/ante-md/`.
- `manifest.json` is present in that folder.
- `main.js` is present in that folder.
- Obsidian community plugins are enabled.
- You reloaded plugins or restarted Obsidian.

### BRAT cannot install the repository

Check:

- The repository is public.
- The repository or selected release exposes a valid Obsidian plugin build.
- `manifest.json`, `main.js`, and `styles.css` are available.
- The plugin id is stable.
- The repository layout matches what Obsidian plugins expect.

## Which Option Should I Use?

- Use the community plugins browser if Ante Obsidian is officially listed.
- Use BRAT if you want the easiest pre-release or beta install path.
- Use manual release installation if you want a stable file-based install without BRAT.
- Use source installation only if you are comfortable building the plugin yourself.
