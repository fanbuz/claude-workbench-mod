// 工作台的纯函数：配色、格式化、图标、git 输出解析、提示词。
// 这里不碰 $（引擎只允许 $ 在入口文件里流转），入口文件 register.tsx 调用它们。

import type { GitFile, TokenTally, TurnRecord } from '../types'
import type { Lang } from './i18n'
import { tr } from './i18n'

// ── 配色：Claude 品牌色 + 中间调辅助色，浅色和深色背景上都看得清 ──────────────
export const CLAY = '#D97757' // Claude 的陶土橙
export const CLAY_MUTED = '#B5836B' // 结束后的柔和橙棕
export const STONE = '#8F8A80' // 暖灰
export const SKY = '#6A9BCC'
export const OLIVE = '#788C5D'
export const FIG = '#C46686'
export const CLOUD = '#B0AEA5'
export const AMBER = '#D4A27F'
export const ALERT = '#BF4D43'
export const IDLE = STONE

export const ZERO: TokenTally = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

// ── 格式化 ────────────────────────────────────────────────────────────────
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function stepTime(ms: number): string {
  return ms < 1000 ? `${ms}ms` : duration(ms)
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// ── 工具调用 ──────────────────────────────────────────────────────────────
// 完整的命令或主要参数（展开、复制、填入输入框时用）
export function detailOf(args: Record<string, unknown>): string {
  const pick = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const raw =
    pick('command') ||
    pick('file_path') ||
    pick('notebook_path') ||
    pick('path') ||
    pick('pattern') ||
    pick('url') ||
    pick('query') ||
    pick('description') ||
    pick('prompt') ||
    pick('skill')
  return clip(raw.trim(), 2000)
}

export function labelOf(args: Record<string, unknown>): string {
  const pick = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : '')
  const path = pick('file_path') || pick('notebook_path') || pick('path')
  const raw =
    pick('command') ||
    path ||
    pick('pattern') ||
    pick('url') ||
    pick('query') ||
    pick('description') ||
    pick('prompt') ||
    pick('skill')
  return clip(raw.replace(/\s+/g, ' ').trim(), 120)
}

// 编辑类工具改的是哪个文件
export function editedPath(tool: string, args: Record<string, unknown>): string | null {
  if (!/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return null
  const p = args['file_path'] ?? args['notebook_path']
  return typeof p === 'string' ? p : null
}

export function shortTool(tool: string): string {
  return tool.startsWith('mcp__') ? (tool.split('__').pop() ?? tool) : tool
}

export function shortLabel(label: string, max = 36): string {
  const base = label.includes('/') && !label.includes(' ') ? (label.split('/').pop() ?? label) : label
  return clip(base, max)
}

export function toolColor(tool: string): string {
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return SKY
  if (/^(Bash|BashOutput|KillShell)$/.test(tool)) return CLAY
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) return OLIVE
  if (/^Web/.test(tool)) return '#9C87C4'
  if (/^(Agent|Task)$/.test(tool)) return FIG
  return STONE
}

// 工具失败时的原因：拒绝理由，或输出的第一行
export function errorOf(ran: { deny?: string; isError?: boolean; text?: string }): string | null {
  if (ran.deny !== undefined) return clip(tr().denied(ran.deny), 200)
  if (ran.isError !== true) return null
  const first = (ran.text ?? '').split('\n').find(l => l.trim()) ?? ''
  return clip(first.trim(), 200) || tr().failed
}

// ── 旁白 ──────────────────────────────────────────────────────────────────
export function oneLine(text: string): string {
  const line = text
    .replace(/\s+/g, ' ')
    .replace(/^["“「]|["”」]$/g, '')
    .replace(/[。.]$/, '')
    .trim()
  return clip(line, tr().maxLine) // 模型偶尔超字数，这里兜底截断
}

// ── token 图标：16px 高的线性小图标，桌面端画 SVG，终端退回 Unicode 符号 ──────────
export const ICON_H = 14

