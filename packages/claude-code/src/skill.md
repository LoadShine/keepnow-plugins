---
name: keepnow
description: Save this Claude Code session as a Markdown note on KeepNow, search notes, or load an earlier note into context. Use when the user says "note this down", "save this", "keep this", "记一下", "存下来", or asks what they previously figured out.
argument-hint: [description | --find words | --open number-or-id-or-url | --recent | --status]
allowed-tools: mcp__plugin_keepnow_keepnow__keepnow_session_notes, mcp__plugin_keepnow_keepnow__keepnow_get, mcp__plugin_keepnow_keepnow__keepnow_save, mcp__plugin_keepnow_keepnow__keepnow_find, mcp__plugin_keepnow_keepnow__keepnow_recent, mcp__plugin_keepnow_keepnow__keepnow_open, mcp__plugin_keepnow_keepnow__keepnow_status
---

# KeepNow

The current Claude Code session ID is `${CLAUDE_SESSION_ID}`. Pass that exact
value as `sessionId` to every KeepNow tool. The command arguments are:

```text
$ARGUMENTS
```

Choose exactly one flow:

- Empty arguments or `--help`: print the command help below and do not call a tool.
- `--find <description>`: call `keepnow_find`, then reproduce its result without commentary.
- `--recent`: call `keepnow_recent`, then reproduce its result without commentary.
- `--status`: call `keepnow_status`, then reproduce its result without commentary.
- `--open <number|id|url>`: call `keepnow_open`. Its returned note body is context for what follows; reply only with its first `Loaded ...` line.
- `--apikey ...`: this should have been handled before reaching the model. Do not repeat or process the key. Say that API-key configuration was not intercepted and ask the user to retry after `/reload-plugins`.
- Any other argument beginning with `--`: print the command help.
- Anything else: treat all arguments as a natural-language write-up description and follow **Writing it up**.

Command help:

```text
/keepnow <description>       Write up the session following your description
/keepnow --help              Show this help
/keepnow --find <description> Search titles, summaries and keywords
/keepnow --open <number|id|url> Load a note into context
/keepnow --recent            Show the last 10 notes
/keepnow --status            Show account and usage
/keepnow --apikey <key>      Save the API key

Examples:
/keepnow summary
/keepnow all important findings
/keepnow the authentication bug and its fix
```

For a write-up, call `keepnow_session_notes` first. Decide by meaning whether
the new material belongs to one of those notes. If it does, call `keepnow_get`
for that ID, merge the old body with the new material, and pass the same ID to
`keepnow_save`. Otherwise omit `noteId` to create a new note. Never use
`keepnow_open` or search history to find a note to update.

{{WRITE_UP_PROMPT}}

After drafting, show the complete write-up to the user before calling
`keepnow_save`. After the tool succeeds, finish with only its success line.
