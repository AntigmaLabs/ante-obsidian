# Ante md User Guide

Ante md is an Obsidian desktop plugin for Ante-powered Markdown workflows. It connects your local Ante runtime to note editing, diff review, chat, and terminal-style interaction inside Obsidian.

This guide is written for end users. It focuses on what Ante md can do today, where each feature is triggered, and where the results appear.

## What The Plugin Does

Ante md currently provides 6 main user-facing capabilities:

1. Trigger inline note actions by typing `@ante` and pressing `Enter` to submit the line.
2. Run built-in or custom presets from the editor context menu.
3. Ask follow-up questions in `Chat with Ante`.
4. Use `Ante Terminal` for a more terminal-style prompt flow.
5. Configure the local Ante runtime, provider, model, and currently supported credential options from plugin settings.
6. Manage preset visibility, ordering, and custom preset definitions from plugin settings.

## Feature 1: Inline Trigger Inside Notes

You can type this trigger directly in a Markdown note and press `Enter` to start it:

- `@ante`

### What It's For

`@ante` is best for direct work on the current paragraph, selection, or note content, such as rewriting, polishing, completing, or restructuring.

For more structured research, planning, or summarization, use presets from the context menu or command palette.

### What Happens After Triggering

- If you have selected text, Ante md uses the selection first.
- If there is no selection, Ante md tries to use the current paragraph around the cursor.
- The plugin inserts a temporary running placeholder into the note.
- If Ante returns plain text, the placeholder is replaced with the final content.
- If Ante returns inline Markdown changes, Ante md applies the changes directly and leaves a success message in the note.
- If Ante returns file-level or multi-file changes, Ante md applies them directly.

### Typical Uses

- Add `@ante` after a rough paragraph, then press `Enter` to rewrite it.
- Select a checklist or draft section and ask Ante md to clean up the wording.
- Use presets when the task already fits a repeatable pattern.

## Feature 2: Editor Context Menu Presets

When you right-click in the Obsidian editor with text selected, Ante md adds visible presets to the menu.

By default, the built-in presets are:

- `@ante`
- `@ante research`
- `@ante plan`
- `@ante summary`

Your custom presets can also appear here if they are enabled in settings.

The same menu also includes:

- `Chat with Ante`
- `Open Ante Terminal`

### Why This Matters

- You do not need to type trigger text manually.
- Built-in presets cover common Markdown workflows such as research, plan drafting, and summary generation.
- Custom presets let you encode your own repeatable prompt instructions.
- The menu order follows your preset order from settings.

## Feature 3: Command Palette Commands

Ante md also registers these commands in the Obsidian command palette:

- `Chat with Ante`
- `Open Ante Terminal`
- `Run @ante on current note`
- `Run @ante research on current note`
- `Run @ante plan on current note`
- `Run @ante summary on current note`

### Good Use Cases

- You prefer keyboard-driven workflows.
- You want to reopen the chat or terminal panel quickly.
- You repeatedly run the same built-in preset on the current note.

## Feature 4: Chat with Ante

`Chat with Ante` is a note-aware multi-turn conversation panel. It is useful when you want to discuss a note, ask follow-up questions, or inspect generated changes without immediately editing the document inline.

### Main Capabilities

- Start a new conversation from the sidebar
- Switch between saved conversations
- Rename or delete conversations
- Reuse the current note context automatically
- Continue follow-up prompts in the same conversation
- Render Markdown replies
- Show runtime progress, tool approval cards, and generated change summaries

### Good Use Cases

- Explore ideas before changing a note
- Ask follow-up questions after a previous task
- Discuss the current note in relation to its vault path and nearby documentation structure
- Review generated diff summaries inside the conversation flow

### Context Behavior

- The active note or selection is captured as chat context when useful.
- Chat can reuse pinned context from the current conversation.
- Recent updates added richer vault-aware context, so note path and vault path are available to Ante during chat tasks.

## Feature 5: Ante Terminal

`Ante Terminal` provides a more terminal-like interaction model. It shows prompts, streamed output previews, system logs, task status, and tool approval controls.

### Main Capabilities

- Send prompts in a terminal-style flow
- View streaming output while the task is running
- Inspect system messages and errors
- Approve or deny Ante tool calls when required
### Tool Approval

If Ante asks to use tools during a run, the terminal view can show an approval card with these actions:

- `Approve once`
- `Allow session`
- `Deny`

## Feature 6: Settings And Preset Management

Besides runtime configuration, Ante md now includes dedicated update checks and preset management sections in settings.

### Available Settings

- Auto-approve Ante tool calls
- Show full process logs
- Whether to use provider and model from `~/.ante/settings.json`
- Manual provider and model selection
- Supported providers include `openai-subscription`, `gemini`, and `anthropic`
- Gemini API key or its environment variable name
- Plugin update checks and local Ante Runtime update checks
- Install or upgrade Ante Runtime directly from settings
- Mention trigger debug notices
- Preset visibility controls
- Drag-and-drop preset reordering
- Create, edit, and delete custom presets

### Why These Settings Matter

- You can reuse your existing Ante configuration.
- You can override provider and model inside the plugin.
- If Ante is not ready locally yet, you can check status and complete install or upgrade steps from settings.
- You can simplify the editor menu to only show the presets you actually use.
- You can add team- or workflow-specific presets without changing code.

## A Typical Workflow

1. Open a Markdown note.
2. Select text or place the cursor in the target paragraph.
3. Trigger Ante md with `@ante` plus `Enter`, a preset from the context menu, or a command palette action.
4. If the result is inline text, it appears in the note.
5. If you need follow-up discussion, continue in `Chat with Ante`.
6. If you want a more runtime-focused flow, use `Ante Terminal`.

## Requirements

Ante md does not provide model access by itself. It depends on a working local Ante runtime.

Before using Ante md, make sure:

- You are on Obsidian desktop
- Ante md is installed and enabled
- The standard `ante` command runs on your machine, or you can install it first from Ante md settings
- Ante provider and model are already configured; if you use Gemini, you can also fill in or override the API key from plugin settings

If Ante is not available, Ante md will not work.

## Summary

In one sentence, Ante md is:

"Ante-powered Markdown workflows inside Obsidian, so you can trigger AI actions in notes, inspect diffs, manage reusable presets, and continue follow-up interactions in chat or terminal views."

For day-to-day use, the most important things to learn first are:

- `@ante` plus `Enter` for quick inline edits
- Built-in and custom presets from the context menu
- `Chat with Ante` for note-aware follow-up conversations
