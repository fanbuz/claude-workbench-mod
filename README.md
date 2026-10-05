# claude-workbench-mod

一组 [Claude Code](https://claude.com/claude-code) 的 mod（基于 function hooks 的插件），在 Desktop 的 Code 标签页和终端里给 Claude 的工作过程加上可视化。

> function hooks 目前是 Claude Code 的早期功能，接口可能随版本变化。

## 包含的 mod

| mod | 位置 | 作用 |
| --- | --- | --- |
| [narrator](plugins/narrator) | 输入框上方的横幅 | 一句话实时旁白、进度、token 与花费统计；点击步数打开步骤面板 |
| [tool-ecg](plugins/tool-ecg) | 侧边面板（`/ecg`） | 把每次工具调用画成一次心跳 |

### narrator 旁白条

```
正在读 README，了解项目定位                                ● ● ○
────────────────────────────────────────────────────────
步骤 5 步 ›   用时 1m03s   ▸ Bash · ls -la
↑ 4   ↓ 2.3k   ≡↑ 688k   ≡↓ 2.3k   ❝ 1.3k  │  ◎ 99%   $ 0.127   ▤ ▰▰▰▱▱▱▱▱▱▱ 26%
```

- **旁白**：用 Haiku 根据请求、最近的工具调用和模型正在思考/书写的内容，生成一句不超过 25 字的中文说明；一轮结束后换成一句总结。
- **进度**：步数、用时、失败次数、当前工具。点击「步骤」打开侧边面板，逐条查看命令、状态和耗时，点一行展开完整命令和失败原因。
- **token**：输入、输出、缓存读、缓存写、旁白自身用量，以及缓存命中率、本轮花费、上下文占用。Desktop 上用 SVG 小图标，终端里退回 Unicode 符号；输入和输出增长时图标短暂高亮。
- **成本**：旁白两次更新至少间隔 8 秒，新素材满 400 字才再更新，只带最近 6 步和节选，一般占每轮花费的几个百分点。横幅里「旁白」一项就是它自己的用量。

### tool-ecg 心电图

`/ecg` 打开。颜色区分工具类型（读取、命令、编辑、网络、子代理、MCP），波高表示耗时，出错时波峰向下；鼠标悬停看具体命令。

## 使用

需要较新版本的 Claude Code。

**终端**

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir ./plugins/narrator --plugin-dir ./plugins/tool-ecg
```

**Desktop**：Desktop 启动的会话不能传命令行参数，在 `~/.claude/settings.json` 的 `env` 里用 `CLAUDE_CODE_PLUGIN_DIRS` 指定插件目录（多个目录用 `:` 分隔，写绝对路径）：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-workbench-mod/plugins/narrator:/path/to/claude-workbench-mod/plugins/tool-ecg"
  }
}
```

## 开发

```bash
claude plugin validate plugins/narrator   # 按引擎的规则检查清单、hooks 和状态声明
claude plugin test plugins/narrator       # 在 terminal / desktop 两个表面挂载并驱动组件
```

每个插件目录下的 `tsconfig.json` 继承 Claude Code 加载插件时生成的类型声明（`.claude-plugin/types/`，不入库），用编辑器或 `tsc` 做类型检查前先加载一次插件。

## 版本

见 [CHANGELOG.md](CHANGELOG.md)。
