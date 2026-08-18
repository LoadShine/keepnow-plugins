# KeepNow — Claude Code plugin

Turn Claude Code sessions into clean, searchable Markdown notes on
[KeepNow](https://keepnow.app), then bring earlier notes back into context when
you need them.

## Install

```text
/plugin marketplace add loadshine/keepnow-plugins
/plugin install keepnow@keepnow-plugins
```

## Configure

Create a KeepNow API key at
[https://keepnow.app/my/install](https://keepnow.app/my/install), then save it
locally without sending it to the model:

```text
/keepnow --apikey kn-0123456789abcdef0123456789abcdef
```

The key is stored as `apikey` in `~/.keepnow/config.json`, readable only by your
user. `KEEPNOW_API_KEY`, when set, takes precedence over the saved key.

Verify the connection to KeepNow:

```text
/keepnow --status
```

## Use

| Command | What it does | Model tokens |
| --- | --- | --- |
| `/keepnow` | Show command help | yes |
| `/keepnow --help` | Show command help | yes |
| `/keepnow <description>` | Write up the session following the description | yes |
| `/keepnow --find <description>` | Search titles, summaries and keywords | yes |
| `/keepnow --open <number-or-id-or-url>` | Read a note back into the current context | yes, including note body |
| `/keepnow --recent` | Show the last 10 notes | yes |
| `/keepnow --status` | Show account, plan and usage | yes |
| `/keepnow --apikey <key>` | Save the API key locally | no |

The description is a natural-language instruction, not just a topic:

```text
/keepnow summary
/keepnow all important findings
/keepnow the authentication bug, its cause, and the final fix
/keepnow --find Cloudflare D1 migration
/keepnow --open 2
/keepnow --open https://keepnow.app/my/notes/<id>
```

`--find` and `--recent` return numbered lists. Pass one of those numbers to
`--open`, or pass a note ID or current KeepNow note URL directly.

The canonical namespaced command is `/keepnow:keepnow`. Claude Code also makes
`/keepnow` available when it does not conflict with another command. API-key
configuration is intercepted before model invocation; the other commands run
through the KeepNow skill.

## Session-safe updates

The plugin records note IDs against Claude Code's session ID in its persistent
plugin data directory. The mapping survives compaction and resumed sessions.
Before updating a same-session note, the model can retrieve its old body and
merge it with new material; notes from other sessions cannot be updated through
that internal path.

## Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `KEEPNOW_API_KEY` | no | saved configuration |
| `KEEPNOW_API_URL` | no | `https://keepnow.app` |
