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

# Writing it up

Follow the WRITE-UP DESCRIPTION below as a natural-language instruction. It may specify the scope, emphasis, or format — for example `summary`, `all important findings`, or a particular topic. Include everything needed to satisfy it and skip unrelated material.

## First decide: new note, or update an existing one

Look back over the notes you have already created **in this session** through
keepnow (if any). Decide whether what you are about to write belongs to the
same topic as one of them.

- **Same topic** → fetch that note's body, fold the new material in, and write
  out a single reorganised note. `PATCH` it. Do not append a section at the
  bottom, and do not keep conclusions that later turned out to be wrong.
- **Different topic** → `POST` a new note.

Judge this by meaning, not by string matching — that is the whole reason a
model is doing it rather than a rule.

Two hard boundaries:

- Only consider notes **you created in this session**. Do not search the user's
  history, and do not modify any note from outside this session. The same topic
  having several notes written on different days is normal and expected; it is
  not your job to merge them.
- If the session context no longer tells you what you saved earlier, treat this
  as a new note. Creating a near-duplicate is a small annoyance; silently
  overwriting the wrong note is not.

## What to write

- **Title** — one line saying what this actually resolves. Not "Notes on X" or
  "Discussion about Y".
- **Summary** — one or two sentences. **This is also the search index**, so put
  the real error text, API names and library names in it. A summary that reads
  beautifully but contains none of the words the user would search for has
  failed at half its job.
- **Keywords** — 5 to 10 comma-separated retrieval terms. Include the raw error
  fragment, alternative phrasings, and the names of every tool involved. Think:
  what would I type into a search box three months from now?
- **Body** — Markdown. Keep the conclusion, the code that mattered, and **why
  this approach over the alternatives**. That last part is what makes the note
  worth more than the docs.
- **Cut** — dead ends we abandoned, repeated explanations, raw tool-call noise.
- **Keep** — the traps. A trap is worth writing up, but as *trap + cause +
  fix*, not as a transcript of the error output.
- **Tags** — 3 to 5, lowercase and hyphenated (`cloudflare-d1`, `r2`,
  `tanstack-start`).

Charts are supported: a fenced ` ```chart ` block containing JSON with `type`
(`bar` / `line` / `pie`), `title`, and the data. Only use one when the numbers
genuinely benefit from it.

## Redact before writing

Go through the body line by line. Replace every API key, token, password,
`.env` value, private hostname and internal IP with `<REDACTED>`.

Over-redact rather than under-redact. The server scans as a backstop and will
flag anything it catches, but it only matches known patterns — you understand
what you are looking at, and it does not.

Show the user the write-up first, then save it.

After drafting, show the complete write-up to the user before calling
`keepnow_save`. After the tool succeeds, finish with only its success line.
