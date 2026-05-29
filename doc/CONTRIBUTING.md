# Contributing & Development Guide

This document contains advanced development, testing, and release workflows for the Ante Obsidian monorepo.

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

## Obsidian Install (Development)

Ante Obsidian can be installed in several ways during development or from source. 

For GitHub Releases, generate the installable archive and the standalone Obsidian release assets with:

```bash
npm run build:release
```

That creates `.release/ante-<version>.zip`, which expands to an `ante/` folder containing:

- `manifest.json`
- `main.js`
- `styles.css`

It also copies those three files to `.release/main.js`, `.release/manifest.json`, and `.release/styles.css`. Attach the standalone files to GitHub releases for Obsidian Community Plugin validation, alongside the zip archive for manual installs.

After manual installation:

1. Enable `Ante Obsidian` in `Settings -> Community plugins`.
2. Confirm the local Ante runtime status and provider/model settings if needed.
3. By default, Ante Obsidian follows `~/.ante/settings.json` for provider and model.
4. Review preset visibility and ordering in `Ante Obsidian Settings -> Presets` if you want to customize the editor menu.
5. If you switch Ante Obsidian to manual provider selection and choose `Gemini API`, you can either keep `GEMINI_API_KEY` in your environment or paste the key into the plugin's Gemini settings. Leaving the field empty reuses Ante's environment.

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
- `packages/ante-obsidian-plugin/package.json`

## SDK Package Publishing

The SDK package is `@antigma/ante-sdk`. It exposes:

- `query({ prompt, options })`, following the Claude Code SDK style
- `createAnteClient()` for lower-level session control
- protocol, transport, event parsing, and approval helpers used by the Obsidian plugin

Before publishing:

```bash
npm login
npm whoami
npm run typecheck
npm test
npm run build
npm pack --dry-run -w @antigma/ante-sdk
```

Publish with:

```bash
npm publish -w @antigma/ante-sdk
```

The package is configured with `publishConfig.access = public`; the npm account still needs permission to publish under the `@antigma` scope.

---

## 🎨 Visual Assets & Design (Future Roadmap)

This section tracks upcoming tasks, design refinements, and future visual backlog items for the project:

- [ ] **Custom Designed Banner**: Create a minimalist, editorial-style project banner.
- [ ] **Feature Demonstration GIFs**: Record short, smooth screen captures of key features:
  - Inline `@ante` trigger streaming and modifying text in place.
  - Sidebar Chat panel showing a multi-turn context-aware conversation.
  - Ante Terminal interface showcasing log streaming and interactive tool approval cards.
  - Preset drag-and-drop ordering in the Settings panel.
- [ ] **Dark & Light Mode Previews**: Take side-by-side screenshots demonstrating how the plugin inherits Obsidian theme variables gracefully in both modes.
