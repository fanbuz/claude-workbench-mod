import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type {
  GitFile,
  GitSnapshot,
  Narration,
  NarrationPhase,
  StepView,
  TouchedFile,
  TurnRecord,
  TurnSteps,
  WorkbenchTab,
} from '../types'
import {
  ALERT,
  AMBER,
  CLAY,
  CLAY_MUTED,
  CLOUD,
  GLYPHS,
  ICONS,
  ICON_H,
  IDLE,
  OLIVE,
  SKY,
  STONE,
  ZERO,
  clip,
  clockTime,
  dayLabel,
  dayLog,
  detailOf,
  duration,
  editedPath,
  errorOf,
  fmtTokens,
  groupByDay,
  iconWidth,
  labelOf,
  mergeNumstat,
  money,
  narratorConfig,
  oneLine,
  parseStatus,
  recordMeta,
  shortLabel,
  shortTool,
  splitPath,
  statusColor,
  stepTime,
  tokenTotal,
  toolColor,
  usageChart,
} from './lib'
import type { IconKind, NarratorConfig } from './lib'
import { detectLang, setLang, tr } from './i18n'

// ── 状态 ──────────────────────────────────────────────────────────────────
const lineAtom = atom({ plugin: 'workbench', key: 'line' } as const, null as Narration | null)
const tickAtom = atom({ plugin: 'workbench', key: 'tick' } as const, 0)
const stepsAtom = atom({ plugin: 'workbench', key: 'steps' } as const, { request: '', items: [] } as TurnSteps)
const expandedAtom = atom({ plugin: 'workbench', key: 'expanded' } as const, null as string | null)
const tabAtom = atom({ plugin: 'workbench', key: 'tab' } as const, 'turn' as WorkbenchTab)
const touchedAtom = atom({ plugin: 'workbench', key: 'touched' } as const, [] as TouchedFile[])
const gitAtom = atom({ plugin: 'workbench', key: 'git' } as const, {
  isRepo: false,
  root: null,
  branch: null,
  files: [],
  isLoading: false,
  error: null,
  updatedAt: null,
} as GitSnapshot)
const historyAtom = atom({ plugin: 'workbench', key: 'history' } as const, [] as TurnRecord[])
const expandedTurnAtom = atom({ plugin: 'workbench', key: 'expandedTurn' } as const, null as string | null)
const confirmCompactAtom = atom({ plugin: 'workbench', key: 'confirmCompact' } as const, false)

const PANE = 'workbench'
const STORE_KEY = 'history'
const HISTORY_MAX = 300 // 跨会话最多留这么多轮
const MODEL = 'haiku'

const TICK_MS = 1000
const SPIN_MS = 450 // 圆点动画的帧间隔：慢一点，看着不累
const DOT_FRAMES = [1, 2, 3] // 至少亮一颗，不会出现全灭
const FLASH_MS = 1500 // token 增长后图标高亮多久
const TAIL = 800
const GIT_STALE_MS = 30_000
const MAX_ROWS = 40

const TABS: { id: WorkbenchTab; label: () => string }[] = [
  { id: 'turn', label: () => tr().tabTurn },
  { id: 'changes', label: () => tr().tabChanges },
  { id: 'history', label: () => tr().tabHistory },
]

// ── 这一轮的进度：模块变量，热重载时从头开始 ─────────────────────────────────
type Step = { tool: string; label: string; agent: boolean; ok: boolean | null; ms: number | null }
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

let request = ''
let steps: Step[] = []
let narratedAt = 0
let narratedSteps = 0
let isInFlight = false
let isWorking = false
let thinking = '' // 模型边想边写时流出来的文字，各留最近一段
let answering = ''
let material = 0
let narratedMaterial = 0
let isIntroPending = false // 刚发出请求，还没说第一句
let costAtStart: number | null = null
let turnFiles = new Set<string>() // 这一轮 Claude 改过的文件
let sessionId = ''
// 旁白配置：register 时从插件配置读入，配置一改模块就会重载
let config: NarratorConfig = narratorConfig({})

function feed(kind: 'thinking' | 'text', text: string) {
  if (kind === 'thinking') thinking = (thinking + text).slice(-TAIL)
  else answering = (answering + text).slice(-TAIL)
  material += text.length
}

const usageTotal = (u: Usage) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

// 实时旁白只需要最近几步、每步一短行；收尾总结看得多一些
const describe = (count = 10, width = 120) =>
  steps
    .slice(-count)
    .map((s, i) => {
      const m = tr()
      const state = s.ok === null ? m.stepRunning : s.ok ? m.stepDone(s.ms ?? 0) : m.stepFailed
      return `${i + 1}. ${s.agent ? m.subagent : ''}${s.tool}: ${clip(s.label, width) || m.noArgs} → ${state}`
    })
    .join('\n')

// ── 用量 ──────────────────────────────────────────────────────────────────
// 花费和上下文占用取自会话自己的账本（和状态栏、/cost 同一份），这次调用不花钱
async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage()
  const usd = u.cost?.usd
  await update($, lineAtom, l =>
    l
      ? {
          ...l,
          costUsd: usd !== undefined && costAtStart !== null ? Math.max(0, usd - costAtStart) : l.costUsd,
          contextPercent: u.context.percent ?? l.contextPercent,
        }
      : l,
  )
}

