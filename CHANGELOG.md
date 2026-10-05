# Changelog

## Unreleased

- **Long narration** (#17): the full narration is kept (it used to be clipped to 32 characters at the source), and the new `narrationOverflow` option chooses `truncate` (a **Full text** button expands it), `wrap` or `scroll` (a self-animating SVG on Desktop, wrap in the terminal).
- **Fix: terminal icons**: the terminal now shows the Unicode token symbols; it used to get the SVG's alt text because its element table also lists `Svg`.
- **Band entry buttons** (#16): "▤ Workbench" and "⚙ Settings" are pinned to the right end of the progress row; the step count is plain text now.
- **Fix: clicks lost while Claude works** (#15): nothing redraws on a fast timer any more. The working dots animate inside a non-interactive SVG (static dots in the terminal), the "This turn" tab updates with step events, and the band's elapsed time ticks every 5 s while working.
- **Token row legend** (#13, #18): click **ⓘ** at the end of the token row to show what each icon means. Hover cards were tried first and dropped: the surface's hover has no delay, so sweeping the pointer popped up a row of cards, and Desktop drew them white on white.
- **Settings pane** (#12): a "⚙ Settings" button in the workbench pane (or `/workbench settings`) opens a pane where each option is a row of choice buttons; a click saves it through `$.config.set`, the same path as `/config`, so options can be changed in the Desktop Code tab too.

## 0.3.0

- **History tab** (#3): every turn is recorded with its request, narrator summary, steps, duration, token breakdown, cost and edited files, for the session and across sessions (300 turns max). Session totals, a cost chart of recent turns, records grouped by day, "copy today's work log" as Markdown, and a two-step "compact context" button above 50% context usage.
- **Narration placement** (#7): new `bandMode` option. `status` moves the narration to the status bar so other plugins can draw above the prompt; `off` keeps only the `/workbench` pane.
- **i18n** (#9): English and Chinese UI and narrator prompts, picked by the new `language` option (`auto` follows Claude Code's language setting, then the system locale). README is English-first, with [README.zh-CN.md](README.zh-CN.md) in Chinese.

## 0.2.1

- **Step quick actions** (#6): expand any step to copy the full command or put it in the prompt; a failed step can be handed to Claude to investigate and retry.
- **Configurable narrator** (#5): `narratorMode` (`full` / `lite` / `off`), `narratorIntervalSeconds` and `narratorMaterialChars`.
- **Docs** (#8): MIT license; credit to [Wangnov/shnote](https://github.com/Wangnov/shnote) for the idea.

## 0.2.0

The narration band and the steps pane merge into one `workbench` plugin with a tabbed side pane (#2).

- The band becomes the workbench's status bar: steps, failures and the current tool open **This turn**; "N files changed" opens **Changes**.
- `/workbench` pane:
  - **This turn**: status, tool, command and duration of every tool call, with the full command and failure reason on click.
  - **Changes**: branch and `git status` / `git diff --numstat` summary, files Claude edited in this session listed apart, `@path` into the prompt on click, and "summarize changes" / "draft a commit message" quick actions.
- Changes refresh at the end of each turn, and when the tab opens with data older than 30 seconds.
- The standalone `narrator` and `tool-ecg` plugins are removed (their features live in the workbench); the old code is at tag `v0.1.0`.
- Pure helpers move to `hooks/lib.ts`; the engine only lets `$` flow within the entry file, so code that uses `$` stays in `register.tsx`.

## 0.1.0

The first visual mods, exploring what Claude Code function hooks can do in the Desktop Code tab: bands, side panes, SVG and interaction (#1).

- **narrator**: a live narration band above the prompt.
  - Haiku condenses the request, tool calls and what the model is thinking or writing into one sentence, then a summary at the end of the turn.
  - A progress row (steps, time, failures, current tool); clicking the steps opens a steps pane with the full command and failure reason.
  - A token row with SVG icons for input, output, cache read, cache write and narrator usage, cache hit rate, cost of the turn and context usage.
  - Cost control: at least 8 seconds between updates, 400 new characters before updating, only the last 6 steps and excerpts per call.
- **tool-ecg**: a tool call "ECG" pane opened with `/ecg`; scrolling runs on the SVG's own SMIL animation to avoid redraw flicker.