function iconSvg(width: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="16" viewBox="0 0 ${width} 16" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

const cylinder = (c: string) =>
  `<ellipse cx="6.5" cy="4" rx="5" ry="2" stroke="${c}" stroke-width="1.5"/>` +
  `<path d="M1.5 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M1.5 8c0 1.1 2.2 2 5 2s5-.9 5-2" stroke="${c}" stroke-width="1.5"/>`

export const ICONS = {
  input: (c: string) => iconSvg(16, `<path d="M8 13.5V3M3.5 7.5 8 3l4.5 4.5" stroke="${c}" stroke-width="2"/>`),
  output: (c: string) => iconSvg(16, `<path d="M8 2.5V13M3.5 8.5 8 13l4.5-4.5" stroke="${c}" stroke-width="2"/>`),
  cacheRead: (c: string) => iconSvg(22, cylinder(c) + `<path d="M18 13.5V5M15 8l3-3 3 3" stroke="${c}" stroke-width="1.6"/>`),
  cacheWrite: (c: string) => iconSvg(22, cylinder(c) + `<path d="M18 4.5V13M15 10l3 3 3-3" stroke="${c}" stroke-width="1.6"/>`),
  narrator: (c: string) =>
    iconSvg(16, `<path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11.5H8l-3.5 2.5v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" stroke="${c}" stroke-width="1.5"/>`),
  hit: (c: string) =>
    iconSvg(16, `<circle cx="8" cy="8" r="6.5" stroke="${c}" stroke-width="1.5"/><circle cx="8" cy="8" r="3.5" stroke="${c}" stroke-width="1.5"/><circle cx="8" cy="8" r="1.2" fill="${c}"/>`),
  cost: (c: string) =>
    iconSvg(16, `<circle cx="8" cy="8" r="6.5" stroke="${c}" stroke-width="1.5"/><text x="8" y="11.6" fill="${c}" font-size="10" font-weight="700" text-anchor="middle" font-family="-apple-system, 'Segoe UI', sans-serif">$</text>`),
  context: (c: string) =>
    iconSvg(16, `<rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="${c}" stroke-width="1.5"/><path d="M1.5 6h13" stroke="${c}" stroke-width="1.5"/>`),
}

export type IconKind = keyof typeof ICONS

export const GLYPHS: Record<IconKind, string> = {
  input: '↑',
  output: '↓',
  cacheRead: '≡↑',
  cacheWrite: '≡↓',
  narrator: '❝',
  hit: '◎',
  cost: '$',
  context: '▤',
}

// 终端里一个字符占几格：中日韩文字和全角符号占两格
export function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1
  return n
}

// 悬停提示卡片的配色：深底浅字，浅色和深色主题里都和横幅区分得开
export const TIP_BG = '#3D3A35'
export const TIP_FG = '#F5F3EF'

export const iconWidth = (kind: IconKind) => (kind.startsWith('cache') ? (ICON_H * 22) / 16 : ICON_H)

// ── git ───────────────────────────────────────────────────────────────────
// `git status --porcelain=v1` 的一行："XY path" 或 "R  old -> new"
export function parseStatus(stdout: string): GitFile[] {
  return stdout
    .split('\n')
    .filter(l => l.length > 3)
    .map(l => {
      const xy = l.slice(0, 2)
      const rest = l.slice(3)
      const path = rest.includes(' -> ') ? rest.split(' -> ').pop()! : rest
      const status = xy === '??' ? '??' : (xy.trim()[0] ?? 'M')
      return { path: path.replace(/^"|"$/g, ''), status, added: null, removed: null }
    })
}

// `git diff --numstat` 的一行："added\tremoved\tpath"（二进制文件是 "-\t-\tpath"）
export function mergeNumstat(files: GitFile[], stdout: string): GitFile[] {
  const stats = new Map<string, [number | null, number | null]>()
  for (const l of stdout.split('\n')) {
    const [a, r, ...p] = l.split('\t')
    if (!p.length) continue
    const path = p.join('\t').replace(/^.*=> /, '').replace(/[{}]/g, '')
    stats.set(path, [a === '-' ? null : Number(a), r === '-' ? null : Number(r)])
  }
  return files.map(f => {
    const s = stats.get(f.path)
    return s ? { ...f, added: s[0], removed: s[1] } : f
  })
}

export function statusColor(status: string): string {
  if (status === '??' || status === 'A') return OLIVE
  if (status === 'D') return ALERT
  if (status === 'R') return SKY
  return AMBER
}

export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}

// ── 配置（plugin.json 的 userConfig）──────────────────────────────────────────
export type NarratorMode = 'full' | 'lite' | 'off'

export type BandMode = 'band' | 'status' | 'off'

export type NarratorConfig = { mode: NarratorMode; bandMode: BandMode; language: Lang | 'auto'; minGapMs: number; materialStep: number }

