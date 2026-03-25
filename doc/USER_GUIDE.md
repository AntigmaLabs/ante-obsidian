# Tmd User Guide

Tmd is an Obsidian desktop plugin for Ante-powered terminal Markdown workflows. It connects your local Ante runtime to your note editing flow so you can rewrite, expand, plan, and inspect Markdown directly inside Obsidian.

This guide is written for end users. It focuses on what Tmd can do, where each feature is triggered, and where the results appear.

## What The Plugin Does

Tmd currently provides 6 main user-facing capabilities:

1. Trigger AI actions directly inside notes with `@ante`.
2. Run built-in presets from the editor context menu or command palette.
3. Review Markdown changes and diffs in `Tmd Results`.
4. Ask free-form follow-up questions in `Chat with Ante`.
5. Use a terminal-style interaction flow in `Ante Terminal`.
6. Configure the local Ante runtime, provider, model, and credentials from plugin settings.

## Feature 1: Inline Triggers Inside Notes

You can type this trigger directly in a Markdown note:

- `@ante`

### What It's For

- `@ante`
  Best for direct work on the current paragraph, selection, or note content, such as rewriting, polishing, completing, or restructuring.

For research or planning tasks, please use the context menu or command palette instead.

### What Happens After Triggering

- If you have selected text, Tmd uses the selection first.
- If there is no selection, Tmd tries to use the current paragraph around the cursor.
- The plugin inserts a temporary running placeholder into the note.
- If Ante returns plain text, the placeholder is replaced with the final content.
- If Ante returns document changes, Tmd applies the changes directly and leaves a success message in the note.

### Typical Uses

- Add `@ante` after a rough paragraph to rewrite it.
- Use the context menu `@ante research` action under a topic heading to generate research notes.
- Use the context menu `@ante plan` action from a meeting note or idea draft to turn it into an execution plan.

## Feature 2: Editor Context Menu Actions

When you right-click in the Obsidian editor, Tmd adds these entries:

- `@ante`
- `@ante research`
- `@ante plan`
- `Chat with Ante`
- `Open Ante Terminal`

### Why This Matters

- You do not need to type the trigger text manually.
- It is a faster way to run a preset on the current note or current selection.
- If a task returns Markdown changes, Tmd tries to apply them automatically.
- If auto-apply fails, or if you want to inspect the change, open `Tmd Results`.

## Feature 3: Command Palette Commands

Tmd also registers these commands in the Obsidian command palette:

- `Open Tmd Results`
- `Chat with Ante`
- `Open Ante Terminal`
- `Run @ante on current note`
- `Run @ante research on current note`
- `Run @ante plan on current note`

### Good Use Cases

- You prefer keyboard-driven workflows.
- You want to reopen the results, console, or terminal panel quickly.
- You repeatedly run the same preset on the current note.

## Feature 4: Tmd Results

`Tmd Results` is the main panel for reviewing task output. It can show plain text output and Markdown diffs.

### What You Can See There

- The current task status
- Plain text results
- The target file or selection location for each change
- Addition and removal counts
- Unified diff previews

### What It Helps With

- Understanding exactly what Ante changed
- Verifying whether the edit matches your expectation
- Distinguishing between selection replacement, block append, whole-file replacement, and file creation

### Supported Change Types

Tmd currently supports these Markdown change operations:

- `replace-selection`
- `append-block`
- `replace-file`
- `create-file`

### Why The Results Panel Matters

When Ante returns structured document edits instead of just text, `Tmd Results` is the primary place to inspect the scope, target, and effect of the change.

## Feature 5: Chat with Ante

`Chat with Ante` is a chat-style prompt panel. It is useful when you want to talk to Ante first instead of editing the document immediately.

### Main Capabilities

- Send arbitrary prompts
- Reuse the most recent note context automatically
- Keep a chat timeline
- Continue follow-up prompts in an existing session
- Show text results, logs, and change summaries

### Good Use Cases

- Explore ideas before changing a note
- Ask follow-up questions after a previous task
- Brainstorm additional angles or missing sections

### Difference From Inline Triggers

- Inline triggers are for acting directly inside the note.
- Chat is for exploratory interaction first, document changes second.

## Feature 6: Ante Terminal

`Ante Terminal` provides a more terminal-like interaction model. It shows prompts, streamed output previews, system logs, task status, and tool approval controls when needed.

### Main Capabilities

- Send prompts in a terminal-style flow
- View streaming output previews while the task is running
- Inspect system messages and errors
- Approve or deny Ante tool calls when required
- Open `Tmd Results` after the task prepares Markdown changes

### Tool Approval

If Ante asks to use tools during a run, the terminal view can show an approval card with these actions:

- `Approve once`
- `Allow session`
- `Deny`

This gives users more control in workflows where safety or runtime visibility matters.

## How Context Is Chosen

Tmd tries to infer the right Markdown context from your current editing state:

- If text is selected, the selection is preferred.
- If nothing is selected, Tmd may use the current paragraph.
- In Chat with Ante and Terminal, Tmd prefers the most recently captured note context.

In practice, this means you usually do not need to copy and paste note content manually. Put the cursor in the right place or select the target text first.

## Configuration Features

Besides editing workflows, Tmd also gives you several runtime settings for connecting to your local Ante setup.

### Available Settings

- Ante connection mode (`stdio` or `websocket`)
- Ante executable command
- Ante launch arguments
- Ante WebSocket address
- Working directory
- Auto-approve Ante tool calls
- Whether to use provider and model from `~/.ante/settings.json`
- Manual provider and model selection
- Gemini API key or its environment variable name
- Mention trigger debug notices

### Why These Settings Matter

- You can reuse your existing Ante configuration.
- You can choose between a local stdin/stdout connection and a WebSocket transport.
- You can override the provider and model inside the plugin.
- You can adapt Tmd to different local runtime setups.

## A Typical Workflow

1. Open a Markdown note.
2. Select text or place the cursor in the target paragraph.
3. Trigger Tmd with `@ante`, the context menu, or the command palette.
4. If the result is plain text, it appears in the note or results panel.
5. If the result is a document change, inspect it in `Tmd Results`.
6. If you need follow-up interaction, continue in `Chat with Ante` or `Ante Terminal`.

## Requirements

Tmd does not provide model access by itself. It depends on a working local Ante runtime.

Before using Tmd, make sure:

- You are on Obsidian desktop
- Tmd is installed and enabled
- `ante` runs on your machine
- Ante provider, model, and credentials are already configured

If Ante is not available, Tmd will not work.

## Summary

In one sentence, Tmd is:

"Ante-powered terminal Markdown workflows inside Obsidian, so you can trigger AI actions inside notes, inspect diffs, apply changes, and continue follow-up interactions."

For day-to-day use, the three most important things to learn first are:

- `@ante` for inline note actions, plus `@ante research` / `@ante plan` from the context menu or command palette
- `Tmd Results` for inspecting changes
- `Chat with Ante` and `Ante Terminal` for follow-up interaction
