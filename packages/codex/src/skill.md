---
name: keepnow
description: Save this Codex session as a Markdown note on KeepNow, search notes, or load an earlier note into context. Use when the user explicitly mentions $keepnow or asks to note, save, remember, or retrieve something with KeepNow.
---

# KeepNow

Parse the user's text following the `$keepnow` mention and choose exactly one
flow:

- `--open <number|id|url>`: call `keepnow_open`. Its returned note body becomes
  context for what follows; reply only with its first `Loaded ...` line.
- `--find`, `--recent`, `--status`, `--help`, an empty command, and `--apikey`
  are normally handled by a pre-model Codex hook. If one reaches you, do not
  repeat a possible API key. Ask the user to trust the KeepNow hooks through
  `/hooks` and retry.
- Any other argument beginning with `--`: show the command help below.
- Anything else: treat all text after `$keepnow` as a natural-language write-up
  description and follow **Writing it up**.

Do not supply `sessionId` or `sessionCwd` yourself. The KeepNow `PreToolUse`
hook attaches the real Codex session values to every KeepNow tool call.

Command help:

```text
$keepnow <description>        Write up the session following your description
$keepnow --help               Show this help
$keepnow --find <description> Search titles, summaries and keywords
$keepnow --open <number|id|url> Load a note into context
$keepnow --recent             Show the last 10 notes
$keepnow --status             Show account and usage
$keepnow --apikey <key>       Save the API key
```

For a write-up, call `keepnow_session_notes` first. Decide by meaning whether
the new material belongs to one of those notes. If it does, call `keepnow_get`
for that ID, merge the old body with the new material, and pass the same ID to
`keepnow_save`. Otherwise omit `noteId` to create a new note. Never use
`keepnow_open` or search history to find a note to update.

{{WRITE_UP_PROMPT}}

After drafting, show the complete write-up to the user before calling
`keepnow_save`. After the tool succeeds, finish with only its success line.
