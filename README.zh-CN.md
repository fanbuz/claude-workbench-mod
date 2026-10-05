# claude-workbench-mod

[English](README.md) | **简体中文**

给 [Claude Code](https://claude.com/claude-code) 的工作过程加一个可视化工作台：输入框上方是实时旁白条，侧边面板可以查看本轮步骤、工作区改动和每一轮的历史记录。基于 Claude Code 的 function hooks（mod），在 Desktop 的 Code 标签页和终端里都能用。

> function hooks 目前是 Claude Code 的早期功能，接口可能随版本变化。

本 mod 的思路参考了 [Wangnov/shnote](https://github.com/Wangnov/shnote)：shnote 让 AI Agent 在执行命令前写明 WHAT / WHY，让人一眼看懂它在做什么；这里沿用同样的想法，用 function hooks 在 Claude Code 界面上实时生成并展示每一步在做什么、为什么。

## 功能

### 旁白条（输入框上方）

```
正在读 README，了解项目定位                                ● ● ○
────────────────────────────────────────────────────────
步骤 5 步 ›   用时 1m03s   改动 3 个文件 ›   ▸ Bash · ls -la
↑ 4   ↓ 2.3k   ≡↑ 688k   ≡↓ 2.3k   ❝ 1.3k  │  ◎ 99%   $ 0.127   ▤ ▰▰▰▱▱▱▱▱▱▱ 26%
```

- **旁白**：用 Haiku 根据你的请求、最近的工具调用和模型正在思考或书写的内容，生成一句简短的说明；一轮结束后换成一句总结。右侧圆点表示工作中，结束后变成 ✓。
- **进度**：步数、用时、失败次数、改动文件数、当前工具，都可以点击，直接打开工作台对应的标签页。
- **token**：输入、输出、缓存读、缓存写、旁白自身用量，以及缓存命中率、本轮花费、上下文占用。Desktop 上是 SVG 小图标，终端里是 Unicode 符号；输入和输出增长时图标会短暂高亮。

### 工作台面板（`/workbench`）

| 标签页 | 内容 |
| --- | --- |
| **本轮** | 这一轮每次工具调用的状态（✓ / ✕ / 运行中）、工具、命令、耗时；点一行展开完整命令和失败原因，可以复制、填入输入框，失败的步骤还能一键"让 Claude 排查并重试" |
| **改动** | 当前分支、工作区改动文件和增删行数；单独列出 Claude 本次会话改过的文件；点文件名把 `@路径` 填进输入框；"让 Claude 总结改动""生成提交信息"两个快捷指令 |
| **历史** | 每一轮的记录：时间、项目、请求、旁白总结、步骤数、用时、token 细分、花费、改过的文件。本会话汇总、最近几轮的花费柱状图、按天分组的记录列表、"复制今天的工作记录"（Markdown），上下文超过 50% 时显示"压缩上下文"按钮 |

改动页在每轮结束时自动刷新。历史在本会话和跨会话之间保留（最多 300 轮，由 Claude Code 存在本机）。

### 配置

在 `/config` 菜单里修改，保存后插件自动重载；也可以直接写进 `~/.claude/settings.json`：

```json
{
  "pluginConfigs": {
    "workbench": {
      "options": { "language": "zh", "narratorMode": "lite", "bandMode": "status" }
    }
  }
}
```

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `auto` | `auto` 先看 Claude Code 的 `language` 设置，再看系统语言（`LC_ALL` / `LANG`）；`en` 英文；`zh` 简体中文 |
| `bandMode` | `band` | `band` 输入框上方的横幅；`status` 状态栏一行，不占横幅位置，可以和其他画在横幅上的插件共存；`off` 只用 `/workbench` 面板 |
| `narratorMode` | `full` | `full` 读工具调用和模型的思考、回复；`lite` 只在工具调用时更新；`off` 不调用模型，旁白直接显示当前步骤 |
| `narratorIntervalSeconds` | `8` | 两次旁白更新至少间隔多少秒（3–120） |
| `narratorMaterialChars` | `400` | `full` 模式下，模型新写出多少字才再更新一次（100–5000） |

### 成本

每次旁白调用一次 Haiku。默认两次更新至少间隔 8 秒，新内容满 400 字才再更新，每次只带最近 6 步和思考、回复的节选，一般占每轮花费的几个百分点。旁白条里"❝"一项就是它自己用掉的 token。花费和上下文数字取自会话自己的账本，不额外调用 API。想更省就切到 `lite`，完全不想花就用 `off`。

## 安装

需要较新版本的 Claude Code。

**终端**

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./plugins/workbench
```

**Desktop**：Desktop 启动的会话不能传命令行参数，在 `~/.claude/settings.json` 的 `env` 里用 `CLAUDE_CODE_PLUGIN_DIRS` 指定插件目录（绝对路径）：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-workbench-mod/plugins/workbench"
  }
}
```

输入框上方只有一个横幅位置，如果同时加载了其他也画在这里的插件，把 `bandMode` 设为 `status`。

## 开发

```bash
claude plugin validate plugins/workbench   # 按引擎的规则检查清单、hooks 和状态声明
claude plugin test plugins/workbench       # 在 terminal / desktop 两个表面挂载并驱动组件
```

| 文件 | 内容 |
| --- | --- |
| `hooks/register.tsx` | 入口：所有 hook、旁白、git 刷新、历史，以及旁白条和面板的绘制。引擎只允许 `$` 在入口文件内流转，所以用到 `$` 的逻辑都在这里 |
| `hooks/lib.ts` | 纯函数：配色、图标、格式化、git 输出解析、历史相关 |
| `hooks/i18n.ts` | 中英文界面文案和旁白提示词，以及语言检测 |
| `types/index.d.ts` | `$.state` 的类型约定，`claude plugin validate` 据此检查读写的状态键 |
| `tests/workbench.test.tsx` | 用模拟的模型响应、工具调用和 git 输出驱动旁白条和面板 |

`tsconfig.json` 继承 Claude Code 加载插件时生成的类型声明（`.claude-plugin/types/`，不入库），用编辑器或 `tsc` 做类型检查前先加载一次插件。

## 许可

[MIT](LICENSE)

## 版本与路线

见 [CHANGELOG.md](CHANGELOG.md)。v0.1.0 的独立插件（narrator、tool-ecg）见 tag [`v0.1.0`](../../tree/v0.1.0)。后续计划见 [issues](../../issues) 和 [里程碑](../../milestones)。
