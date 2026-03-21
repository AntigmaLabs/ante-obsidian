# Tmd

Tmd is an Obsidian desktop plugin focused on Ante-powered Markdown workflows.

## Features

- Trigger document tasks from Markdown with `@ante`, `@ante research`, and `@ante plan`
- Run the same three presets from the editor right-click menu
- Open a lightweight `Ante Console` from the editor menu or command palette
- Preview Markdown changes as unified diffs before applying them
- Support both edits to existing `.md` files and creation of new Markdown files

## Runtime

Tmd talks only to `ante serve --stdio`. It does not use PTY, `xterm`, or other terminal emulation.

The plugin asks Ante to return one JSON object:

```json
{"type":"text","text":"..."}
```

or

```json
{"type":"change","operation":"replace-selection","afterText":"..."}
```

Supported change operations are:

- `replace-selection`
- `append-block`
- `replace-file`
- `create-file`

For `create-file`, Ante must return an explicit `targetPath`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm run smoke
npm run probe
```

## Portable Config

The repository itself no longer depends on machine-specific absolute paths.

Runtime scripts resolve Ante like this:

- `ANTE_BIN`: optional path to the `ante` executable. Defaults to `ante`.
- `ANTE_CWD`: optional working directory for Ante. Defaults to the repository root.
- `ANTE_MODEL`: optional model override for probe and smoke scripts. Defaults to `gpt-5.4`.
- `ANTE_PROVIDER`: optional provider override for probe and smoke scripts. Defaults to `openai-subscription`.

Example:

```bash
cp .env.example .env
export ANTE_BIN="$HOME/.ante/bin/ante"
export ANTE_CWD="$PWD"
npm run smoke
```

## Obsidian Install

To install the plugin into any local Obsidian vault:

1. Build the plugin bundle.
2. Create `<your-vault>/.obsidian/plugins/tmd/`.
3. Copy or symlink these files into that folder:
   - `manifest.json`
   - `main.js`
   - `styles.css`
4. In Obsidian, open `Settings -> Community plugins` and reload plugins.
5. Enable `Tmd`, then set your local Ante command/provider/model in the plugin settings if needed.

The Obsidian plugin still stores local machine settings in its own plugin data file at runtime. That is expected user-local configuration, not repository configuration.

Current defaults that are still opinionated but not machine-bound:

- Plugin default command: `ante`
- Plugin default args: `["serve","--stdio","--yolo"]`
- Plugin default model: `gpt-5.4`
- Plugin default provider: `openai-subscription`

## Version Sync

Obsidian reads plugin version from `manifest.json`, not `package.json`.

This repository treats `package.json.version` as the source of truth. After changing it, run:

```bash
npm run build
```

`build` now syncs version metadata before bundling. If you only want to sync version files without building, run:

```bash
npm run sync-version
```

That updates:

- `manifest.json`
- `versions.json`

The bundle entrypoint is `src/obsidian/main.ts`.