function numberOption(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

export function narratorConfig(options: Readonly<Record<string, unknown>>): NarratorConfig {
  const mode = options['narratorMode']
  const band = options['bandMode']
  return {
    mode: mode === 'lite' || mode === 'off' ? mode : 'full',
    bandMode: band === 'status' || band === 'off' ? band : 'band',
    language: options['language'] === 'en' || options['language'] === 'zh' ? options['language'] : 'auto',
    minGapMs: numberOption(options['narratorIntervalSeconds'], 3, 120, 8) * 1000,
    materialStep: numberOption(options['narratorMaterialChars'], 100, 5000, 400),
  }
}

// ── 设置面板：每个配置项给出可选值（数字项给几个常用档位） ─────────────────────────
export const SETTING_FIELDS = [
  { field: 'language', choices: ['auto', 'en', 'zh'] },
  { field: 'bandMode', choices: ['band', 'status', 'off'] },
  { field: 'narratorMode', choices: ['full', 'lite', 'off'] },
  { field: 'narratorIntervalSeconds', choices: [5, 8, 15, 30, 60] },
  { field: 'narratorMaterialChars', choices: [200, 400, 800, 1600] },
] as const

export type SettingField = (typeof SETTING_FIELDS)[number]['field']

// `/config` 里插件配置项的键是 `<plugin>.<field>`，开发时插件名可能带 `@inline` 之类的后缀
export function isOwnConfigKey(key: string, field: string): boolean {
  return /^workbench(@[^.]+)?\./.test(key) && key.endsWith(`.${field}`)
}

// ── 历史 ──────────────────────────────────────────────────────────────────
export const tokenTotal = (t: TokenTally) => t.input + t.output + t.cacheRead + t.cacheWrite

export function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayLabel(ms: number, now = Date.now()): string {
  if (dayKey(ms) === dayKey(now)) return tr().today
  if (dayKey(ms) === dayKey(now - 86_400_000)) return tr().yesterday
  const d = new Date(ms)
  return tr().monthDay(d.getMonth() + 1, d.getDate())
}

// 按天分组，组内和组间都是新的在前
export function groupByDay(records: readonly TurnRecord[]): { label: string; items: TurnRecord[] }[] {
  const groups: { key: string; label: string; items: TurnRecord[] }[] = []
  for (const r of [...records].sort((a, b) => b.startedAt - a.startedAt)) {
    const key = dayKey(r.startedAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(r)
    else groups.push({ key, label: dayLabel(r.startedAt), items: [r] })
  }
  return groups
}

export function recordMeta(r: TurnRecord): string {
  return [tr().nSteps(r.steps), duration(r.endedAt - r.startedAt), r.costUsd !== null ? money(r.costUsd) : null].filter(Boolean).join(' · ')
}

// 「复制今天的工作记录」：一行一轮的 Markdown
export function dayLog(records: readonly TurnRecord[], now = Date.now()): string {
  const today = records.filter(r => dayKey(r.startedAt) === dayKey(now)).sort((a, b) => a.startedAt - b.startedAt)
  const lines = today.map(r => `- ${clockTime(r.startedAt)} ${r.project ? `[${r.project}] ` : ''}${r.summary}（${recordMeta(r)}）`)
  return [tr().dayLogTitle(dayKey(now)), '', ...lines].join('\n')
}

// 最近若干轮的花费柱状图（没有花费数据时改用 token 总量）。静态 SVG：只在新增记录时变化
export function usageChart(records: readonly TurnRecord[], width: number, height: number): string {
  const list = [...records].sort((a, b) => a.startedAt - b.startedAt).slice(-24)
  const useCost = list.every(r => r.costUsd !== null)
  const values = list.map(r => (useCost ? (r.costUsd ?? 0) : tokenTotal(r.tokens)))
  const max = Math.max(...values, useCost ? 0.001 : 1)
  const top = 16
  const gap = 4
  const barW = list.length ? Math.max(4, Math.min(28, (width - gap * (list.length - 1)) / list.length)) : 0
  const bars = list
    .map((r, i) => {
      const h = Math.max(2, ((values[i] ?? 0) / max) * (height - top - 2))
      const x = i * (barW + gap)
      const color = i === list.length - 1 ? CLAY : r.errors > 0 ? AMBER : CLAY_MUTED
      return `<rect x="${x.toFixed(1)}" y="${(height - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${color}"/>`
    })
    .join('')
  const label = useCost ? tr().chartMaxCost(money(max)) : tr().chartMaxTokens(fmtTokens(max))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<text x="0" y="11" font-size="11" fill="${STONE}" font-family="-apple-system, 'Segoe UI', sans-serif">${label}</text>` +
    `<line x1="0" y1="${height - 0.5}" x2="${width}" y2="${height - 0.5}" stroke="${CLOUD}" stroke-width="1"/>` +
    bars +
    `</svg>`
  )
}
