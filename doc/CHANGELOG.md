# Changelog

## 0.6.12 - 2026-06-08

- **Community Review Readiness**: Align the plugin source with Obsidian's current review checks, including API compatibility, settings labels, source typing, and release metadata.

## 0.6.11 - 2026-06-07

- **Improved Chat & Mentions UX**: Show the active model and task progress inside inline mentions (with safe rendering & optimized performance), and relocate the loading indicator to the bottom of the active chat block with a rotating word switcher
- **Diagnostics & Feedback**: Add a bug report button to settings and improve runtime error log diagnostics
- **Settings Model Override**: Add a model selection dropdown to the settings tab when CLI defaults are overridden

## 0.6.10 - 2026-06-04

- **Dynamic Models & Providers**: Automatically source active LLM models and providers from the local Ante CLI catalog
- **Setup Reliability**: Prevent initialization failures and add CLI upgrade warnings

## 0.6.9 - 2026-06-03

- **More Reliable Chat Edits**: Fix duplicate same-file previews, hide no-op changes, and show loading while diffs are prepared
- **Runtime & Update Fixes**: Improve Ante CLI detection, support the latest serve command, and add direct plugin install from settings

## 0.6.8 - 2026-06-01

- **Improved Chat Experience**: Keep chat sessions on the intended provider and model, keep runtime target details visible while composing, and make generated note edit previews easier to review and apply

## 0.6.7 - 2026-05-30

- **Onboarding & Configuration Improvements**: Refine the initial settings setup with unified CLI terminology, smooth inline API key inputs, and quick-copy update helpers

## 0.6.6 - 2026-05-30

- **Session Control Drawer**: Add a collapsible sliding Session Console drawer to the chat interface to house provider, model, and thinking selector dropdowns, freeing up composer space and resolving keyboard focus positioning
- **Custom Model Management**: Allow users to configure and manage custom model IDs per provider directly in the settings tab, automatically merged with available model names
- **Toggleable API Keys**: Support visibility toggles (`eye` / `eye-off`) for provider API keys in the settings tab
- **Dynamic Provider Keys**: Dynamically render API key settings per provider based on catalog metadata, isolating model lists and avoiding cross-provider leakage
- **Optimized Environment Load**: Spawns a single login shell process to read environment variables, eliminating UI lag during plugin loading

## 0.6.5 - 2026-05-29

- **Community Review Readiness**: Clarify desktop-only runtime, filesystem, Vault API, and clipboard behavior for Obsidian plugin review
- **Marketplace Metadata**: Ensure the plugin manifest description follows Obsidian community plugin metadata checks
- **Vault Access Scope**: Resolve vault files without full-vault enumeration during document change handling
- **CSS Compatibility**: Clean up unsupported scrollbar declarations, duplicate style declarations, broad resets, and unnecessary important overrides

## 0.6.4 - 2026-05-29

- **Plugin Update Guidance**: Keep the settings update check aligned with Obsidian's official update flow by opening the repository instead of running the manual installer inside the plugin
- **Manual Install Updates**: Clarify that the install script can also update existing manual installs by overwriting the plugin folder with the latest release archive

## 0.6.3 - 2026-05-28

- **Community Directory Readiness**: Rename the marketplace plugin identity to Ante so the manifest follows current Obsidian community plugin rules
- **Product Naming**: Restore Ante Obsidian across user-facing documentation and settings copy while keeping marketplace metadata compatible
- **Release Packaging**: Publish standalone `main.js`, `manifest.json`, and `styles.css` assets alongside the release archive for official directory validation
- **Installation Updates**: Install plugin updates directly from the settings page with the release installer script, and align manual installation paths with the new `ante` plugin folder

## 0.6.2 - 2026-05-20

- **Dynamic Model Loading**: Load chat models dynamically from your active Ante provider configuration
- **Improved Chat UX**: Enhance chat interface responsiveness and add smooth loading animations for background updates
- **Robust Model Selection**: Major improvements to model switching stability and provider settings
- **Revamped Documentation**: Complete update to English and Chinese guides, including architectural diagrams
- **Stability Improvements**: Under-the-hood performance and lifecycle fixes

