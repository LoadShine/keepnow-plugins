# KeepNow — Codex plugin

Turn Codex sessions into clean, searchable Markdown notes on
[KeepNow](https://keepnow.app), then bring earlier notes back into context when
you need them.

## Install

```bash
codex plugin marketplace add loadshine/keepnow-plugins
codex plugin add keepnow@keepnow-plugins
```

Start a new Codex session after installation. Open `/hooks` and trust the
KeepNow hooks after reviewing them; Codex does not automatically trust hooks
bundled with a plugin.

## Configure

Create a KeepNow API key at
[https://keepnow.app/my/install](https://keepnow.app/my/install), then save it
locally without sending it to the model:

```text
$keepnow --apikey kn-0123456789abcdef0123456789abcdef
```

The key is stored as `apikey` in `~/.keepnow/config.json`, readable only by your
user. `KEEPNOW_API_KEY`, when set, takes precedence over the saved key.

Verify the connection to KeepNow:

```text
$keepnow --status
```

## Use

| Command | What it does | Model tokens |
| --- | --- | --- |
| `$keepnow` | Show command help | no |
| `$keepnow --help` | Show command help | no |
| `$keepnow <description>` | Write up the session following the description | yes |
| `$keepnow --find <description>` | Search titles, summaries and keywords | no |
| `$keepnow --open <number-or-id-or-url>` | Read a note back into the current context | yes, including note body |
| `$keepnow --recent` | Show the last 10 notes | no |
| `$keepnow --status` | Show account, plan and usage | no |
| `$keepnow --apikey <key>` | Save the API key locally | no |

The description is a natural-language instruction, not just a topic:

```text
$keepnow summary
$keepnow all important findings
$keepnow the authentication bug, its cause, and the final fix
$keepnow --find Cloudflare D1 migration
$keepnow --open 2
$keepnow --open https://keepnow.app/my/notes/<id>
```

`--find` and `--recent` return numbered lists. Pass one of those numbers to
`--open`, or pass a note ID or current KeepNow note URL directly.

Codex handles help, search, recent notes, status, and API-key configuration in a
trusted `UserPromptSubmit` hook without invoking the model. Opening a note adds
its body to the active context; writing up a session uses the model.

## Session-safe updates

The plugin records note IDs against Codex's session ID under
`~/.keepnow/codex-sessions`. A `PreToolUse` hook attaches the real session ID and
working directory to each KeepNow MCP call. The mapping survives compaction and
resumed sessions; notes from other sessions cannot be updated through that
internal path.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `KEEPNOW_API_KEY` | no | saved configuration |
| `KEEPNOW_API_URL` | no | `https://keepnow.app` |
| `KEEPNOW_SESSION_DIR` | no | `~/.keepnow/codex-sessions` |
