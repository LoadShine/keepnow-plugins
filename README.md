# KeepNow Plugins

The official plugin monorepo for [KeepNow](https://keepnow.app), with
integrations for Claude Code, Codex, and Pi.

Website: [https://keepnow.app](https://keepnow.app)

## Packages

| Package | Purpose | Distribution |
| --- | --- | --- |
| `@keepnow/plugin-core` | Shared API client, contracts, URL parsing and write-up prompt | Private workspace package |
| `pi-keepnow` | Native Pi extension with session-safe state | npm |
| `keepnow-claude-code` | Claude Code Skill, MCP tools and session-safe state | Claude Code marketplace |
| `keepnow-codex` | Codex Skill, MCP tools and session-safe Hooks | Codex marketplace |

## Development

```bash
pnpm install
pnpm check
```

Build and inspect the distributable packages:

```bash
pnpm build
pnpm pack:pi
pnpm pack:claude-code
```

Install the published Pi extension from npm:

```bash
pi install npm:pi-keepnow
```

The Claude Code plugin is distributed through the KeepNow marketplace:

```text
/plugin marketplace add loadshine/keepnow-plugins
/plugin install keepnow@keepnow-plugins
```

The Codex plugin is distributed from the same repository through its Codex
marketplace catalog:

```bash
codex plugin marketplace add loadshine/keepnow-plugins
codex plugin add keepnow@keepnow-plugins
```

Codex reads `.agents/plugins/marketplace.json` and installs only
`packages/codex`; it ignores the Pi and Claude Code packages.