async function addTurnUsage($: EngineInterface, u: Usage) {
  const now = Date.now()
  const at = (delta: number, prev: number) => (delta > 0 ? now : prev)
  await update($, lineAtom, l =>
    l
      ? {
          ...l,
          changedAt: {
            input: at(u.input_tokens, l.changedAt.input),
            output: at(u.output_tokens, l.changedAt.output),
            cacheRead: at(u.cache_read_input_tokens, l.changedAt.cacheRead),
            cacheWrite: at(u.cache_creation_input_tokens, l.changedAt.cacheWrite),
          },
          tokens: {
            input: l.tokens.input + u.input_tokens,
            output: l.tokens.output + u.output_tokens,
            cacheRead: l.tokens.cacheRead + u.cache_read_input_tokens,
            cacheWrite: l.tokens.cacheWrite + u.cache_creation_input_tokens,
          },
        }
      : l,
  )
  await refreshUsage($).catch(() => undefined)
}

async function addNarratorUsage($: EngineInterface, u: Usage | undefined) {
  if (!u) return
  await update($, lineAtom, l => (l ? { ...l, narratorTokens: l.narratorTokens + usageTotal(u) } : l))
}

// ── 旁白 ──────────────────────────────────────────────────────────────────
// 只在有新步骤或新素材、距上次够久、且没有请求在飞时才调用模型
async function narrateLive($: EngineInterface) {
  if (isInFlight || !isWorking || config.mode === 'off') return
  // 节能模式：只在工具调用时更新，不读思考和回复，也不在开头单独说一句
  const isFull = config.mode === 'full'
  const isIntro = isIntroPending && isFull
  const hasNew = isIntro || steps.length !== narratedSteps || (isFull && material - narratedMaterial >= config.materialStep)
  if (!hasNew) return
  if (!isIntro && Date.now() - narratedAt < config.minGapMs) return
  isInFlight = true
  isIntroPending = false
  narratedSteps = steps.length
  narratedMaterial = material
  narratedAt = Date.now()
  await update($, lineAtom, l => (l ? { ...l, isThinking: true } : l))
  try {
    const r = await $.model.complete({
      model: MODEL,
      system: tr().systemLive,
      prompt: [
        `${tr().pRequest}\n${request.slice(0, 300)}`,
        steps.length ? `${tr().pRecentTools}\n${describe(6, 80)}` : tr().pNoTools,
        isFull && thinking ? `${tr().pThinking}\n${thinking.slice(-400)}` : '',
        isFull && answering ? `${tr().pAnswer}\n${answering.slice(-200)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      maxTokens: 120,
      effort: 'low',
      timeoutMs: 10_000,
    })
    await addNarratorUsage($, r.usage)
    if (r.isAnswered && isWorking) {
      const text = oneLine(r.text)
      if (text) await update($, lineAtom, l => (l && l.phase === 'working' ? { ...l, text } : l))
      await syncStatus($)
    }
  } finally {
    isInFlight = false
    await update($, lineAtom, l => (l ? { ...l, isThinking: false } : l))
  }
}

async function narrateDone($: EngineInterface, reply: string, isAborted: boolean) {
  const endedAt = Date.now()
  // 关闭了模型旁白，或没调用工具的简短问答，都不值得再花一次模型调用
  const isQuick = config.mode === 'off' || (steps.length === 0 && reply.length < 200)
  await update($, lineAtom, l =>
    l
      ? { ...l, phase: (isAborted ? 'interrupted' : 'done') as NarrationPhase, current: '', endedAt, isThinking: !isAborted && !isQuick }
      : l,
  )
  let text = ''
  if (isAborted) text = tr().aborted
  else if (isQuick) text = steps.length === 0 ? tr().answered : tr().doneSteps(steps.length)
  else {
    try {
      const r = await $.model.complete({
        model: MODEL,
        system: tr().systemDone,
        prompt:
          `${tr().pRequest}\n${request.slice(0, 600)}\n\n${tr().pSteps(steps.length)}\n${describe()}` +
          `\n\n${tr().pReply}\n${reply.slice(0, 1200)}`,
        maxTokens: 120,
        effort: 'low',
        timeoutMs: 15_000,
      })
      await addNarratorUsage($, r.usage)
      text = r.isAnswered ? oneLine(r.text) : ''
    } catch {
      // 模型没答上来就用兜底文案，下面照常收尾
    }
  }
  await refreshUsage($).catch(() => undefined)
  // 无论模型答没答、出没出错，都收起"更新中"，并把这一轮记进历史
  await update($, lineAtom, l => (l ? { ...l, text: text || tr().done, isThinking: false } : l))
  await recordTurn($)
  await syncStatus($)
}

// ── 历史 ──────────────────────────────────────────────────────────────────
async function recordTurn($: EngineInterface) {
  const l = await read($, lineAtom)
  if (!l) return
  const cwd = await $.session.cwd().catch(() => '')
  const record: TurnRecord = {
    id: String(l.startedAt),
    sessionId,
    project: cwd.split('/').filter(Boolean).pop() ?? '',
    startedAt: l.startedAt,
    endedAt: l.endedAt ?? Date.now(),
    request: clip(request.replace(/\s+/g, ' ').trim(), 300),
    summary: l.text,
    phase: l.phase,
    steps: l.steps,
    errors: l.errors,
    tokens: l.tokens,
    narratorTokens: l.narratorTokens,
    costUsd: l.costUsd,
    files: [...turnFiles].map(p => splitPath(p).name).slice(0, 20),
  }
  const merge = (list: readonly TurnRecord[]) => [record, ...list.filter(r => r.id !== record.id)].slice(0, HISTORY_MAX)
  await update($, historyAtom, merge)
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  await $.store.set(STORE_KEY, merge(Array.isArray(stored) ? (stored as TurnRecord[]) : [])).catch(() => undefined)
}

async function loadHistory($: EngineInterface) {
  const stored = await $.store.get(STORE_KEY).catch(() => undefined)
  if (!Array.isArray(stored)) return
  await update($, historyAtom, list => {
    const ids = new Set(list.map(r => r.id))
    return [...list, ...(stored as TurnRecord[]).filter(r => !ids.has(r.id))].sort((a, b) => b.startedAt - a.startedAt).slice(0, HISTORY_MAX)
  })
}

async function copyDayLog($: EngineInterface, surface: RenderSurface) {
  const log = dayLog(await read($, historyAtom))
  await copyText($, log, surface)
}

async function compactContext($: EngineInterface) {
  if (!(await read($, confirmCompactAtom))) {
    await update($, confirmCompactAtom, () => true)
    $.clock.after(5000, () => void update($, confirmCompactAtom, () => false))
    return
  }
  await update($, confirmCompactAtom, () => false)
  const r = await $.session.compact()
  $.ui.toast('skip' in r && r.skip ? tr().compactSkipped(r.skip) : tr().compacted)
  await refreshUsage($).catch(() => undefined)
}

// ── 状态栏：bandMode 为 status 时，旁白不占输入框上方，改显示在这里 ─────────────
async function syncStatus($: EngineInterface) {
  if (config.bandMode !== 'status') return
  const l = await read($, lineAtom)
  if (!l) return $.ui.status(undefined)
  const mark = l.phase === 'working' ? '●' : l.phase === 'done' ? '✓' : '✕'
  $.ui.status(tr().statusLine(mark, l.text, l.steps))
}

// 热重载会丢掉旧模块里还没跑完的旁白请求：新模块加载时把它留下的半截状态收尾
async function settleStale($: EngineInterface) {
  await update($, lineAtom, l => {
    if (!l || (!l.isThinking && l.phase !== 'working')) return l
    const isStaleLive = l.phase === 'working' || l.isThinking
    return {
      ...l,
      phase: l.phase === 'working' ? ('done' as NarrationPhase) : l.phase,
      text: isStaleLive ? tr().done : l.text,
      current: '',
      endedAt: l.endedAt ?? Date.now(),
      isThinking: false,
    }
  })
}

// ── 改动：git 工作区快照 ────────────────────────────────────────────────────
async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 })
    return exitCode === 0 ? stdout : null
  } catch {
    return null
  }
}

async function refreshGit($: EngineInterface) {
  const cwd = await $.session.cwd()
  await update($, gitAtom, g => ({ ...g, isLoading: true, error: null }))
  const root = (await git($, cwd, ['rev-parse', '--show-toplevel']))?.trim()
  if (!root) {
    await update($, gitAtom, () => ({ isRepo: false, root: null, branch: null, files: [], isLoading: false, error: null, updatedAt: Date.now() }))
    return
  }
  const [branch, status, numstat] = await Promise.all([
    git($, root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git($, root, ['status', '--porcelain=v1']),
    git($, root, ['diff', '--numstat', 'HEAD']).then(out => out ?? git($, root, ['diff', '--numstat'])),
  ])
  if (status === null) {
    await update($, gitAtom, g => ({ ...g, isLoading: false, error: tr().gitStatusFailed }))
    return
  }
  const files = mergeNumstat(parseStatus(status), numstat ?? '')
  await update($, gitAtom, () => ({
    isRepo: true,
    root,
    branch: branch?.trim() ?? null,
    files,
    isLoading: false,
    error: null,
    updatedAt: Date.now(),
  }))
}

// ── 本轮步骤的快捷操作 ─────────────────────────────────────────────────────
async function copyText($: EngineInterface, text: string, surface: RenderSurface) {
  const r = await $.ui.copy({ text, surface })
  $.ui.toast(r.isCopied ? tr().copied : tr().copyFailed('reason' in r ? r.reason : tr().unknownReason))
}

// ── 面板 ──────────────────────────────────────────────────────────────────
async function openPane($: EngineInterface, tab: WorkbenchTab) {
  await update($, tabAtom, () => tab)
  if (tab === 'changes' && Date.now() - ((await read($, gitAtom)).updatedAt ?? 0) > GIT_STALE_MS) void refreshGit($)
  await $.ui.open({ id: PANE, title: tr().paneTitle })
}

async function switchTab($: EngineInterface, tab: WorkbenchTab) {
  await update($, tabAtom, () => tab)
  if (tab === 'changes' && Date.now() - ((await read($, gitAtom)).updatedAt ?? 0) > GIT_STALE_MS) void refreshGit($)
}

export const register: Register = (on, options) => {
  config = narratorConfig(options)
  setLang(config.language === 'auto' ? 'en' : config.language) // auto 在 session.start 里再按设置和系统语言判断

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await settleStale($)
    if (config.language === 'auto') {
      const settings = (await $.settings.read().catch(() => ({}))) as Record<string, unknown>
      const locale = (await $.env.get('LC_ALL').catch(() => undefined)) || (await $.env.get('LANG').catch(() => undefined))
      setLang(detectLang(settings['language'], locale))
    }
    await $.command.register({ name: 'workbench', description: tr().cmdDescription })
    sessionId = await $.session.id().catch(() => '')
    void loadHistory($)
    if (config.bandMode !== 'status') $.ui.status(undefined)
    void refreshGit($)

    // 圆点动画的帧（也顺带让耗时走起来），只在工作中转
    $.clock.every(SPIN_MS, () => {
      if (isWorking) void update($, tickAtom, n => n + 1)
    })
    // 每秒看一次要不要生成新旁白
    $.clock.every(TICK_MS, () => {
      if (isWorking) void narrateLive($)
    })
    return started
  })

  on('command.run', { command: 'workbench' }, async $ => {
    await openPane($, await read($, tabAtom))
    return { text: tr().cmdOpened }
  })

  on('prompt.submit', async ($, e, next) => {
    request = e.text
    steps = []
    narratedSteps = 0
    narratedAt = 0
    thinking = ''
    answering = ''
    material = 0
    narratedMaterial = 0
    isIntroPending = true
    isWorking = true
    turnFiles = new Set()
    await update($, stepsAtom, () => ({ request: e.text.replace(/\s+/g, ' ').slice(0, 200), items: [] }))
    await update($, expandedAtom, () => null)
    costAtStart = await $.session.usage().then(
      u => u.cost?.usd ?? null,
      () => null,
    )
    await update($, lineAtom, () => ({
      phase: 'working' as NarrationPhase,
      text: tr().understanding,
      current: '',
      steps: 0,
      errors: 0,
      startedAt: Date.now(),
      endedAt: null,
      isThinking: false,
      tokens: ZERO,
      narratorTokens: 0,
      costUsd: costAtStart === null ? null : 0,
      contextPercent: null,
      changedAt: ZERO,
    }))
    await syncStatus($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    for await (const chunk of next(e)) {
      if (isWorking) {
        if (chunk.kind === 'thinking' || chunk.kind === 'text') feed(chunk.kind, chunk.text)
        if (chunk.kind === 'stop' && chunk.usage) void addTurnUsage($, chunk.usage)
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as Record<string, unknown>
    const step: Step = { tool: e.tool, label: labelOf(args), agent: e.agentId !== undefined, ok: null, ms: null }
    const startedAt = Date.now()
    const id = e.tool_use_id ?? `${e.tool}-${startedAt}`
    steps.push(step)
    const view: StepView = { id, tool: step.tool, label: step.label, detail: detailOf(args), agent: step.agent, ok: null, startedAt, ms: null, error: null }
    await update($, stepsAtom, s => ({ ...s, items: [...s.items, view].slice(-200) }))
    const current = `${shortTool(step.tool)}${step.label ? ` · ${shortLabel(step.label)}` : ''}`
    await update($, lineAtom, l =>
      l ? { ...l, current, steps: steps.length, text: config.mode === 'off' && isWorking ? tr().running(current) : l.text } : l,
    )
    await syncStatus($)

    let ok = false
    let error: string | null = tr().interrupted
    try {
      const ran = await next(e)
      ok = ran.deny === undefined && ran.isError !== true
      error = errorOf(ran)
      return ran
    } finally {
      step.ok = ok
      step.ms = Date.now() - startedAt
      const ms = step.ms
      await update($, lineAtom, l => (l ? { ...l, errors: l.errors + (ok ? 0 : 1) } : l))
      await update($, stepsAtom, s => ({
        ...s,
        items: s.items.map(v => (v.id === id ? { ...v, ok, ms, error: ok ? null : error } : v)),
      }))
      // 记下 Claude 改过的文件，改动页据此标出"Claude 改的"
      const path = ok ? editedPath(e.tool, args) : null
      if (path) {
        turnFiles.add(path)
        const now = Date.now()
        await update($, touchedAtom, list => {
          const hit = list.find(f => f.path === path)
          const rest = list.filter(f => f.path !== path)
          return [{ path, edits: (hit?.edits ?? 0) + 1, lastAt: now }, ...rest].slice(0, 200)
        })
      }
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    if (isWorking) {
      isWorking = false
      void narrateDone($, e.answer, e.isAborted)
    }
    // 一轮结束：刷新改动
    void refreshGit($)
    return done
  })

  // ── 输入框上方的旁白条 ──────────────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = await read($, lineAtom)
    if (config.bandMode !== 'band' || e.props.hasSurvey || !line) return next(e)
    const frame = await read($, tickAtom) // 订阅动画帧
    const gitState = await read($, gitAtom)

    const resolved = $.ui.resolve(e)
    const { Box, Text, Button } = resolved
    const Svg = 'Svg' in resolved ? resolved.Svg : null
    const now = Date.now()
    const isWorkingNow = line.phase === 'working'
    const elapsed = duration((line.endedAt ?? now) - line.startedAt)
    const lit = DOT_FRAMES[frame % DOT_FRAMES.length]!
    const color = isWorkingNow ? CLAY : line.phase === 'done' ? CLAY_MUTED : STONE

    const t = line.tokens
    const hasTokens = t.input + t.output + t.cacheRead + t.cacheWrite > 0
    const prompt = t.input + t.cacheRead + t.cacheWrite
    const hitRate = prompt > 0 ? Math.round((t.cacheRead / prompt) * 100) : null
    const ctx = line.contextPercent
    const ctxColor = ctx === null ? CLOUD : ctx >= 85 ? ALERT : ctx >= 60 ? AMBER : CLAY_MUTED
    const ctxFilled = ctx === null ? 0 : Math.max(0, Math.min(10, Math.round(ctx / 10)))
    const rule = '─'.repeat(Math.max(10, Math.min(240, e.props.bodyColumns - 2)))
    const isFresh = (at: number) => isWorkingNow && now - at < FLASH_MS

    // 一个指标：图标 + 加粗数值；图标颜色表示类别，刚增长时换成高亮色、数值同色
    const stat = (kind: IconKind, value: string, tint: string, isLit = false) => {
      const c = isLit ? tint : kind === 'input' || kind === 'output' ? IDLE : tint
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          {Svg ? (
            <Svg source={ICONS[kind](c)} alt={tr().alt[kind]} width={iconWidth(kind)} height={ICON_H} />
          ) : (
            <Text color={c}>{GLYPHS[kind]}</Text>
          )}
          <Text bold color={isLit ? tint : undefined}>
            {value}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {/* 旁白占满左侧，状态钉在右侧固定宽度的格子里：文字长短变化不会挪动它 */}
        <Box flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text bold={isWorkingNow} color={color} wrap="truncate-end">
              {line.text}
            </Text>
          </Box>
          <Box width={6} flexShrink={0} justifyContent="flex-end">
            {isWorkingNow ? (
              <Text>
                {[0, 1, 2].map(i => (
                  <Text color={i < lit ? CLAY : CLOUD}>{i === 0 ? '●' : ' ●'}</Text>
                ))}
              </Text>
            ) : (
              <Text bold color={color}>
                {line.phase === 'done' ? '✓' : '✕'}
              </Text>
            )}
          </Box>
        </Box>

        <Text color={CLOUD} dimColor wrap="truncate-end">
          {rule}
        </Text>

        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Box key="open-steps">
            <Button
              key="steps"
              plain
              label={tr().bandSteps(isWorkingNow, line.steps)}
              hover={{ underline: true, color: CLAY }}
              onPress={() => void openPane($, 'turn')}
            />
          </Box>
          <Text>
            <Text dimColor>{tr().bandTime}</Text>
            <Text bold>{elapsed}</Text>
          </Text>
          {line.errors > 0 && (
            <Box key="open-errors">
              <Button
                key="errors"
                plain
                label={tr().bandFailures(line.errors)}
                hover={{ underline: true }}
                onPress={() => void openPane($, 'turn')}
              />
            </Box>
          )}
          {gitState.files.length > 0 && (
            <Box key="open-changes">
              <Button
                key="changes"
                plain
                label={tr().bandChanges(gitState.files.length)}
                hover={{ underline: true, color: CLAY }}
                onPress={() => void openPane($, 'changes')}
              />
            </Box>
          )}
          {line.current && (
            <Box key="open-current" minWidth={0}>
              <Button
                key="current"
                plain
                dimColor
                label={`▸ ${line.current}`}
                hover={{ underline: true, color: CLAY, dimColor: false }}
                onPress={() => void openPane($, 'turn')}
              />
            </Box>
          )}
        </Box>

        {hasTokens && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {stat('input', fmtTokens(t.input), CLAY, isFresh(line.changedAt.input))}
            {stat('output', fmtTokens(t.output), SKY, isFresh(line.changedAt.output))}
            {stat('cacheRead', fmtTokens(t.cacheRead), OLIVE)}
            {stat('cacheWrite', fmtTokens(t.cacheWrite), AMBER)}
            {line.narratorTokens > 0 && stat('narrator', fmtTokens(line.narratorTokens), IDLE)}
            <Text dimColor>│</Text>
            {hitRate !== null && stat('hit', `${hitRate}%`, CLAY_MUTED)}
            {line.costUsd !== null && stat('cost', line.costUsd.toFixed(line.costUsd < 1 ? 3 : 2), OLIVE)}
            {ctx !== null && (
              <Box flexDirection="row" alignItems="center" gap={1}>
                {Svg ? (
                  <Svg source={ICONS.context(ctxColor)} alt={tr().alt.context} width={ICON_H} height={ICON_H} />
                ) : (
                  <Text color={ctxColor}>{GLYPHS.context}</Text>
                )}
                <Text>
                  <Text color={ctxColor}>{'▰'.repeat(ctxFilled)}</Text>
                  <Text color={IDLE}>{'▱'.repeat(10 - ctxFilled)}</Text>
                  <Text bold color={ctxColor}>
                    {' '}
                    {Math.round(ctx)}%
                  </Text>
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })

  // ── 工作台面板：本轮 / 改动 ──────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const tab = await read($, tabAtom)
    const stepsState = await read($, stepsAtom)
    const gitState = await read($, gitAtom)
    const line = await read($, lineAtom)
    const now = Date.now()

    const counts: Record<WorkbenchTab, number> = {
      turn: stepsState.items.length,
      changes: gitState.files.length,
      history: (await read($, historyAtom)).filter(r => r.sessionId === sessionId).length,
    }

    const header = (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {TABS.map(t => (
          <Button
            key={`tab-${t.id}`}
            label={counts[t.id] ? `${t.label()} ${counts[t.id]}` : t.label()}
            variant={t.id === tab ? 'primary' : 'secondary'}
            onPress={() => void switchTab($, t.id)}
          />
        ))}
      </Box>
    )

    // ── 本轮 ──
    const turnView = async () => {
      const expanded = await read($, expandedAtom)
      await read($, tickAtom) // 运行中的步骤让耗时走起来
      const { request: req, items } = stepsState
      const isWorkingNow = line?.phase === 'working'
      const okCount = items.filter(v => v.ok === true).length
      const failCount = items.filter(v => v.ok === false).length
      const elapsed = line ? duration((line.endedAt ?? now) - line.startedAt) : ''
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{isWorkingNow ? tr().turnTitle : tr().lastTurnTitle}</Text>
            <Text dimColor wrap="truncate-end">
              {[tr().nSteps(items.length), okCount ? tr().nOk(okCount) : null, failCount ? tr().nFailed(failCount) : null, elapsed ? tr().timeSpent(elapsed) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {req && (
              <Text color={CLOUD} wrap="truncate-end">
                「{req}」
              </Text>
            )}
          </Box>
          {items.length === 0 && <Text dimColor>{tr().noSteps}</Text>}
          <Box flexDirection="column">
            {items.map((v, i) => {
              const isOpen = expanded === v.id
              const mark = v.ok === null ? '●' : v.ok ? '✓' : '✕'
              const markColor = v.ok === null ? CLAY : v.ok ? OLIVE : ALERT
              const ms = v.ms ?? now - v.startedAt
              return (
                <Box key={`step-${v.id}`} flexDirection="column" marginBottom={isOpen ? 1 : 0}>
                  <Box flexDirection="row" gap={1} alignItems="center">
                    <Box width={2} flexShrink={0}>
                      <Text bold color={markColor}>
                        {mark}
                      </Text>
                    </Box>
                    <Box width={3} flexShrink={0}>
                      <Text dimColor>{i + 1}</Text>
                    </Box>
                    <Box flexShrink={0}>
                      <Text bold color={toolColor(v.tool)}>
                        {v.agent ? '↳ ' : ''}
                        {shortTool(v.tool)}
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                      <Button
                        key={`toggle-${v.id}`}
                        plain
                        dimColor={!isOpen}
                        label={`${isOpen ? '▾' : '▸'} ${v.label ? shortLabel(v.label) : tr().noArgs}`}
                        hover={{ underline: true, dimColor: false }}
                        onPress={() => void update($, expandedAtom, cur => (cur === v.id ? null : v.id))}
                      />
                    </Box>
                    <Box flexShrink={0}>
                      <Text color={v.ok === null ? CLAY : undefined} dimColor={v.ok !== null}>
                        {v.ok === null ? `${duration(ms)}…` : stepTime(ms)}
                      </Text>
                    </Box>
                  </Box>
                  {isOpen && (
                    <Box flexDirection="column" paddingLeft={6} marginTop={1} gap={1}>
                      <Text wrap="wrap">{v.detail || v.label || tr().noArgs}</Text>
                      {v.error && (
                        <Text color={ALERT} wrap="wrap">
                          {v.error}
                        </Text>
                      )}
                      {v.detail && (
                        <Box flexDirection="row" gap={1} flexWrap="wrap">
                          {v.ok === false && (
                            <Button
                              key={`retry-${v.id}`}
                              variant="primary"
                              label={tr().retry}
                              onPress={() => void $.prompt.submit({ text: tr().retryPrompt(v.tool, v.detail, v.error) })}
                            />
                          )}
                          <Button key={`copy-${v.id}`} label={tr().copy} onPress={() => void copyText($, v.detail, e.surface)} />
                          <Button
                            key={`fill-${v.id}`}
                            label={tr().fill}
                            onPress={() => void $.prompt.fill({ text: v.detail, mode: 'replace' })}
                          />
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    // ── 改动 ──
    const changesView = async () => {
      const touched = await read($, touchedAtom)
      const root = gitState.root
      const rel = (abs: string) => (root && abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : abs)
      const touchedRel = new Map(touched.map(f => [rel(f.path), f]))
      const files = gitState.files
      const added = files.reduce((s, f) => s + (f.added ?? 0), 0)
      const removed = files.reduce((s, f) => s + (f.removed ?? 0), 0)
      const byClaude = files.filter(f => touchedRel.has(f.path))
      const others = files.filter(f => !touchedRel.has(f.path))
      // Claude 改过、但已经不在工作区改动里的（提交了或改回去了）
      const settled = touched.filter(f => !files.some(g => g.path === rel(f.path)))

      const fileRow = (f: GitFile) => {
        const { dir, name } = splitPath(f.path)
        const mine = touchedRel.get(f.path)
        return (
          <Box key={`file-${f.path}`} flexDirection="row" gap={1} alignItems="center">
            <Box width={2} flexShrink={0}>
              <Text bold color={statusColor(f.status)}>
                {tr().statusLabel(f.status)}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Button
                key={`mention-${f.path}`}
                plain
                label={`${clip(dir, 40)}${name}`}
                hover={{ underline: true, color: CLAY }}
                onPress={() => void $.prompt.fill({ text: `@${f.path} `, mode: 'append' })}
              />
            </Box>
            {mine && (
              <Box flexShrink={0}>
                <Text color={CLAY}>Claude ×{mine.edits}</Text>
              </Box>
            )}
            <Box flexShrink={0}>
              <Text>
                {f.added !== null && <Text color={OLIVE}>+{f.added}</Text>}
                {f.removed !== null && <Text color={ALERT}> −{f.removed}</Text>}
                {f.status === '??' && <Text dimColor>{tr().newFile}</Text>}
              </Text>
            </Box>
          </Box>
        )
      }

      if (!gitState.isRepo) {
        return (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>{gitState.isLoading ? tr().loading : tr().notRepo}</Text>
            {touched.length > 0 && <Text>{tr().touchedCount(touched.length)}</Text>}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Box flexGrow={1} minWidth={0}>
              <Text wrap="truncate-end">
                <Text color={SKY}>⎇ </Text>
                <Text bold>{gitState.branch ?? tr().noBranch}</Text>
                <Text dimColor>
                  {'  '}
                  {tr().nFiles(files.length)}
                </Text>
                {added > 0 && <Text color={OLIVE}> +{added}</Text>}
                {removed > 0 && <Text color={ALERT}> −{removed}</Text>}
              </Text>
            </Box>
            <Text dimColor>{gitState.isLoading ? tr().refreshing : gitState.updatedAt ? tr().updatedAt(clockTime(gitState.updatedAt)) : ''}</Text>
            <Button key="git-refresh" label={tr().refresh} onPress={() => void refreshGit($)} />
          </Box>
          {gitState.error && <Text color={ALERT}>{gitState.error}</Text>}

          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button
              key="summarize"
              label={tr().summarize}
              onPress={() => void $.prompt.submit({ text: tr().summaryPrompt(files.map(f => f.path)) })}
            />
            <Button key="commit-msg" label={tr().commitMsg} onPress={() => void $.prompt.submit({ text: tr().commitPrompt })} />
          </Box>

          {files.length === 0 && <Text dimColor>{tr().clean}</Text>}

          {byClaude.length > 0 && (
            <Box flexDirection="column">
              <Text bold color={CLAY}>
                {tr().byClaude(byClaude.length)}
              </Text>
              {byClaude.slice(0, MAX_ROWS).map(fileRow)}
            </Box>
          )}

          {others.length > 0 && (
            <Box flexDirection="column">
              <Text bold>
                {byClaude.length > 0 ? tr().otherChanges(others.length) : tr().workingChanges(others.length)}
              </Text>
              {others.slice(0, MAX_ROWS).map(fileRow)}
              {others.length > MAX_ROWS && <Text dimColor>{tr().moreFiles(others.length - MAX_ROWS)}</Text>}
            </Box>
          )}

          {settled.length > 0 && (
            <Text dimColor wrap="truncate-end">
              {tr().settled(settled.length, settled.map(f => splitPath(rel(f.path)).name).slice(0, 6).join(tr().listSep))}
            </Text>
          )}
          <Text dimColor>{tr().mentionHint}</Text>
        </Box>
      )
    }

    // ── 历史 ──
    const historyView = async () => {
      const history = await read($, historyAtom)
      const expanded = await read($, expandedTurnAtom)
      const confirm = await read($, confirmCompactAtom)
      const mine = history.filter(r => r.sessionId === sessionId)
      const cost = mine.reduce((s, r) => s + (r.costUsd ?? 0), 0)
      const hasCost = mine.some(r => r.costUsd !== null)
      const tokens = mine.reduce((s, r) => s + tokenTotal(r.tokens), 0)
      const spent = mine.reduce((s, r) => s + (r.endedAt - r.startedAt), 0)
      const ctx = line?.contextPercent ?? null
      const ctxColor = ctx === null ? CLOUD : ctx >= 85 ? ALERT : ctx >= 60 ? AMBER : CLAY_MUTED
      const ctxFilled = ctx === null ? 0 : Math.max(0, Math.min(10, Math.round(ctx / 10)))
      const resolved = $.ui.resolve(e)
      const Svg = 'Svg' in resolved ? resolved.Svg : null
      const chartW = Math.max(240, Math.min(720, e.props.bodyColumns * 7))

      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{tr().session}</Text>
            <Text wrap="truncate-end">
              <Text bold>{mine.length}</Text>
              <Text dimColor>{tr().turnsTime}</Text>
              <Text bold>{duration(spent)}</Text>
              <Text dimColor>{tr().tokensLabel}</Text>
              <Text bold>{fmtTokens(tokens)}</Text>
              {hasCost && <Text dimColor>{tr().costLabel}</Text>}
              {hasCost && <Text bold>{money(cost)}</Text>}
            </Text>
            {ctx !== null && (
              <Box flexDirection="row" gap={1} alignItems="center">
                <Text>
                  <Text dimColor>{tr().context}</Text>
                  <Text color={ctxColor}>{'▰'.repeat(ctxFilled)}</Text>
                  <Text color={IDLE}>{'▱'.repeat(10 - ctxFilled)}</Text>
                  <Text bold color={ctxColor}>
                    {' '}
                    {Math.round(ctx)}%
                  </Text>
                </Text>
                {ctx >= 50 && (
                  <Button
                    key="compact"
                    variant={confirm ? 'primary' : 'secondary'}
                    label={confirm ? tr().compactConfirm : tr().compact}
                    onPress={() => void compactContext($)}
                  />
                )}
              </Box>
            )}
          </Box>

          {history.length > 1 && Svg && (
            <Svg source={usageChart(history, chartW, 64)} alt={tr().chartAlt(Math.min(24, history.length))} width={chartW} height={64} />
          )}

          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="copy-day" label={tr().copyDay} onPress={() => void copyDayLog($, e.surface)} />
          </Box>

          {history.length === 0 && <Text dimColor>{tr().noHistory}</Text>}

          {groupByDay(history).map(group => (
            <Box key={`day-${group.label}`} flexDirection="column">
              <Text bold color={CLAY_MUTED}>
                {tr().dayTurns(group.label, group.items.length)}
              </Text>
              {group.items.slice(0, 50).map(r => {
                const isOpen = expanded === r.id
                const mark = r.phase === 'interrupted' ? '✕' : r.errors > 0 ? '!' : '✓'
                const markColor = r.phase === 'interrupted' ? STONE : r.errors > 0 ? AMBER : OLIVE
                return (
                  <Box key={`turn-${r.id}`} flexDirection="column" marginBottom={isOpen ? 1 : 0}>
                    <Box flexDirection="row" gap={1} alignItems="center">
                      <Box width={2} flexShrink={0}>
                        <Text bold color={markColor}>
                          {mark}
                        </Text>
                      </Box>
                      <Box width={6} flexShrink={0}>
                        <Text dimColor>{clockTime(r.startedAt)}</Text>
                      </Box>
                      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                        <Button
                          key={`turn-toggle-${r.id}`}
                          plain
                          label={`${isOpen ? '▾' : '▸'} ${r.summary}`}
                          hover={{ underline: true, color: CLAY }}
                          onPress={() => void update($, expandedTurnAtom, cur => (cur === r.id ? null : r.id))}
                        />
                      </Box>
                      <Box flexShrink={0}>
                        <Text dimColor>{recordMeta(r)}</Text>
                      </Box>
                    </Box>
                    {isOpen && (
                      <Box flexDirection="column" paddingLeft={9} marginTop={1}>
                        <Text color={CLOUD} wrap="wrap">
                          「{r.request}」
                        </Text>
                        <Text dimColor wrap="wrap">
                          {[
                            r.project ? tr().project(r.project) : null,
                            r.sessionId === sessionId ? tr().thisSession : tr().otherSession(dayLabel(r.startedAt)),
                            r.errors ? tr().nFailed(r.errors) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                        <Text dimColor wrap="wrap">
                          {tr().tokenBreakdown(fmtTokens(r.tokens.input), fmtTokens(r.tokens.output), fmtTokens(r.tokens.cacheRead), fmtTokens(r.tokens.cacheWrite), fmtTokens(r.narratorTokens))}
                        </Text>
                        {r.files.length > 0 && (
                          <Text wrap="wrap">
                            <Text dimColor>{tr().edited}</Text>
                            {r.files.join(tr().listSep)}
                          </Text>
                        )}
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          ))}
        </Box>
      )
    }

    const body = tab === 'turn' ? await turnView() : tab === 'changes' ? await changesView() : await historyView()

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {body}
      </Box>
    )
  })
}
