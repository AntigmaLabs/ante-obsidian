# Tmd

Tmd is an Obsidian desktop plugin focused on Ante-powered Markdown workflows.

## Features

- Trigger document tasks from Markdown with `@ante`
- Run `@ante`, `@ante research`, and `@ante plan` from the editor right-click menu
- Open `Chat with Ante` from the editor menu or command palette
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
npm run build:release
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
- `GEMINI_API_KEY`: used by Ante when `ANTE_PROVIDER=gemini`.

Example:

```bash
cp .env.example .env
export ANTE_BIN="$HOME/.ante/bin/ante"
export ANTE_CWD="$PWD"
npm run smoke
```

## Obsidian Install

Tmd can be installed in several ways:

- Obsidian Community Plugins browser, after official review and listing
- BRAT, for beta distribution before official listing
- Manual install from a GitHub release
- Local install from source

Detailed docs live in [`doc/`](./doc/):

- English install guide: [doc/INSTALL.md](./doc/INSTALL.md)
- 中文安装文档: [doc/INSTALL.zh-CN.md](./doc/INSTALL.zh-CN.md)
- English user guide: [doc/USER_GUIDE.md](./doc/USER_GUIDE.md)
- 中文使用文档: [doc/USER_GUIDE.zh-CN.md](./doc/USER_GUIDE.zh-CN.md)

For GitHub Releases, generate a single installable archive with:

```bash
npm run build:release
```

That creates `.release/tmd-<version>.zip`, which expands to a `tmd/` folder containing:

- `manifest.json`
- `main.js`
- `styles.css`

After installation:

1. Enable `Tmd` in `Settings -> Community plugins`.
2. Confirm the local Ante command/provider/model settings if needed.
3. By default, Tmd follows `~/.ante/settings.json` for provider and model.
4. If you switch Tmd to manual provider selection and choose `Gemini API`, you can either keep `GEMINI_API_KEY` in your environment or paste the key into the plugin's Gemini settings. Leaving the field empty reuses Ante's environment.

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
