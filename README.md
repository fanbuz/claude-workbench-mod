# claude-workbench-mod

**English** | [简体中文](README.zh-CN.md)

A workbench for [Claude Code](https://claude.com/claude-code) that shows what Claude is doing while it works: a live narration band above the prompt, and a side pane with this turn's steps, your working tree changes and a history of every turn. It is a mod built on Claude Code's function hooks and runs in the Desktop app's Code tab and in the terminal.

> Function hooks are an early Claude Code feature; the API may change between releases.

The idea comes from [Wangnov/shnote](https://github.com/Wangnov/shnote), which makes an AI agent state the WHAT and WHY of a command before running it so you can follow along at a glance. This mod applies the same idea inside Claude Code: function hooks generate and show, live, what each step is doing and why.

## Features

### Narration band (above the prompt)

```
Reading the README to learn what the project does          ● ● ○
────────────────────────────────────────────────────────
Step 5 ›   Time 1m03s   3 files changed ›   ▸ Bash · ls -la
↑ 4   ↓ 2.3k   ≡↑ 688k   ≡↓ 2.3k   ❝ 1.3k  │  ◎ 99%   $ 0.127   ▤ ▰▰▰▱▱▱▱▱▱▱ 26%
```

- **Narration**: Haiku turns your request, the latest tool calls and what the model is thinking or writing into one short sentence about what Claude is doing and why. When the turn ends it becomes a one-line summary. The dots on the right mean Claude is working; they become ✓ when it is done.
- **Progress**: steps, elapsed time, failures, changed files and the current tool. Each one is clickable and opens the matching workbench tab.
- **Tokens**: input, output, cache read, cache write and the narrator's own usage, plus cache hit rate, the cost of this turn and context usage. Small SVG icons on Desktop, Unicode symbols in the terminal; the input and output icons light up when they grow.

### Workbench pane (`/workbench`)

| Tab | What it shows |
| --- | --- |
| **This turn** | Every tool call in the turn with its status (✓ / ✕ / running), tool, command and duration. Click a row for the full command and the failure reason; copy it, put it in the prompt, or ask Claude to investigate and retry a failed step |
| **Changes** | Current branch, changed files with added and removed lines, and a separate list of files Claude edited in this session. Click a file name to put `@path` in the prompt. Two quick actions: ask Claude to summarize the changes, or draft a commit message |
| **History** | A record of every turn: time, project, request, narrator summary, steps, duration, token breakdown, cost and edited files. Session totals, a cost chart of recent turns, records grouped by day, "copy today's work log" as Markdown, and a "compact context" button once context passes 50% |

The Changes tab refreshes at the end of each turn. History is kept for the session and across sessions (up to 300 turns, stored locally by Claude Code).

### Configuration

Change the options in the `/config` menu (the plugin reloads on save), or put them in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "workbench": {
      "options": { "language": "en", "narratorMode": "lite", "bandMode": "status" }
    }
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `auto` | `auto` follows Claude Code's `language` setting, then the system locale (`LC_ALL` / `LANG`); `en` English; `zh` Simplified Chinese |
| `bandMode` | `band` | `band` above the prompt; `status` one line in the status bar, so other plugins that draw above the prompt can coexist; `off` only the `/workbench` pane |
| `narratorMode` | `full` | `full` reads tool calls plus the model's thinking and reply; `lite` updates on tool calls only; `off` makes no model calls and the band shows the current step |
| `narratorIntervalSeconds` | `8` | Minimum seconds between two narration updates (3–120) |
| `narratorMaterialChars` | `400` | In `full` mode, how many new characters the model writes before the narration updates again (100–5000) |

### Cost

Each narration is one Haiku call. By default updates are at least 8 seconds apart and wait for 400 new characters, and each call carries only the last 6 steps plus short excerpts, so the narrator is usually a few percent of a turn's cost. The `❝` figure in the band is exactly what it used. Cost and context figures come from the session's own ledger and make no extra API calls. Use `lite` to spend less, or `off` to spend nothing.

## Install

Requires a recent Claude Code.

**Terminal**

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./plugins/workbench
```

**Desktop**: sessions started by the Desktop app take no command-line flags. Point `CLAUDE_CODE_PLUGIN_DIRS` at the plugin (absolute path) in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-workbench-mod/plugins/workbench"
  }
}
```

There is only one slot above the prompt. If another plugin also draws there, set `bandMode` to `status`.

## Development

```bash
claude plugin validate plugins/workbench   # checks the manifest, hooks and state contract the way the engine does
claude plugin test plugins/workbench       # mounts and drives the UI on the terminal and desktop surfaces
```

| File | Contents |
| --- | --- |
| `hooks/register.tsx` | Entry point: every hook, the narrator, git refresh, history, and the band and pane drawing. The engine only lets `$` flow within the entry file, so everything that touches `$` lives here |
| `hooks/lib.ts` | Pure functions: colors, icons, formatting, git output parsing, history helpers |
| `hooks/i18n.ts` | English and Chinese strings and narrator prompts, and language detection |
| `types/index.d.ts` | The `$.state` contract that `claude plugin validate` checks reads and writes against |
| `tests/workbench.test.tsx` | Drives the band and pane with simulated model responses, tool calls and git output |

`tsconfig.json` extends the type declarations Claude Code generates when it loads the plugin (`.claude-plugin/types/`, not committed); load the plugin once before type-checking in an editor or with `tsc`.

## License

[MIT](LICENSE)

## Versions and roadmap

See [CHANGELOG.md](CHANGELOG.md). The standalone v0.1.0 plugins (narrator, tool-ecg) are at tag [`v0.1.0`](../../tree/v0.1.0). Planned work is tracked in [issues](../../issues) and [milestones](../../milestones).