## 0.6.1 - 2026-05-13

- **Native Tool Use**: Seamless agent interaction via native Tool Use support (removed legacy JSON parsing overhead)
- **One-Click Installation**: Add a new automated release installation script for quick vault setup
- **Simplified Guides**: Streamlined installation documentation and simplified developer workflows

## 0.6.0 - 2026-05-11

- **Product Rebranding**: Rename project from "ante-md" to "ante-obsidian"
- **Codebase Restructure**: Internal architectural improvements to facilitate faster features release
- **Cleanup**: Removed unused folders and legacy files for a cleaner repository footprint

## 0.5.3 - 2026-04-16

- **File Attachments**: Add file attachments support directly inside the Chat composer
- **Model Thinking Levels**: Add support for adjusting model thinking depth (Disabled, Enabled, Deep, Max) in settings
- **Reliable Staging**: Improved file preview staging robustness and workspace directory cleanups

## 0.5.2 - 2026-04-08

- **Target Switching**: Add runtime target switching directly in the chat interface
- **Quick Trigger**: Trigger the chat easily by typing `@ante` and hitting Enter
- **Resilient Sessions**: Robust session orchestration and diagnostics during network disconnections
- **Performance Improvements**: Refactored internal architecture for faster execution

## 0.5.1 - 2026-04-06

- **Streamlined Settings**: Easily configure Ante providers and override custom models in the settings tab
- **Polished UI/UX**: Enhanced glassmorphism effects, typography, and responsive layouts for the composer
- **Better Observability**: Improved chat message interruption handling and real-time guidance
- **Auto-Resolve Shell**: Automatically look up the login shell command paths for easier environment setup

## 0.5.0 - 2026-04-03

- **Smart Note Diffs**: Improve code block diff application and heading anchor matching in your notes
- **Ante Updates**: Add Ante CLI version check and update controls directly inside the settings tab
- **Session Stability**: Stabilized chat session handoffs and process logs streaming

## 0.4.2 - 2026-03-29

- **Product Naming**: Consistent product-facing labels and UI text updated to "Ante Obsidian"
- **Snapshot Persistence**: Automatically persist chat artifact snapshots

## 0.4.1 - 2026-03-29

- **Consistent ID**: Updated internal plugin identifier to `ante-obsidian`

## 0.4.0 - 2026-03-27

- **Rich Context Chat**: Render rich markdown and automatically enrich note/vault context inside your conversations
- **Preset Reordering**: Redesigned chat sidebar with drag-and-drop support for preset reordering
- **Refined Composer**: Fresh layout and interaction styling for the composer and side panel
- **Onboarding Docs**: Comprehensive update to user guides and reference files

## 0.3.1 - 2026-03-24

- **Chat Reset**: Clear and reset conversations with a new UI button
- **Renamed View**: Terminal view renamed to "Chat with Ante" to reflect its interactive nature

## 0.3.0 - 2026-03-24

- **Interactive Console**: Replaced standard terminal view with the fully interactive "Chat with Ante" experience
- **Smoother Terminal**: Enhanced CLI output rendering and stdout streaming

## 0.2.0 - 2026-03-24

- **Note Diff Previews**: Interactive inline diff previews and approval controls for editing notes
- **Easy Preset Triggering**: Invocation of custom prompts directly via Vault context menus and editor mentions
- **Auto-Discovery**: Automatic discovery of the local `ante` CLI binary path
- **Release Packages**: Automated release ZIP generation for easy manual installations

## 0.1.2 - 2026-03-22

- **Interactive Tool Approvals**: Safe, interactive prompt screens for terminal commands executed by the agent
- **Vault Setup**: Standard installation guidelines and licensing

## 0.1.1 - 2026-03-21

- **Initial Release**: Initial release of the Obsidian desktop integration plugin
