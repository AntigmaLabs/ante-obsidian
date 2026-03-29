# Ante Obsidian 
Ante Obsidian is an Obsidian desktop plugin for Ante-powered Markdown workflows. It connects your local Ante runtime to note editing, review, and chat flows inside Obsidian.

## Features

- Trigger document tasks from Markdown with `@ante`
- Run visible presets from the editor right-click menu, including built-ins such as `@ante`, `@ante research`, `@ante plan`, and `@ante summary`
- Create custom presets in settings, then reorder or hide built-in and custom presets with drag and drop
- Open `Chat with Ante` from the editor menu or command palette for multi-turn note-aware conversations
- Use `Ante Terminal` for a more terminal-style prompt flow when you want streaming output and approval controls
- Preview Markdown changes as unified diffs in `Results`, including multi-file changes, before applying them
- Support edits to existing `.md` files and creation of new Markdown files

## Main Views

- `Results`: review text output, diff summaries, and apply generated Markdown changes
- `Chat with Ante`: keep conversation history, switch between conversations from the sidebar, reuse note context, and render Markdown replies
- `Ante Terminal`: send terminal-style prompts, inspect runtime logs, and approve or deny tool calls when needed

## Runtime

Ante Obsidian talks to `ante serve` using one of two transports:

- `stdio`: `ante serve --stdio` over stdin/stdout
- `websocket`: `ante serve --ws <ADDR>` plus a WebSocket client connection

It does not use PTY, `xterm`, or other terminal emulation.

For note editing and chat tasks, the plugin asks Ante to return one JSON object:

```json
{"type":"text","text":"..."}
```

or

```json
{"type":"change","operation":"replace-selection","afterText":"..."}
```

or

```json
{"type":"changes","changes":[{"operation":"append-block","afterText":"..."},{"operation":"create-file","targetPath":"Notes/New.md","afterText":"..."}]}
```

Supported change operations are:

- `replace-selection`
- `append-block`
- `replace-file`
- `create-file`

For `create-file`, Ante must return an explicit `targetPath`.
For multiple edits, Ante should return one `changes` object containing every Markdown change.

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

WebSocket smoke test example:

```bash
ANTE_TRANSPORT=websocket ANTE_WS_ADDRESS=127.0.0.1:8765 npm run smoke
```

## Portable Config

The repository itself no longer depends on machine-specific absolute paths.

Runtime scripts resolve Ante like this:

- `ANTE_BIN`: optional path to the `ante` executable. Defaults to `ante`.
- `ANTE_CWD`: optional working directory for Ante. Defaults to the repository root.
- `ANTE_MODEL`: optional model override for probe and smoke scripts. Defaults to `gpt-5.4`.
- `ANTE_PROVIDER`: optional provider override for probe and smoke scripts. Defaults to `openai-subscription`.
- `ANTE_TRANSPORT`: optional transport for smoke/probe scripts. `stdio` by default, or `websocket`.
- `ANTE_WS_ADDRESS`: socket address for `ANTE_TRANSPORT=websocket`. Defaults to `127.0.0.1:8765`.
- `GEMINI_API_KEY`: used by Ante when `ANTE_PROVIDER=gemini`.

Example:

```bash
cp .env.example .env
export ANTE_BIN="$HOME/.ante/bin/ante"
export ANTE_CWD="$PWD"
npm run smoke
```

## Obsidian Install

Ante Obsidian can be installed in several ways:

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

1. Enable `Ante Obsidian` in `Settings -> Community plugins`.
2. Confirm the local Ante command and connection mode settings if needed.
3. By default, Ante Obsidian follows `~/.ante/settings.json` for provider and model.
4. Review preset visibility and ordering in `Ante Obsidian Settings -> Presets` if you want to customize the editor menu.
5. If you switch Ante Obsidian to manual provider selection and choose `Gemini API`, you can either keep `GEMINI_API_KEY` in your environment or paste the key into the plugin's Gemini settings. Leaving the field empty reuses Ante's environment.

The Obsidian plugin still stores local machine settings in its own plugin data file at runtime. That is expected user-local configuration, not repository configuration.

Current defaults that are still opinionated but not machine-bound:

- Plugin default command: `ante`
- Plugin default args: `["serve","--stdio","--yolo"]`
- Plugin default connection mode: `stdio`
- Plugin default WebSocket address: `127.0.0.1:8765`
- Plugin default model: `gpt-5.4`
- Plugin default provider: `openai-subscription`

Built-in presets currently included by default:

- `@ante`
- `@ante research`
- `@ante plan`
- `@ante summary`

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
