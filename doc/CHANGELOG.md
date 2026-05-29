# Changelog

## v0.6.4 - 2026-05-29

- **Plugin Update Guidance**: Keep the settings update check aligned with Obsidian's official update flow by opening the repository instead of running the manual installer inside the plugin
- **Manual Install Updates**: Clarify that the install script can also update existing manual installs by overwriting the plugin folder with the latest release archive

## v0.6.3 - 2026-05-28

- **Community Directory Readiness**: Rename the marketplace plugin identity to Ante so the manifest follows current Obsidian community plugin rules
- **Product Naming**: Restore Ante Obsidian across user-facing documentation and settings copy while keeping marketplace metadata compatible
- **Release Packaging**: Publish standalone `main.js`, `manifest.json`, and `styles.css` assets alongside the release archive for official directory validation
- **Installation Updates**: Install plugin updates directly from the settings page with the release installer script, and align manual installation paths with the new `ante` plugin folder

## v0.6.2 - 2026-05-20

- **Dynamic Model Loading**: Load chat models dynamically from your active Ante provider configuration
- **Improved Chat UX**: Enhance chat interface responsiveness and add smooth loading animations for background updates
- **Robust Model Selection**: Major improvements to model switching stability and provider settings
- **Revamped Documentation**: Complete update to English and Chinese guides, including architectural diagrams
- **Stability Improvements**: Under-the-hood performance and lifecycle fixes

## v0.6.1 - 2026-05-13

- **Native Tool Use**: Seamless agent interaction via native Tool Use support (removed legacy JSON parsing overhead)
- **One-Click Installation**: Add a new automated release installation script for quick vault setup
- **Simplified Guides**: Streamlined installation documentation and simplified developer workflows

## v0.6.0 - 2026-05-11

- **Product Rebranding**: Rename project from "ante-md" to "ante-obsidian"
- **Codebase Restructure**: Internal architectural improvements to facilitate faster features release
- **Cleanup**: Removed unused folders and legacy files for a cleaner repository footprint

## v0.5.3 - 2026-04-16

- **File Attachments**: Add file attachments support directly inside the Chat composer
- **Model Thinking Levels**: Add support for adjusting model thinking depth (Disabled, Enabled, Deep, Max) in settings
- **Reliable Staging**: Improved file preview staging robustness and workspace directory cleanups

## v0.5.2 - 2026-04-08

- **Target Switching**: Add runtime target switching directly in the chat interface
- **Quick Trigger**: Trigger the chat easily by typing `@ante` and hitting Enter
- **Resilient Sessions**: Robust session orchestration and diagnostics during network disconnections
- **Performance Improvements**: Refactored internal architecture for faster execution

## v0.5.1 - 2026-04-06

- **Streamlined Settings**: Easily configure Ante providers and override custom models in the settings tab
- **Polished UI/UX**: Enhanced glassmorphism effects, typography, and responsive layouts for the composer
- **Better Observability**: Improved chat message interruption handling and real-time guidance
- **Auto-Resolve Shell**: Automatically look up the login shell command paths for easier environment setup

## v0.5.0 - 2026-04-03

- **Smart Note Diffs**: Improve code block diff application and heading anchor matching in your notes
- **Ante Updates**: Add Ante runtime version check and update controls directly inside the settings tab
- **Session Stability**: Stabilized chat session handoffs and process logs streaming

## v0.4.2 - 2026-03-29

- **Product Naming**: Consistent product-facing labels and UI text updated to "Ante Obsidian"
- **Snapshot Persistence**: Automatically persist chat artifact snapshots

## v0.4.1 - 2026-03-29

- **Consistent ID**: Updated internal plugin identifier to `ante-obsidian`

## v0.4.0 - 2026-03-27

- **Rich Context Chat**: Render rich markdown and automatically enrich note/vault context inside your conversations
- **Preset Reordering**: Redesigned chat sidebar with drag-and-drop support for preset reordering
- **Refined Composer**: Fresh layout and interaction styling for the composer and side panel
- **Onboarding Docs**: Comprehensive update to user guides and reference files

## v0.3.1 - 2026-03-24

- **Chat Reset**: Clear and reset conversations with a new UI button
- **Renamed View**: Terminal view renamed to "Chat with Ante" to reflect its interactive nature

## v0.3.0 - 2026-03-24

- **Interactive Console**: Replaced standard terminal view with the fully interactive "Chat with Ante" experience
- **Smoother Terminal**: Enhanced CLI output rendering and stdout streaming

## v0.2.0 - 2026-03-24

- **Note Diff Previews**: Interactive inline diff previews and approval controls for editing notes
- **Easy Preset Triggering**: Invocation of custom prompts directly via Vault context menus and editor mentions
- **Auto-Discovery**: Automatic discovery of the local `ante` runtime binary path
- **Release Packages**: Automated release ZIP generation for easy manual installations

## v0.1.2 - 2026-03-22

- **Interactive Tool Approvals**: Safe, interactive prompt screens for terminal commands executed by the agent
- **Vault Setup**: Standard installation guidelines and licensing

## v0.1.1 - 2026-03-21

- **Initial Release**: Initial release of the Obsidian desktop integration plugin
